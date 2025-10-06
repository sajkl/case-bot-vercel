// Telegram Case-Bot Engine with Marketplace support (safe, backward-compatible)
// Node.js 20.x, CommonJS

'use strict';

const fetch = global.fetch;

const ENV = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '',
  FORCE_PUBLIC: process.env.FORCE_PUBLIC === '1',

  STRICT_FILTER: process.env.STRICT_FILTER === '1',
  ALLOW_SYNTH_COLLECTION: process.env.ALLOW_SYNTH_COLLECTION !== '0',
  ALLOW_FIRST_FLOOR: process.env.ALLOW_FIRST_FLOOR !== '0',
  FIRST_FLOOR_FACTOR: parseFloat(process.env.FIRST_FLOOR_FACTOR || '1.15'),

  GIFTS_SOURCE_URL: process.env.GIFTS_SOURCE_URL || 'https://tg.me/gifts/available_gifts',
  MARKET_ENABLED: process.env.MARKET_ENABLED !== '0',
  MARKET_SOURCE: (process.env.MARKET_SOURCE || 'auto').toLowerCase(), // auto|public|both
  GIFTS_MARKET_URL: process.env.GIFTS_MARKET_URL || '',

  PRICING_RTP: parseFloat(process.env.PRICING_RTP || '0.80'),
  PRICING_MARKUP: parseFloat(process.env.PRICING_MARKUP || '0.08'),
  ROUND_STEP: Math.max(0.01, parseFloat(process.env.ROUND_STEP || '1')),

  COLLECTION_MAP_JSON: process.env.COLLECTION_MAP_JSON || '',
};

const state = {
  ts: 0,
  sourceCatalog: 'none',
  sourceMarket: 'none',
  raw: { catalog: [], market: [] },
  normalized: { catalog: [], market: [] },
  byCollection: { catalog: {}, market: {} },
  dropStatsLast: { catalog: null, market: null },
};

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${t.slice(0,200)}`);
  }
  return r.json();
}
function pick(...vals){ for (const v of vals) if (v!==undefined && v!==null) return v; }

async function fetchBot(method) {
  if (!ENV.BOT_TOKEN) throw new Error('No TELEGRAM_BOT_TOKEN/BOT_TOKEN');
  const url = `https://api.telegram.org/bot${ENV.BOT_TOKEN}/${method}`;
  const j = await fetchJson(url);
  if (j.ok === false) throw new Error(j.description || 'Bot API error');
  return j.result?.gifts || j.result?.items || j.result?.list || j.result || [];
}
async function fetchPublicCatalog() {
  const j = await fetchJson(ENV.GIFTS_SOURCE_URL);
  return j?.gifts || j?.items || j?.list || (Array.isArray(j) ? j : []);
}
async function fetchPublicMarket() {
  if (!ENV.GIFTS_MARKET_URL) return [];
  const j = await fetchJson(ENV.GIFTS_MARKET_URL);
  return j?.market || j?.resale || j?.items || j?.list || (Array.isArray(j) ? j : []);
}

function extractStars(g){
  const direct = pick(g.stars, g.star_count, g.price_star_count, g.value_stars);
  if (typeof direct === 'number' && direct>0) return direct;
  const prices = g.prices || g.variants || g.options;
  if (Array.isArray(prices)){
    const found = prices.map(p=>{
      const unit=(p.unit||p.currency||'').toString().toLowerCase();
      const val = pick(p.value,p.amount,p.star_count,p.stars);
      if (unit==='stars' && typeof val==='number' && val>0) return val;
    }).filter(Boolean).sort((a,b)=>a-b);
    if (found.length) return found[0];
  }
  const price = g.price || g.cost || g.lowest_price || g.min_price;
  if (price && typeof price==='object'){
    const unit=(price.unit||price.currency||'').toString().toLowerCase();
    const val = pick(price.value,price.amount,price.star_count,price.stars);
    if (unit==='stars' && typeof val==='number' && val>0) return val;
  }
}
function extractMarketStars(g){
  const direct = pick(g.sale_price_stars,g.market_price_stars,g.resale_price_stars,g.saleStars,g.marketStars,g.resaleStars);
  if (typeof direct==='number' && direct>0) return direct;
  const price = g.sale_price || g.market_price || g.resale_price;
  if (price && typeof price==='object'){
    const unit=(price.unit||price.currency||'').toString().toLowerCase();
    const val = pick(price.value,price.amount,price.star_count,price.stars);
    if (unit==='stars' && typeof val==='number' && val>0) return val;
  }
  const prices = g.sale_options || g.market_options || g.resale_options;
  if (Array.isArray(prices)){
    const found = prices.map(p=>{
      const unit=(p.unit||p.currency||'').toString().toLowerCase();
      const val = pick(p.value,p.amount,p.star_count,p.stars);
      if (unit==='stars' && typeof val==='number' && val>0) return val;
    }).filter(Boolean).sort((a,b)=>a-b);
    if (found.length) return found[0];
  }
  const stars = extractStars(g);
  if (detectResale(g) && typeof stars==='number' && stars>0) return stars;
}
function extractCollectionId(g){
  const direct = pick(
    g.collectionId,g.collection_id,g.set_id,g.setId,g.collection?.id,
    g.sticker?.set_name,g.sticker?.setName,g.sticker_set_name,
    g.sticker?.set?.name,g.sticker?.emoji_set?.name
  );
  if (direct) return String(direct);
  if (ENV.ALLOW_SYNTH_COLLECTION){
    const fid = g.sticker?.file_unique_id || g.sticker?.file_id;
    if (fid) return `synth:fuid:${String(fid).slice(0,16)}`;
    const sc = pick(g.star_count,g.stars);
    if (typeof sc==='number' && sc>0) return `synth:stars:${sc}`;
    if (g.id) return `synth:id:${String(g.id).slice(0,12)}`;
  }
}
function detectResale(g){
  const t=[g.type,g.kind,g.section,g.category,g.sale_type,g.saleType,g.market_type]
    .map(x=>(x||'').toString().toLowerCase()).join(' ');
  if (t.includes('resale')||t.includes('sale')||t.includes('market')) return true;
  if (g.is_resale===true || g.resale===true) return true;
  return false;
}
function isExplicitlyNotBuyable(g){
  if (g.buyable===false) return true;
  if (g.can_purchase===false) return true;
  if (g.can_buy_with_stars===false) return true;
  if (g.is_available===false) return true;
  const rc = pick(g.remaining_count,g.remainingCount);
  if (rc===0) return true;
  return false;
}
function isBuyableForStars(g,stars){ return !!(stars>0) && !isExplicitlyNotBuyable(g); }

function normalizeCatalogGift(g){
  const stars = extractStars(g);
  return {
    market:false,
    giftId: pick(g.giftId,g.id,g.gift_id,g.uid,g.uuid,g.slug),
    collectionId: extractCollectionId(g),
    stars: stars||0,
    marketStars: undefined,
    starsBuyable: isBuyableForStars(g, stars||0),
    improved: !!(g.improved||g.is_improved),
    resale: detectResale(g),
    title: pick(g.title,g.name,g.text,(g.sticker?.emoji && `Sticker ${g.sticker.emoji}`)),
    raw:g,
  };
}
function normalizeMarketItem(g){
  const mStars = extractMarketStars(g);
  const stars = extractStars(g);
  const price = mStars || stars || 0;
  return {
    market:true,
    giftId: pick(g.giftId,g.id,g.gift_id,g.uid,g.uuid,g.slug),
    collectionId: extractCollectionId(g),
    stars: price,
    marketStars: mStars || stars || 0,
    starsBuyable: price>0 && !isExplicitlyNotBuyable(g),
    improved: !!(g.improved||g.is_improved),
    resale: true,
    title: pick(g.title,g.name,g.text,(g.sticker?.emoji && `Sticker ${g.sticker.emoji}`)),
    raw:g,
  };
}

function filterUsable(items, strictMode, isMarket){
  const out=[]; const drop={noGiftId:0,noCollection:0,noStars:0,notBuyable:0,strict:0};
  for (const g of (Array.isArray(items)?items:[])){
    const n = isMarket ? normalizeMarketItem(g) : normalizeCatalogGift(g);
    if (!n.collectionId && ENV.ALLOW_SYNTH_COLLECTION) n.collectionId = extractCollectionId(g);

    if (!n.giftId){ drop.noGiftId++; continue; }
    if (!n.collectionId){ drop.noCollection++; continue; }
    if (!n.stars || n.stars<=0){ drop.noStars++; continue; }
    if (!n.starsBuyable && !isMarket){ drop.notBuyable++; continue; }
    if (strictMode && !(n.improved||n.resale)){ drop.strict++; continue; }

    out.push(n);
  }
  const key = isMarket ? (x=>x.marketStars||x.stars) : (x=>x.stars);
  out.sort((a,b)=> key(a)-key(b));
  return { list: out, drop };
}
function buildByCollection(list, isMarket){
  const by={};
  for (const n of list){
    if (!by[n.collectionId]) by[n.collectionId]=[];
    const entry={ giftId:n.giftId, title:n.title, stars:n.stars };
    if (isMarket) entry.marketStars=n.marketStars;
    by[n.collectionId].push(entry);
  }
  return by;
}

function roundStep(x, step){ return (!step||step<=0) ? Math.round(x) : Math.round(x/step)*step; }
function priceCasesFrom(byCollection){
  const results=[];
  for (const [cid,arr] of Object.entries(byCollection)){
    const prices=[...new Set(arr.map(x=>x.stars))].sort((a,b)=>a-b);
    if (!prices.length) continue;
    const floor=prices[0];
    const second = prices[1] || (ENV.ALLOW_FIRST_FLOOR ? Math.ceil(floor*ENV.FIRST_FLOOR_FACTOR) : null);
    if (!second) continue;
    const ev=second;
    const raw=ev*ENV.PRICING_RTP*(1+ENV.PRICING_MARKUP);
    const final=roundStep(raw, ENV.ROUND_STEP);
    results.push({ collectionId:cid, floor, second, casePrice:final, ev });
  }
  return results.sort((a,b)=>a.casePrice-b.casePrice);
}

async function refresh(){
  let catalog=[]; let marketInline=[]; let srcCat='none'; let srcMarket='none';

  try{
    if (!ENV.FORCE_PUBLIC){ catalog = await fetchBot('getAvailableGifts'); srcCat='bot'; }
  }catch(_){}
  if (!catalog.length){
    try{ catalog = await fetchPublicCatalog(); srcCat='public'; }catch(_){ catalog=[]; srcCat='none'; }
  }

  if (ENV.MARKET_ENABLED){
    try{
      if (ENV.MARKET_SOURCE==='auto' || ENV.MARKET_SOURCE==='both'){
        marketInline = (Array.isArray(catalog)?catalog:[]).filter(detectResale);
        if (marketInline.length) srcMarket='inline';
      }
      if ((ENV.MARKET_SOURCE==='public' || ENV.MARKET_SOURCE==='both') && ENV.GIFTS_MARKET_URL){
        const marketPublic = await fetchPublicMarket();
        const unified=[...marketInline,...marketPublic];
        const seen=new Set(); const merged=[];
        for (const it of unified){
          const k = pick(it.id,it.gift_id,it.slug,it.uid) || JSON.stringify(it).slice(0,64);
          if (seen.has(k)) continue; seen.add(k); merged.push(it);
        }
        marketInline=merged;
        srcMarket = marketPublic.length ? 'public' : (marketInline.length ? 'inline' : 'none');
      }
    }catch(_){ srcMarket = marketInline.length ? 'inline' : 'none'; }
  }

  const catFiltered = filterUsable(catalog, ENV.STRICT_FILTER, false);
  const mrkFiltered = filterUsable(marketInline, false, true);

  state.ts = Date.now();
  state.sourceCatalog = srcCat;
  state.sourceMarket = srcMarket;
  state.raw.catalog = Array.isArray(catalog)?catalog:[];
  state.raw.market  = Array.isArray(marketInline)?marketInline:[];
  state.normalized.catalog = catFiltered.list;
  state.normalized.market  = mrkFiltered.list;
  state.byCollection.catalog = buildByCollection(catFiltered.list,false);
  state.byCollection.market  = buildByCollection(mrkFiltered.list,true);
  state.dropStatsLast.catalog = catFiltered.drop;
  state.dropStatsLast.market  = mrkFiltered.drop;

  return state;
}

// ---------- Public API ----------
function getDiagnostics(){
  const first = state.raw.catalog[0] || state.raw.market[0] || {};
  const stickerKeys = first.sticker ? Object.keys(first.sticker) : [];
  return {
    ok:true,
    ts: state.ts,
    sources: { catalog: state.sourceCatalog, market: state.sourceMarket },
    counts: {
      raw: { catalog: state.raw.catalog.length, market: state.raw.market.length },
      normalized: { catalog: state.normalized.catalog.length, market: state.normalized.market.length },
      collections: { catalog: Object.keys(state.byCollection.catalog).length, market: Object.keys(state.byCollection.market).length }
    },
    dropStats: state.dropStatsLast,
    exampleRawKeys: Object.keys(first),
    stickerKeys,
    sample: {
      catalog: state.normalized.catalog.slice(0,3),
      market:  state.normalized.market.slice(0,3)
    }
  };
}
function getSnapshot(){
  return {
    ok:true, ts: state.ts,
    sources: { catalog: state.sourceCatalog, market: state.sourceMarket },
    rawCounts: { catalog: state.raw.catalog.length, market: state.raw.market.length },
    normalizedCounts: { catalog: state.normalized.catalog.length, market: state.normalized.market.length }
  };
}
function getStarsByCollectionAll(){ return { catalogByCollection: state.byCollection.catalog, marketByCollection: state.byCollection.market }; }
function getCasePricingAll(){
  return {
    ok:true, ts: state.ts, sources: { catalog: state.sourceCatalog, market: state.sourceMarket },
    pricing: {
      catalog: priceCasesFrom(state.byCollection.catalog),
      market:  priceCasesFrom(state.byCollection.market),
      params: { rtp: ENV.PRICING_RTP, markup: ENV.PRICING_MARKUP, roundStep: ENV.ROUND_STEP }
    }
  };
}
function peek(limit=20, source='all'){
  const L=Math.max(1,Math.min(200,+limit||20));
  if (source==='catalog') return state.normalized.catalog.slice(0,L);
  if (source==='market')  return state.normalized.market.slice(0,L);
  return [
    ...state.normalized.catalog.slice(0, Math.ceil(L/2)),
    ...state.normalized.market.slice(0, Math.floor(L/2))
  ];
}

// ---------- Backward compatibility (old method names) ----------
function getStarsByCollection(){ return state.byCollection.catalog; } // legacy
function getCasePricing(){ return priceCasesFrom(state.byCollection.catalog); } // legacy

const engine = {
  refresh,
  getDiagnostics,
  getSnapshot,
  getStarsByCollectionAll,
  getCasePricingAll,
  getStarsByCollection,   // legacy
  getCasePricing,         // legacy
  peek,
};
module.exports = engine;
module.exports.default = engine;
