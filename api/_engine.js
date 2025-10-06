'use strict';

/**
 * Универсальный движок каталога подарков Telegram для Vercel (Node 18+).
 * Источники:
 *   1) Bot API getAvailableGifts (TELEGRAM_BOT_TOKEN или BOT_TOKEN)
 *   2) Публичный JSON GIFTS_SOURCE_URL (по умолчанию https://tg.me/gifts/available_gifts)
 *   3) Демо-данные, если оба источника пустые
 *
 * Особенности:
 *   - Расширенная нормализация (star_count/collection_id/... и массивы цен)
 *   - Логи причин отбраковки
 *   - Авто-расклад коллекций по тиру кейсов (second floor) либо ручная карта из ENV
 *   - Совместимость: getDiagnostics(), getSnapshot(), getStarsByCollection(), getCasePricing(), peek(), refresh()
 */

const ENV = {
  TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '',
  FORCE_PUBLIC: process.env.FORCE_PUBLIC === '1',
  STRICT_FILTER: process.env.STRICT_FILTER === '1' ? 1 : 0, // 0 — проще стартовать
  GIFTS_SOURCE_URL: process.env.GIFTS_SOURCE_URL || 'https://tg.me/gifts/available_gifts',
  REFRESH_MS: Math.max(0, parseInt(process.env.REFRESH_MS || '60000', 10)),
  ALLOW_FIRST_FLOOR: process.env.ALLOW_FIRST_FLOOR === '0' ? 0 : 1, // по умолчанию включен
  FIRST_FLOOR_FACTOR: parseFloat(process.env.FIRST_FLOOR_FACTOR || '1.15'),
  PRICING_RTP: parseFloat(process.env.PRICING_RTP || '0.80'),
  PRICING_MARKUP: parseFloat(process.env.PRICING_MARKUP || '0.08'),
  ROUND_STEP: Math.max(0.01, parseFloat(process.env.ROUND_STEP || '1')),
  MAX_COLLECTIONS_PER_TIER: Math.max(1, parseInt(process.env.MAX_COLLECTIONS_PER_TIER || '3', 10)),
  COLLECTION_MAP_JSON: process.env.COLLECTION_MAP_JSON || '',
};

const CASES = [
  { id: 'starter', title: 'Starter' },
  { id: 'rare',    title: 'Rare'    },
  { id: 'epic',    title: 'Epic'    },
  { id: 'legend',  title: 'Legend'  },
];

const FLOOR_THRESHOLDS = { starterMax: 20, rareMax: 100, epicMax: 500 }; // legend => >500

// ---------------------- HTTP ----------------------
async function fetchJson(url, opts) {
  const r = await fetch(url, { ...opts, cache: 'no-store' });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${text.slice(0, 300)}`);
  }
  return r.json();
}
async function fetchBotGifts() {
  if (!ENV.TOKEN) throw new Error('No TELEGRAM_BOT_TOKEN/BOT_TOKEN set');
  const url = `https://api.telegram.org/bot${ENV.TOKEN}/getAvailableGifts`;
  const j = await fetchJson(url);
  if (!j.ok) throw new Error(`Telegram error: ${JSON.stringify(j)}`);
  const list = j.result?.gifts || j.result?.items || j.result?.list || [];
  return Array.isArray(list) ? list : [];
}
async function fetchPublicGifts() {
  const j = await fetchJson(ENV.GIFTS_SOURCE_URL);
  const list = j.result?.gifts || j.result?.items || j.result?.list || j.gifts || j.items || j.list || j;
  return Array.isArray(list) ? list : (Array.isArray(j) ? j : []);
}

// ---------------------- Normalization ----------------------
function pick(...vals) { for (const v of vals) if (v !== undefined && v !== null) return v; }
function extractStars(g) {
  const direct = pick(g.star_count, g.stars, g.price_stars, g.priceStars, g.value_stars);
  if (typeof direct === 'number' && direct > 0) return direct;
  const price = g.price || g.cost || g.min_price || g.minPrice || g.lowest_price || g.lowestPrice;
  if (price && typeof price === 'object') {
    const unit = (price.unit || price.currency || '').toString().toLowerCase();
    const val  = pick(price.value, price.amount, price.star_count, price.stars);
    if (unit === 'stars' && typeof val === 'number' && val > 0) return val;
  }
  const prices = g.prices || g.options || g.variants;
  if (Array.isArray(prices)) {
    const starish = prices
      .map(p => {
        const unit = (p.unit || p.currency || '').toString().toLowerCase();
        const val  = pick(p.value, p.amount, p.star_count, p.stars);
        return unit === 'stars' && typeof val === 'number' && val > 0 ? val : undefined;
      })
      .filter(v => typeof v === 'number')
      .sort((a, b) => a - b);
    if (starish.length) return starish[0];
  }
}
function extractCollectionId(g) {
  return pick(
    g.collectionId, g.collection_id, g.collection?.id,
    g.pack_id, g.set_id, g.setId,
    g.sticker?.set_name, g.sticker_set_name
  );
}
function isBuyableForStars(g, stars) {
  if (!stars || stars <= 0) return false;
  const rc = pick(g.remaining_count, g.remainingCount);
  if (rc === 0) return false;
  if (g.buyable === false) return false;
  if (g.can_purchase === false) return false;
  if (g.can_buy_with_stars === false) return false;
  return true;
}
function detectImproved(g) {
  const t = [g.type, g.kind, g.section, g.category, g.tag].map(x => (x||'').toLowerCase()).join(' ');
  if (g.upgrade_star_count > 0 || g.upgradeStars > 0) return true;
  if (t.includes('unique') || t.includes('upgrade') || t.includes('improved')) return true;
  return false;
}
function detectResale(g) {
  const t = [g.type, g.kind, g.section, g.sale_type, g.saleType].map(x => (x||'').toLowerCase()).join(' ');
  return t.includes('resale') || t.includes('re-sale') || t.includes('secondary');
}
function normalizeGift(g) {
  const giftId = pick(g.id, g.gift_id, g.uid, g.slug, g.unique_id, g.short_id);
  const collectionId = extractCollectionId(g);
  const stars = extractStars(g);
  const starsBuyable = isBuyableForStars(g, stars);
  const improved = detectImproved(g);
  const resale = detectResale(g);
  const title = pick(g.title, g.name, g.label, g.sticker?.emoji, g.sticker?.alt, g.description);
  return { giftId, title, collectionId, stars, improved, resale, starsBuyable, raw: g };
}
function filterUsable(items, strictMode) {
  const out = []; const drop = { noGiftId:0, noCollection:0, noStars:0, notBuyable:0, strict:0 };
  for (const g of items) {
    const n = normalizeGift(g);
    if (!n?.giftId) { drop.noGiftId++; continue; }
    if (!n.collectionId) { drop.noCollection++; continue; }
    if (!n.stars || n.stars <= 0) { drop.noStars++; continue; }
    if (!n.starsBuyable) { drop.notBuyable++; continue; }
    if (strictMode && !(n.improved || n.resale)) { drop.strict++; continue; }
    out.push(n);
  }
  console.log('[engine] filter drop stats', drop, 'kept=', out.length);
  state.dropStatsLast = drop;
  return out;
}

// ---------------------- Collections / Floors / Buckets ----------------------
function buildByCollection(normalized) {
  const m = new Map();
  for (const n of normalized) { if (!m.has(n.collectionId)) m.set(n.collectionId, []); m.get(n.collectionId).push(n); }
  const by = {};
  for (const [col, arr] of m.entries()) {
    const seen = new Set();
    const cleaned = arr
      .filter(x => x.giftId && !seen.has(x.giftId) && typeof x.stars === 'number')
      .sort((a, b) => a.stars - b.stars)
      .map(x => { seen.add(x.giftId); return { giftId: x.giftId, title: x.title, stars: x.stars }; });
    if (cleaned.length) by[col] = cleaned;
  }
  return by;
}
function computeFloors(byCollection) {
  const floors = {};
  for (const [col, arr] of Object.entries(byCollection)) {
    const prices = [...new Set(arr.map(x => x.stars))].sort((a, b) => a - b);
    floors[col] = { first: prices[0], second: prices.length >= 2 ? prices[1] : null };
  }
  return floors;
}
function chooseSecondFloor(colId, floors) {
  const f = floors[colId]; if (!f) return null;
  if (f.second != null) return f.second;
  if (ENV.ALLOW_FIRST_FLOOR && typeof f.first === 'number') return Math.ceil(f.first * ENV.FIRST_FLOOR_FACTOR);
  return null;
}
function autoBuckets(byCollection, floors, maxPerTier) {
  const buckets = { starter: [], rare: [], epic: [], legend: [] };
  for (const col of Object.keys(byCollection)) {
    const second = chooseSecondFloor(col, floors);
    if (!second) continue;
    if (second <= FLOOR_THRESHOLDS.starterMax) buckets.starter.push([second, col]);
    else if (second <= FLOOR_THRESHOLDS.rareMax) buckets.rare.push([second, col]);
    else if (second <= FLOOR_THRESHOLDS.epicMax) buckets.epic.push([second, col]);
    else buckets.legend.push([second, col]);
  }
  const pick = a => a.sort((x,y)=>x[0]-y[0]).slice(0, maxPerTier).map(([,id])=>id);
  return {
    'col-common-a': pick(buckets.starter),
    'col-rare-a':   pick(buckets.rare),
    'col-epic-a':   pick(buckets.epic),
    'col-legend-a': pick(buckets.legend),
  };
}
function roundStep(x, step) { return (!step || step <= 0) ? Math.round(x) : Math.round(x/step)*step; }
function priceCases(mapping, floors) {
  const res = [];
  const evOf = cols => {
    const vals = cols.map(c => chooseSecondFloor(c, floors)).filter(v => typeof v === 'number');
    if (!vals.length) return null; return vals.reduce((a,b)=>a+b,0) / vals.length;
  };
  for (const tier of CASES) {
    const key = ({starter:'col-common-a', rare:'col-rare-a', epic:'col-epic-a', legend:'col-legend-a'})[tier.id];
    const cols = mapping[key] || [];
    const ev = evOf(cols);
    const priceRaw = ev != null ? ev * ENV.PRICING_RTP * (1 + ENV.PRICING_MARKUP) : 0;
    const finalPrice = ev != null ? roundStep(priceRaw, ENV.ROUND_STEP) : 0;
    res.push({
      tier: tier.id, title: tier.title, collections: cols, ev, finalPrice,
      blocked: ev == null, blockedReason: ev == null ? 'no-usable-second-floor' : null,
      pricing: { rtp: ENV.PRICING_RTP, markup: ENV.PRICING_MARKUP, roundStep: ENV.ROUND_STEP },
    });
  }
  return res;
}

// ---------------------- State & API ----------------------
const state = { ts: 0, source: 'demo', rawItems: [], normalized: [], byCollection: {}, floors: {}, dropStatsLast: null };

async function refresh() {
  try {
    let items = []; let source = 'demo';
    if (ENV.TOKEN && !ENV.FORCE_PUBLIC) {
      try { items = await fetchBotGifts(); source = 'bot'; }
      catch (e) { console.warn('[engine] bot fetch failed, fallback to public:', e?.message || e); }
    }
    if (!items.length) {
      try { items = await fetchPublicGifts(); source = 'public'; }
      catch (e) { console.warn('[engine] public fetch failed, fallback to demo:', e?.message || e); }
    }
    if (!items.length) {
      items = [
        { id:'demo-1', collection_id:'demo-col-a', star_count:5 },
        { id:'demo-2', collection_id:'demo-col-a', star_count:8 },
        { id:'demo-3', collection_id:'demo-col-b', star_count:60 },
        { id:'demo-4', collection_id:'demo-col-b', star_count:90 },
        { id:'demo-5', collection_id:'demo-col-c', star_count:150 },
        { id:'demo-6', collection_id:'demo-col-c', star_count:300 },
        { id:'demo-7', collection_id:'demo-col-d', star_count:600 },
        { id:'demo-8', collection_id:'demo-col-d', star_count:900 },
      ];
      source = 'demo';
    }
    const normalized = filterUsable(items, ENV.STRICT_FILTER);
    const byCollection = buildByCollection(normalized);
    const floors = computeFloors(byCollection);
    state.ts = Date.now();
    state.source = source;
    state.rawItems = items;
    state.normalized = normalized;
    state.byCollection = byCollection;
    state.floors = floors;
    console.log(`[engine] source=${source}, strict=${ENV.STRICT_FILTER}, raw=${items.length}, normalized=${normalized.length}, collections=${Object.keys(byCollection).length}`);
  } catch (e) {
    console.error('[engine] refresh failed:', e?.stack || e);
  }
}

function getSnapshot() {
  const samples = {}; for (const [col, arr] of Object.entries(state.byCollection)) samples[col] = arr.slice(0, 3);
  return { ok:true, ts: state.ts, source: state.source, rawCount: state.rawItems.length,
           normalizedCount: state.normalized.length, collections: Object.keys(state.byCollection), samples };
}
function getDiagnostics() {
  const collections = Object.keys(state.byCollection);
  return {
    ok: true, ts: state.ts, source: state.source,
    rawCount: state.rawItems.length, normalizedCount: state.normalized.length, collections,
    dropStats: state.dropStatsLast || null,
    exampleRawKeys: Object.keys(state.rawItems[0] || {}),
    exampleNormalized: state.normalized.slice(0,3).map(n => ({ giftId:n.giftId, collectionId:n.collectionId, stars:n.stars, title:n.title })),
  };
}
function getStarsByCollection() { return { byCollection: state.byCollection }; }
function getCasePricing() {
  let mapping = null;
  if (ENV.COLLECTION_MAP_JSON) { try { mapping = JSON.parse(ENV.COLLECTION_MAP_JSON); } catch(e){ console.warn('[engine] invalid COLLECTION_MAP_JSON:', e?.message || e); } }
  if (!mapping) mapping = autoBuckets(state.byCollection, state.floors, ENV.MAX_COLLECTIONS_PER_TIER);
  return { ok:true, ts: state.ts, source: state.source, mapping, floors: state.floors, cases: priceCases(mapping, state.floors) };
}
function peek(limit = 20) { return state.normalized.slice(0, Math.max(1, Math.min(200, +limit || 20))); }

// авто-обновление (локально полезно; на serverless — best-effort)
if (ENV.REFRESH_MS > 0) {
  refresh().catch(() => {}); const t = setInterval(() => refresh().catch(() => {}), ENV.REFRESH_MS);
  if (typeof t.unref === 'function') try { t.unref(); } catch {}
}

const engine = { refresh, getSnapshot, getDiagnostics, getStarsByCollection, getCasePricing, peek };
module.exports = engine; module.exports.default = engine;
