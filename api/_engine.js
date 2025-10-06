// Telegram Case-Bot Engine (updated 2025-10)
// Совместимо с Vercel Node.js 20.x

const fetch = global.fetch;
const state = {
  ts: 0,
  source: "none",
  rawItems: [],
  normalized: [],
  byCollection: {},
  dropStatsLast: null,
};

const ENV = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "",
  GIFTS_SOURCE_URL: process.env.GIFTS_SOURCE_URL || "https://tg.me/gifts/available_gifts",
  FORCE_PUBLIC: process.env.FORCE_PUBLIC === "1",
  STRICT_FILTER: process.env.STRICT_FILTER === "1",
  ALLOW_FIRST_FLOOR: process.env.ALLOW_FIRST_FLOOR === "1",
  FIRST_FLOOR_FACTOR: parseFloat(process.env.FIRST_FLOOR_FACTOR || "1.15"),
  ALLOW_SYNTH_COLLECTION: process.env.ALLOW_SYNTH_COLLECTION === "1",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Telegram API
async function tgCall(method) {
  if (!ENV.BOT_TOKEN) throw new Error("No TELEGRAM_BOT_TOKEN");
  const url = `https://api.telegram.org/bot${ENV.BOT_TOKEN}/${method}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!j.ok) throw new Error(`Bot API error: ${j.description || j.error_code}`);
  return j.result?.gifts || j.result?.items || j.result?.list || j.result || [];
}

async function fetchPublic() {
  const r = await fetch(ENV.GIFTS_SOURCE_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("Public fetch failed");
  const j = await r.json();
  return j?.gifts || j?.items || j?.list || [];
}

// Normalization
function normalizeGift(g) {
  const out = {
    giftId:
      g.giftId || g.id || g.gift_id || g.uid || g.uuid || g.slug || g.name || g.title,
    collectionId: extractCollectionId(g),
    stars:
      g.stars ||
      g.star_count ||
      g.price_star_count ||
      (g.prices && g.prices.stars) ||
      (Array.isArray(g.prices) && g.prices.find((p) => p.currency === "stars")?.amount) ||
      0,
    starsBuyable:
      g.starsBuyable ||
      g.can_be_purchased_for_stars ||
      g.buyable_for_stars ||
      (g.prices && !!g.prices.stars) ||
      (Array.isArray(g.prices) && g.prices.some((p) => p.currency === "stars")),
    improved: g.improved || g.is_improved || g.tags?.includes("improved"),
    resale: g.resale || g.is_resale || g.tags?.includes("resale"),
    title: g.title || g.name || g.text || "",
  };
  return out;
}

// ---- Updated extractCollectionId ----
function extractCollectionId(g) {
  const direct =
    g.collectionId ||
    g.collection_id ||
    g.set_id ||
    g.setId ||
    (g.collection && g.collection.id) ||
    (g.sticker && (g.sticker.set_name || g.sticker.setName)) ||
    g.sticker_set_name ||
    (g.sticker && g.sticker.set && g.sticker.set.name) ||
    (g.sticker && g.sticker.emoji_set && g.sticker.emoji_set.name);
  if (direct) return String(direct);

  if (ENV.ALLOW_SYNTH_COLLECTION) {
    const fid = g.sticker?.file_unique_id || g.sticker?.file_id;
    if (fid) return `synth:fuid:${String(fid).slice(0, 16)}`;
    if (typeof g.star_count === "number" && g.star_count > 0)
      return `synth:stars:${g.star_count}`;
    if (g.id) return `synth:id:${String(g.id).slice(0, 12)}`;
  }
  return undefined;
}

// ---- Updated filterUsable ----
function filterUsable(items, strictMode) {
  const out = [];
  const drop = { noGiftId: 0, noCollection: 0, noStars: 0, notBuyable: 0, strict: 0 };

  for (const g of items) {
    const n = normalizeGift(g);
    if (!n.collectionId && ENV.ALLOW_SYNTH_COLLECTION) n.collectionId = extractCollectionId(g);

    if (!n.giftId) { drop.noGiftId++; continue; }
    if (!n.collectionId) { drop.noCollection++; continue; }
    if (!n.stars || n.stars <= 0) { drop.noStars++; continue; }
    if (!n.starsBuyable) { drop.notBuyable++; continue; }
    if (strictMode && !(n.improved || n.resale)) { drop.strict++; continue; }

    out.push(n);
  }

  console.log("[engine] filter drop stats", drop, "kept=", out.length);
  state.dropStatsLast = drop;
  return out;
}

function groupByCollection(list) {
  const map = {};
  for (const n of list) {
    if (!map[n.collectionId]) map[n.collectionId] = [];
    map[n.collectionId].push(n);
  }
  return map;
}

async function refresh() {
  console.log("[engine] refresh()");
  let src = "bot", arr = [];
  try {
    if (ENV.FORCE_PUBLIC) {
      arr = await fetchPublic(); src = "public";
    } else {
      arr = await tgCall("getAvailableGifts"); src = "bot";
    }
  } catch (e) {
    console.warn("[engine] bot fetch failed:", e.message, "→ fallback public");
    try { arr = await fetchPublic(); src = "public"; } catch {}
  }

  if (!Array.isArray(arr)) arr = [];
  const usable = filterUsable(arr, ENV.STRICT_FILTER);
  const byColl = groupByCollection(usable);

  state.ts = Date.now();
  state.source = src;
  state.rawItems = arr;
  state.normalized = usable;
  state.byCollection = byColl;
  return state;
}

// ---- Diagnostics ----
function getDiagnostics() {
  const collections = Object.keys(state.byCollection);
  const firstRaw = state.rawItems[0] || {};
  const stickerKeys = firstRaw.sticker ? Object.keys(firstRaw.sticker) : [];
  return {
    ok: true,
    ts: state.ts,
    source: state.source,
    rawCount: state.rawItems.length,
    normalizedCount: state.normalized.length,
    collections,
    dropStats: state.dropStatsLast || null,
    exampleRawKeys: Object.keys(firstRaw),
    stickerKeys,
    exampleNormalized: state.normalized.slice(0, 3).map((n) => ({
      giftId: n.giftId, collectionId: n.collectionId, stars: n.stars, title: n.title,
    })),
  };
}

function getSnapshot() {
  return {
    ts: state.ts,
    source: state.source,
    rawCount: state.rawItems.length,
    normalizedCount: state.normalized.length,
  };
}

function getStarsByCollection() {
  const out = {};
  for (const [cid, arr] of Object.entries(state.byCollection)) {
    out[cid] = arr.map((n) => n.stars);
  }
  return out;
}

function getCasePricing() {
  const prices = {};
  for (const [cid, arr] of Object.entries(state.byCollection)) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const sorted = arr.map((a) => a.stars).sort((a, b) => a - b);
    const floor = sorted[0];
    const second = sorted[1] || (ENV.ALLOW_FIRST_FLOOR ? floor * ENV.FIRST_FLOOR_FACTOR : null);
    if (!second) continue;
    const price = Math.round(second * 0.35);
    prices[cid] = { floor, second, casePrice: price };
  }
  return prices;
}

function peek(limit = 20) {
  return state.normalized.slice(0, limit);
}

module.exports = {
  refresh,
  getDiagnostics,
  getSnapshot,
  getStarsByCollection,
  getCasePricing,
  peek,
  default: { refresh, getDiagnostics },
};
