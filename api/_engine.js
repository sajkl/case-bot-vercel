// Telegram Case-Bot Engine with Marketplace support (2025-10)
// Совместимо с Vercel Node.js 20.x (CommonJS)

'use strict';

const fetch = global.fetch;

// ======= ENV =======
const ENV = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '',
  FORCE_PUBLIC: process.env.FORCE_PUBLIC === '1',

  // Нормализация / фильтры
  STRICT_FILTER: process.env.STRICT_FILTER === '1',
  ALLOW_SYNTH_COLLECTION: process.env.ALLOW_SYNTH_COLLECTION !== '0', // по умолчанию ВКЛ
  ALLOW_FIRST_FLOOR: process.env.ALLOW_FIRST_FLOOR !== '0',           // по умолчанию ВКЛ
  FIRST_FLOOR_FACTOR: parseFloat(process.env.FIRST_FLOOR_FACTOR || '1.15'),

  // Источники каталога и маркета
  GIFTS_SOURCE_URL: process.env.GIFTS_SOURCE_URL || 'https://tg.me/gifts/available_gifts',
  MARKET_ENABLED: process.env.MARKET_ENABLED !== '0', // по умолчанию ВКЛ
  MARKET_SOURCE: (process.env.MARKET_SOURCE || 'auto') /* auto|public|both */.toLowerCase(),
  GIFTS_MARKET_URL: process.env.GIFTS_MARKET_URL || '', // если есть публичная витрина маркета (JSON)

  // Прайсинг кейсов (для каталога и/или маркета)
  PRICING_RTP: parseFloat(process.env.PRICING_RTP || '0.80'),
  PRICING_MARKUP: parseFloat(process.env.PRICING_MARKUP || '0.08'),
  ROUND_STEP: Math.max(0.01, parseFloat(process.env.ROUND_STEP || '1')),

  // Явная карта тиров (опционально)
  COLLECTION_MAP_JSON: process.env.COLLECTION_MAP_JSON || '',
};

// ======= STATE =======
const state = {
  ts: 0,

  // исходники
  sourceCatalog: 'none', // 'bot'|'public'|'none'
  sourceMarket: 'none',  // 'inline'|'public'|'none'  (inline = взяли из того же Bot API)

  raw: {
    catalog: [],
    market: [],
  },

  // нормализация
  normalized: {
    catalog: [],
    market: [],
  },

  byCollection: {
    catalog: {}, // { [collectionId]: Array<{giftId,title,stars,market,marketStars}> }
    market:  {}, // ...
  },

  dropStatsLast: {
    catalog: null,
    market: null,
  },
};

// ======= HTTP helpers =======
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function fetchBot(method) {
  if (!ENV.BOT_TOKEN) throw new Error('No TELEGRAM_BOT_TOKEN/BOT_TOKEN');
  const url = `https://api.telegram.org/bot${ENV.BOT_TOKEN}/${method}`;
  const j = await fetchJson(url);
  if (j.ok === false) throw new Error(j.description || 'Bot API error');
  // most responses wrap in {result:{gifts|items|list}}
  return j.result?.gifts || j.result?.items || j.result?.list || j.result || [];
}

async function fetchPublicCatalog() {
  const j = await fetchJson(ENV.GIFTS_SOURCE_URL);
  return j?.gifts || j?.items || j?.list || (Array.isArray(j) ? j : []);
}

async function fetchPublicMarket() {
  if (!ENV.GIFTS_MARKET_URL) return [];
  const j = await fetchJson(ENV.GIFTS_MARKET_URL);
  // допускаем любые названия массивов
  return j?.market || j?.resale || j?.items || j?.list || (Array.isArray(j) ? j : []);
}

// ======= Extract helpers =======
function pick(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

function extractStars(g) {
  // прямые числовые
  const direct = pick(g.stars, g.star_count, g.price_star_count, g.value_stars);
  if (typeof direct === 'number' && direct > 0) return direct;

  // варианты цен
  const prices = g.prices || g.variants || g.options;
  if (Array.isArray(prices)) {
    const found = prices
      .map(p => {
        const unit = (p.unit || p.currency || '').toString().toLowerCase();
        const val  = pick(p.value, p.amount, p.star_count, p.stars);
        if (unit === 'stars' && typeof val === 'number' && val > 0) return val;
      })
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (found.length) return found[0];
  }

  // объект цены
  const price = g.price || g.cost || g.lowest_price || g.min_price;
  if (price && typeof price === 'object') {
    const unit = (price.unit || price.currency || '').toString().toLowerCase();
    const val  = pick(price.value, price.amount, price.star_count, price.stars);
    if (unit === 'stars' && typeof val === 'number' && val > 0) return val;
  }

  return undefined;
}

function extractMarketStars(g) {
  // цена именно маркет-листинга (если отличается от каталога)
  const direct = pick(
    g.sale_price_stars, g.market_price_stars, g.resale_price_stars,
    g.saleStars, g.marketStars, g.resaleStars
  );
  if (typeof direct === 'number' && direct > 0) return direct;

  const price = g.sale_price || g.market_price || g.resale_price;
  if (price && typeof price === 'object') {
    const unit = (price.unit || price.currency || '').toString().toLowerCase();
    const val  = pick(price.value, price.amount, price.star_count, price.stars);
    if (unit === 'stars' && typeof val === 'number' && val > 0) return val;
  }

  const prices = g.sale_options || g.market_options || g.resale_options;
  if (Array.isArray(prices)) {
    const found = prices
      .map(p => {
        const unit = (p.unit || p.currency || '').toString().toLowerCase();
        const val  = pick(p.value, p.amount, p.star_count, p.stars);
        if (unit === 'stars' && typeof val === 'number' && val > 0) return val;
      })
      .filter(Boolean)
      .sort((a,b)=>a-b);
    if (found.length) return found[0];
  }

  // fallback: если явно помечено как resale/sale и есть обычные stars
  const stars = extractStars(g);
  const resale = detectResale(g);
  if (resale && typeof stars === 'number' && stars > 0) return stars;

  return undefined;
}

function extractCollectionId(g) {
  const direct = pick(
    g.collectionId, g.collection_id,
    g.set_id, g.setId,
    g.collection?.id,
    g.sticker?.set_name, g.sticker?.setName,
    g.sticker_set_name,
    g.sticker?.set?.name,
    g.sticker?.emoji_set?.name
  );
  if (direct) return String(direct);

  if (ENV.ALLOW_SYNTH_COLLECTION) {
    const fid = g.sticker?.file_unique_id || g.sticker?.file_id;
    if (fid) return `synth:fuid:${String(fid).slice(0, 16)}`;
    const sc = pick(g.star_count, g.stars);
    if (typeof sc === 'number' && sc > 0) return `synth:stars:${sc}`;
    if (g.id) return `synth:id:${String(g.id).slice(0, 12)}`;
  }
  return undefined;
}

function detectResale(g) {
  const t = [
    g.type, g.kind, g.section, g.category,
    g.sale_type, g.saleType, g.market_type
  ].map(x => (x || '').toString().toLowerCase()).join(' ');
  if (t.includes('resale') || t.includes('sale') || t.includes('market')) return true;
  if (g.is_resale === true || g.resale === true) return true;
  return false;
}

function isExplicitlyNotBuyable(g) {
  if (g.buyable === false) return true;
  if (g.can_purchase === false) return true;
  if (g.can_buy_with_stars === false) return true;
  if (g.is_available === false) return true;
  const rc = pick(g.remaining_count, g.remainingCount);
  if (rc === 0) return true;
  return false;
}

function isBuyableForStars(g, stars) {
  if (!stars || stars <= 0) return false;
  return !isExplicitlyNotBuyable(g);
}

// ======= Normalizers =======
function normalizeCatalogGift(g) {
  const stars = extractStars(g);
  return {
    market: false,
    giftId: pick(g.giftId, g.id, g.gift_id, g.uid, g.uuid, g.slug),
    collectionId: extractCollectionId(g),
    stars,
    marketStars: undefined,
    starsBuyable: isBuyableForStars(g, stars),
    improved: !!(g.improved || g.is_improved),
    resale: detectResale(g),
    title: pick(g.title, g.name, g.text, (g.sticker?.emoji && `Sticker ${g.sticker.emoji}`)),
    raw: g,
  };
}

function normalizeMarketItem(g) {
  // для маркет-листинга считаем marketStars; если нет — пробуем обычные stars
  const mStars = extractMarketStars(g);
  const stars = extractStars(g);
  return {
    market: true,
    giftId: pick(g.giftId, g.id, g.gift_id, g.uid, g.uuid, g.slug),
    collectionId: extractCollectionId(g),
    stars: stars || mStars || 0,
    marketStars: mStars || stars || 0,
    starsBuyable: (typeof (mStars || stars) === 'number' && (mStars || stars) > 0) && !isExplicitlyNotBuyable(g),
    improved: !!(g.improved || g.is_improved),
    resale: true,
    title: pick(g.title, g.name, g.text, (g.sticker?.emoji && `Sticker ${g.sticker.emoji}`)),
    raw: g,
  };
}

// Фильтр с логами (каталог/маркет)
function filterUsable(items, strictMode, isMarket) {
  const out = [];
  const drop = { noGiftId: 0, noCollection: 0, noStars: 0, notBuyable: 0, strict: 0 };

  for (const g of items) {
    const n = isMarket ? normalizeMarketItem(g) : normalizeCatalogGift(g);

    if (!n.collectionId && ENV.ALLOW_SYNTH_COLLECTION) n.collectionId = extractCollectionId(g);

    if (!n.giftId)                 { drop.noGiftId++;     continue; }
    if (!n.collectionId)           { drop.noCollection++; continue; }
    if (!n.stars || n.stars <= 0)  { drop.noStars++;      continue; }

    // Для маркета ослабляем правило: допускаем элементы, даже если это не "starsBuyable" по каталожному смыслу,
    // но есть marketStars>0 (уже в normalizeMarketItem проставлено в stars/marketStars)
    if (!n.starsBuyable && !isMarket) { drop.notBuyable++; continue; }

    if (strictMode && !(n.improved || n.resale)) { drop.strict++; continue; }

    out.push(n);
  }

  // сортируем внутри коллекции по цене (market: по marketStars, иначе по stars)
  const sortKey = isMarket ? (x => x.marketStars || x.stars) : (x => x.stars);
  out.sort((a, b) => sortKey(a) - sortKey(b));

  return { list: out, drop };
}

function buildByCollection(list, isMarket) {
  const by = {};
  for (const n of list) {
    const key = n.collectionId;
    if (!by[key]) by[key] = [];
    const entry = { giftId: n.giftId, title: n.title, stars: n.stars };
    if (isMarket) entry.marketStars = n.marketStars;
    by[key].push(entry);
  }
  return by;
}

// ======= Pricing helpers =======
function roundStep(x, step) {
  if (!step || step <= 0) return Math.round(x);
  return Math.round(x / step) * step;
}

function priceCasesFrom(byCollection) {
  // вычислим по "второму полу" цен
  const results = [];
  for (const [cid, arr] of Object.entries(byCollection)) {
    const prices = [...new Set(arr.map(x => x.stars))].sort((a,b)=>a-b);
    const floor = prices[0];
    const second = prices[1] || (ENV.ALLOW_FIRST_FLOOR ? Math.ceil(prices[0] * ENV.FIRST_FLOOR_FACTOR) : null);
    if (!floor || !second) continue;
    const ev = second; // простая модель EV = второй "пол"
    const raw = ev * ENV.PRICING_RTP * (1 + ENV.PRICING_MARKUP);
    const finalPrice = roundStep(raw, ENV.ROUND_STEP);
    results.push({ collectionId: cid, floor, second, casePrice: finalPrice, ev });
  }
  return results.sort((a,b)=>a.casePrice - b.casePrice);
}

// ======= Refresh (fetch + normalize + group) =======
async function refresh() {
  let catalog = [];
  let marketInline = [];
  let srcCat = 'none';
  let srcMarket = 'none';

  // 1) Каталог (bot → public → empty)
  try {
    if (!ENV.FORCE_PUBLIC) {
      catalog = await fetchBot('getAvailableGifts');
      srcCat = 'bot';
    }
  } catch (e) {
    // fallback
  }
  if (!catalog.length) {
    try {
      catalog = await fetchPublicCatalog();
      srcCat = 'public';
    } catch (e) {
      catalog = [];
      srcCat = 'none';
    }
  }

  // 2) Маркет
  if (ENV.MARKET_ENABLED) {
    try {
      if (ENV.MARKET_SOURCE === 'auto' || ENV.MARKET_SOURCE === 'both') {
        // попытка извлечь маркет-позиций прямо из каталога (если API помечает resale)
        marketInline = (Array.isArray(catalog) ? catalog : []).filter(detectResale);
        if (marketInline.length) srcMarket = 'inline';
      }
      if ((ENV.MARKET_SOURCE === 'public' || ENV.MARKET_SOURCE === 'both') && ENV.GIFTS_MARKET_URL) {
        const marketPublic = await fetchPublicMarket();
        // объединяем с inline
        const unified = [...marketInline, ...marketPublic];
        // простая дедупликация по id/slug
        const seen = new Set();
        const merged = [];
        for (const it of unified) {
          const k = pick(it.id, it.gift_id, it.slug, it.uid) || JSON.stringify(it).slice(0,64);
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(it);
        }
        marketInline = merged;
        srcMarket = marketPublic.length ? 'public' : (marketInline.length ? 'inline' : 'none');
      }
    } catch (e) {
      // если что-то пошло не так — просто без маркета
      srcMarket = marketInline.length ? 'inline' : 'none';
    }
  }

  // 3) Нормализация
  const catFiltered = filterUsable(catalog, ENV.STRICT_FILTER, /* isMarket */ false);
  const marketFiltered = filterUsable(marketInline, /*strict*/ false, /*isMarket*/ true);

  const catBy = buildByCollection(catFiltered.list, false);
  const marketBy = buildByCollection(marketFiltered.list, true);

  // 4) Сохранить состояние
  state.ts = Date.now();
  state.sourceCatalog = srcCat;
  state.sourceMarket = srcMarket;

  state.raw.catalog = Array.isArray(catalog) ? catalog : [];
  state.raw.market = Array.isArray(marketInline) ? marketInline : [];

  state.normalized.catalog = catFiltered.list;
  state.normalized.market = marketFiltered.list;

  state.byCollection.catalog = catBy;
  state.byCollection.market  = marketBy;

  state.dropStatsLast.catalog = catFiltered.drop;
  state.dropStatsLast.market  = marketFiltered.drop;

  return state;
}

// ======= Public API =======

function getDiagnostics() {
  const firstCat = state.raw.catalog[0] || {};
  const firstMrk = state.raw.market[0]  || {};
  const stickerKeys = firstCat.sticker ? Object.keys(firstCat.sticker) : (firstMrk.sticker ? Object.keys(firstMrk.sticker) : []);

  return {
    ok: true,
    ts: state.ts,
    sources: { catalog: state.sourceCatalog, market: state.sourceMarket },
    counts: {
      raw: { catalog: state.raw.catalog.length, market: state.raw.market.length },
      normalized: { catalog: state.normalized.catalog.length, market: state.normalized.market.length },
      collections: {
        catalog: Object.keys(state.byCollection.catalog).length,
        market: Object.keys(state.byCollection.market).length,
      },
    },
    dropStats: state.dropStatsLast,
    exampleRawKeys: Object.keys(firstCat.id ? firstCat : firstMrk),
    stickerKeys,
    sample: {
      catalog: state.normalized.catalog.slice(0, 3).map(n => ({
        giftId: n.giftId, collectionId: n.collectionId, stars: n.stars, title: n.title
      })),
      market: state.normalized.market.slice(0, 3).map(n => ({
        giftId: n.giftId, collectionId: n.collectionId, marketStars: n.marketStars, stars: n.stars, title: n.title
      })),
    }
  };
}

function getSnapshot() {
  return {
    ok: true,
    ts: state.ts,
    sources: { catalog: state.sourceCatalog, market: state.sourceMarket },
    rawCounts: { catalog: state.raw.catalog.length, market: state.raw.market.length },
    normalizedCounts: { catalog: state.normalized.catalog.length, market: state.normalized.market.length },
  };
}

function getStarsByCollectionAll() {
  return {
    catalogByCollection: state.byCollection.catalog,
    marketByCollection: state.byCollection.market,
  };
}

function getCasePricingAll() {
  // отдельно считаем по каталогу и по маркету (если нужно оценить «стоимость кейса» из маркет-коллекций)
  const catPrices = priceCasesFrom(state.byCollection.catalog);
  const marketPrices = priceCasesFrom(state.byCollection.market);
  return {
    ok: true,
    ts: state.ts,
    sources: { catalog: state.sourceCatalog, market: state.sourceMarket },
    pricing: {
      catalog: catPrices,
      market: marketPrices,
      params: { rtp: ENV.PRICING_RTP, markup: ENV.PRICING_MARKUP, roundStep: ENV.ROUND_STEP }
    }
  };
}

function peek(limit = 20, source = 'all') {
  const L = Math.max(1, Math.min(200, +limit || 20));
  if (source === 'catalog') return state.normalized.catalog.slice(0, L);
  if (source === 'market')  return state.normalized.market.slice(0, L);
  return [...state.normalized.catalog.slice(0, Math.ceil(L/2)), ...state.normalized.market.slice(0, Math.floor(L/2))];
}

// ======= Exports =======
const engine = {
  refresh,
  getDiagnostics,
  getSnapshot,
  getStarsByCollectionAll, // заменяет старый getStarsByCollection: теперь возвращаем и каталог, и маркет
  getCasePricingAll,       // цены для каталога и маркета
  peek
};

module.exports = engine;
module.exports.default = engine;
