// api/_engine.js
// CommonJS + Node18 fetch
// Источники: (1) Bot API getAvailableGifts → (2) PUBLIC_GIFTS_URL → (3) demo (только если нет старого снапшота)
// Флаги окружения:
//   TELEGRAM_BOT_TOKEN  — токен бота (для bot source)
//   GIFTS_SOURCE_URL    — публичный JSON (по умолчанию https://tg.me/gifts/available_gifts)
//   FORCE_PUBLIC=1      — игнорировать bot и сразу брать public
//   STRICT_FILTER=0/1   — 1 (по умолч.) = только improved+resale+stars; 0 = любой лот, который можно купить за ⭐

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE  = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
const PUBLIC_GIFTS_URL = process.env.GIFTS_SOURCE_URL || 'https://tg.me/gifts/available_gifts';
const FORCE_PUBLIC = String(process.env.FORCE_PUBLIC || '0') === '1';
const STRICT_FILTER = String(process.env.STRICT_FILTER || '1') === '1';

const REFRESH_MS = 60_000;
const PRICING = { rtp: 0.80, markup: 0.08, roundStep: 1 };

// ---- Кейсы (оставьте как есть; подставьте реальные collectionId через COLLECTION_MAP или прямо тут) ----
const CASES = [
  {
    id: 'cheap', title: 'Дешёвый', prizes: [
      { id:'c1', label:'Common UPG',   collectionId:'col-common-a', weight:60 },
      { id:'c2', label:'Common UPG+',  collectionId:'col-common-b', weight:25 },
      { id:'c3', label:'Rare UPG',     collectionId:'col-rare-a',   weight:12 },
      { id:'c4', label:'Epic UPG',     collectionId:'col-epic-a',   weight:3  },
    ]
  },
  {
    id: 'standard', title: 'Средний', prizes: [
      { id:'s1', label:'Common UPG+',  collectionId:'col-common-b', weight:45 },
      { id:'s2', label:'Rare UPG',     collectionId:'col-rare-a',   weight:30 },
      { id:'s3', label:'Rare UPG+',    collectionId:'col-rare-b',   weight:15 },
      { id:'s4', label:'Epic UPG',     collectionId:'col-epic-a',   weight:8  },
      { id:'s5', label:'Legend UPG',   collectionId:'col-legend-a', weight:2  },
    ]
  },
  {
    id: 'expensive', title: 'Дорогой', prizes: [
      { id:'e1', label:'Rare UPG+',    collectionId:'col-rare-b',   weight:35 },
      { id:'e2', label:'Epic UPG',     collectionId:'col-epic-a',   weight:28 },
      { id:'e3', label:'Epic UPG+',    collectionId:'col-epic-b',   weight:20 },
      { id:'e4', label:'Legend UPG',   collectionId:'col-legend-a', weight:12 },
      { id:'e5', label:'Legend UPG+',  collectionId:'col-legend-b', weight:5  },
    ]
  },
  {
    id: 'premium', title: 'Премиум', prizes: [
      { id:'p1', label:'Epic UPG+',    collectionId:'col-epic-b',   weight:30 },
      { id:'p2', label:'Legend UPG',   collectionId:'col-legend-a', weight:25 },
      { id:'p3', label:'Legend UPG+',  collectionId:'col-legend-b', weight:22 },
      { id:'p4', label:'Myth UPG',     collectionId:'col-myth-a',   weight:15 },
      { id:'p5', label:'Ultra UPG',    collectionId:'col-ultra-a',  weight:8  },
    ]
  }
];

// Маппинг «читабельный код» -> реальный collectionId
const COLLECTION_MAP = {
  'col-common-a' : 'tg_collection_common_A',
  'col-common-b' : 'tg_collection_common_B',
  'col-rare-a'   : 'tg_collection_rare_A',
  'col-rare-b'   : 'tg_collection_rare_B',
  'col-epic-a'   : 'tg_collection_epic_A',
  'col-epic-b'   : 'tg_collection_epic_B',
  'col-legend-a' : 'tg_collection_legend_A',
  'col-legend-b' : 'tg_collection_legend_B',
  'col-myth-a'   : 'tg_collection_myth_A',
  'col-ultra-a'  : 'tg_collection_ultra_A',
};

// ------- Кэш (живёт пока инстанс тёплый) -------
const S = globalThis.__ENGINE_STATE__ || {
  ts: 0,
  starsItems: [],
  secondFloors: new Map(),
  casePricing: [],
  refreshing: false,
};
globalThis.__ENGINE_STATE__ = S;

// ---------------- Utils ----------------
function roundTo(n, step){ return Math.round(n/step)*step; }
function round2(n){ return Math.round(n*100)/100; }
function round4(n){ return Math.round(n*10000)/10000; }

async function tgCall(method, params) {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const url = `${API_BASE}/${method}`;
  const init = params ? {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(params)
  } : { method: 'GET' };

  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok || !json || json.ok !== true) {
    const msg = json?.description || text || `HTTP ${r.status}`;
    throw new Error(`${method} failed: ${msg}`);
  }
  return json.result;
}

async function fetchPublicGifts() {
  try {
    const r = await fetch(PUBLIC_GIFTS_URL, { method: 'GET', headers: { 'Accept':'application/json' }});
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return json || {};
  } catch (e) {
    console.warn('[public gifts] fetch failed:', e?.message || e);
    return {};
  }
}

// ---- normalization helpers ----
function extractStars(obj) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'string') { const n = Number(obj.replace(/[^\d.-]/g,'')); return Number.isFinite(n) ? n : null; }
  if (typeof obj === 'object') {
    if (typeof obj.stars === 'number') return obj.stars;
    if (typeof obj.amount === 'number') return obj.amount;
    if (typeof obj.value === 'number' && (obj.currency==='stars' || obj.unit==='stars')) return obj.value;
    if (typeof obj.price === 'number') return obj.price;
  }
  return null;
}
function isImproved(g){
  return Boolean(
    g?.unique || g?.is_unique || g?.improved || g?.is_improved ||
    (String(g?.kind||'').toLowerCase().includes('upgrad'))
  );
}
function isResale(g){
  return Boolean(
    g?.resale || g?.is_resale ||
    (String(g?.market||'').toLowerCase().includes('resale')) ||
    (String(g?.section||'').toLowerCase().includes('resale'))
  );
}
function canBuyWithStars(g){
  const direct = extractStars(g?.price) ?? extractStars(g?.cost) ?? extractStars(g?.stars);
  if (typeof direct === 'number' && direct > 0) return true;

  const options = Array.isArray(g?.purchaseOptions) ? g.purchaseOptions
               : Array.isArray(g?.options) ? g.options
               : Array.isArray(g?.variants) ? g.variants : null;
  if (options && options.length) {
    const hasStars = options.some(o =>
      (String(o?.currency||o?.unit||'').toLowerCase()==='stars') || (typeof extractStars(o?.price) === 'number')
    );
    const tonOnly = options.every(o => String(o?.currency||o?.unit||'').toLowerCase()==='ton');
    if (hasStars) return true;
    if (tonOnly) return false;
  }
  if (String(g?.currency||'').toLowerCase()==='ton' || g?.only_ton === true) return false;
  return false;
}

// --- единый нормализатор карточки
function normalizeGift(g) {
  const giftId = g?.gift_id ?? g?.id ?? g?.uid ?? null;
  const title  = g?.title ?? g?.name ?? g?.label ?? null;

  const stars  = extractStars(g?.price) ?? extractStars(g?.cost) ?? extractStars(g?.stars) ?? null;
  let variantStars = null;
  const options = Array.isArray(g?.purchaseOptions) ? g.purchaseOptions
               : Array.isArray(g?.options) ? g.options
               : Array.isArray(g?.variants) ? g.variants : null;
  if (options) {
    const starList = options
      .filter(o => (String(o?.currency||o?.unit||'').toLowerCase()==='stars') || (typeof extractStars(o?.price) === 'number'))
      .map(o => extractStars(o?.price))
      .filter(v => typeof v === 'number' && v > 0);
    if (starList.length) variantStars = Math.min(...starList);
  }
  const starsPrice = (typeof stars === 'number' && stars > 0) ? stars : variantStars;

  const collectionId   = g?.collection?.id ?? g?.collection_id ?? g?.collectionId ?? null;

  return {
    giftId, title,
    stars: starsPrice ?? null,
    collectionId,
    improved: isImproved(g),
    resale: isResale(g),
    starsBuyable: canBuyWithStars(g),
    raw: g
  };
}

// --- расширенный извлекатель массива из любого формата
function toArrayMaybe(items) {
  if (Array.isArray(items)) return items;
  if (!items || typeof items !== 'object') return [];

  if (Array.isArray(items.gifts)) return items.gifts;
  if (Array.isArray(items.items)) return items.items;
  if (items.data) {
    if (Array.isArray(items.data.gifts)) return items.data.gifts;
    if (Array.isArray(items.data.items)) return items.data.items;
  }
  if (Array.isArray(items.available_gifts)) return items.available_gifts;
  if (Array.isArray(items.list)) return items.list;
  if (Array.isArray(items.results)) return items.results;

  // иногда ответ бывает вида {collections:[{gifts:[...]}, ...]}
  if (Array.isArray(items.collections)) {
    const flat = [];
    for (const c of items.collections) {
      if (Array.isArray(c?.gifts)) flat.push(...c.gifts);
      if (Array.isArray(c?.items)) flat.push(...c.items);
    }
    return flat;
  }

  return [];
}

// --- выборка «за ⭐» с учетом режима STRICT_FILTER
function selectStarsImprovedResale(items) {
  const arr = toArrayMaybe(items);
  return arr
    .map(normalizeGift)
    .filter(x => {
      const okStars = x.giftId && x.collectionId && x.starsBuyable && typeof x.stars === 'number' && x.stars > 0;
      if (!okStars) return false;
      if (!STRICT_FILTER) return true;
      return x.improved && x.resale; // строгий режим (по умолчанию)
    });
}

function buildSecondFloorsByCollection(starItems) {
  const byCol = new Map();
  for (const it of starItems) {
    if (!byCol.has(it.collectionId)) byCol.set(it.collectionId, []);
    byCol.get(it.collectionId).push({ giftId: it.giftId, stars: it.stars, title: it.title });
  }
  const result = new Map();
  for (const [cid, arr] of byCol.entries()) {
    const sorted = arr.slice().sort((a,b)=> a.stars - b.stars);
    const has2 = sorted.length >= 2;
    result.set(cid, {
      hasAtLeastTwo: has2,
      secondFloorStars: has2 ? sorted[1].stars : (sorted[0]?.stars ?? null),
      sampleSorted: sorted.slice(0, 8),
    });
  }
  return result;
}

// — цена кейса: игнорируем заблокированные коллекции, нормализуем веса по доступным
function priceCase(prizes, floors){
  const detailsRaw = prizes.map(p=>{
    const real = COLLECTION_MAP[p.collectionId] || p.collectionId;
    const rec  = floors.get(real);
    const blocked = !(rec && rec.hasAtLeastTwo && typeof rec.secondFloorStars==='number');
    const value  = blocked ? 0 : rec.secondFloorStars;
    return { id:p.id, label:p.label, collectionId: real, weight:(p.weight||0), valueStars:value, blocked };
  });

  const available = detailsRaw.filter(d => !d.blocked);
  if (!available.length) {
    return {
      rtp: PRICING.rtp, markup: PRICING.markup,
      evStars: 0, basePrice: 0, finalPrice: 0,
      blockedCollections: detailsRaw.map(d=>d.collectionId),
      blockedRatio: 1,
      prizes: detailsRaw.map(d => ({ ...d, prob: 0, valueStars: round2(d.valueStars) }))
    };
  }

  const totalW = available.reduce((s,d)=> s + d.weight, 0) || 1;
  const details = detailsRaw.map(d => ({
    ...d,
    prob: d.blocked ? 0 : (d.weight / totalW)
  }));

  const ev   = details.reduce((s,p)=> s + (p.blocked ? 0 : p.valueStars * p.prob), 0);
  const base = ev / Math.max(PRICING.rtp, 1e-6);
  const final = roundTo(base * (1 + PRICING.markup), PRICING.roundStep);

  return {
    rtp: PRICING.rtp, markup: PRICING.markup,
    evStars: round2(ev), basePrice: round2(base), finalPrice: final,
    blockedCollections: detailsRaw.filter(d=>d.blocked).map(d=>d.collectionId),
    blockedRatio: detailsRaw.filter(d=>d.blocked).length / detailsRaw.length,
    prizes: details.map(d => ({ ...d, prob: round4(d.prob), valueStars: round2(d.valueStars) }))
  };
}

// --------------- Refresh ---------------
async function refresh() {
  if (S.refreshing) return;
  const now = Date.now();
  if (now - S.ts < REFRESH_MS) return;

  S.refreshing = true;
  try {
    let raw = [];
    let used = 'none';

    // FORCE_PUBLIC — сразу идём в публичный источник
    if (!FORCE_PUBLIC && BOT_TOKEN) {
      try {
        const r = await tgCall('getAvailableGifts');
        const arr = toArrayMaybe(r);
        console.log(`[engine] bot items=${arr.length}`);
        if (arr.length) {
          raw = arr;
          used = 'bot';
        }
      } catch (e) {
        console.warn('[engine] bot getAvailableGifts failed:', e?.message || e);
      }
    }

    // public fallback (или основной, если FORCE_PUBLIC=1)
    if (!raw.length && PUBLIC_GIFTS_URL) {
      const r = await fetchPublicGifts();
      const arr = toArrayMaybe(r);
      console.log(`[engine] public items=${arr.length}`);
      if (arr.length) {
        raw = arr;
        used = 'public';
      }
    }

    // demo (только если вообще ничего и раньше тоже пусто)
    if (!raw.length && (!S.starsItems || !S.starsItems.length)) {
      raw = [
        { id:'g1',  title:'Demo Common',    collection:{id:'tg_collection_common_A'}, price:{stars:5},  improved:true, resale:true },
        { id:'g2',  title:'Demo Common+',   collection:{id:'tg_collection_common_A'}, price:{stars:6},  improved:true, resale:true },
        { id:'g7',  title:'Demo Common B',  collection:{id:'tg_collection_common_B'}, price:{stars:8},  improved:true, resale:true },
        { id:'g8',  title:'Demo Common B+', collection:{id:'tg_collection_common_B'}, price:{stars:9},  improved:true, resale:true },
        { id:'g3',  title:'Demo Rare',      collection:{id:'tg_collection_rare_A'},  price:{stars:12}, improved:true, resale:true },
        { id:'g4',  title:'Demo Epic',      collection:{id:'tg_collection_epic_A'},  price:{stars:25}, improved:true, resale:true },
        { id:'g5',  title:'Demo Epic B',    collection:{id:'tg_collection_epic_B'},  price:{stars:34}, improved:true, resale:true },
        { id:'g6',  title:'Demo Legend',    collection:{id:'tg_collection_legend_A'},price:{stars:60}, improved:true, resale:true },
      ];
      used = 'demo';
    }

    if (!raw.length) {
      console.warn('[engine] gifts still empty; keeping previous snapshot');
      S.ts = now;
      return;
    }

    const starsItems = selectStarsImprovedResale(raw);
    const floors = buildSecondFloorsByCollection(starsItems);
    const casePricing = CASES.map(c => ({
      caseId: c.id,
      title: c.title,
      pricing: priceCase(c.prizes, floors),
    }));

    S.ts = now;
    S.starsItems = starsItems;
    S.secondFloors = floors;
    S.casePricing = casePricing;

    console.log(`[engine] used=${used}, strict=${STRICT_FILTER ? 1 : 0}, items=${starsItems.length}, cases=${casePricing.length}`);
  } finally {
    S.refreshing = false;
  }
}

// --------------- Public API ---------------
async function getCasePricing() {
  await refresh();
  return S.casePricing || [];
}
async function getStarsByCollection() {
  await refresh();
  const by = {};
  for (const it of S.starsItems) {
    (by[it.collectionId] ||= []).push({ giftId: it.giftId, title: it.title, stars: it.stars });
  }
  for (const k of Object.keys(by)) by[k].sort((a,b)=> a.stars - b.stars);
  return by;
}
async function autoBuyAndSend({ collectionId, recipient, payForUpgrade=true }) {
  await refresh();
  if (!collectionId) throw new Error('collectionId required');
  if (!recipient) throw new Error('recipient required (@username or numeric user_id)');

  const list = (S.starsItems || []).filter(x => x.collectionId === collectionId).sort((a,b)=> a.stars - b.stars);
  if (!list.length) throw new Error('No stars-buyable lots right now in this collection');

  const pick = list[0];

  if (!BOT_TOKEN) {
    return { demo:true, sentTo: recipient, giftId: pick.giftId, title: pick.title, priceStars: pick.stars };
  }

  const userId = /^\d+$/.test(String(recipient))
    ? Number(recipient)
    : (await tgCall('getChat', { chat_id: recipient }))?.id;

  if (!userId) throw new Error('Cannot resolve recipient');

  // скорректируй метод под свою среду, если отличается
  const out = await tgCall('sendGift', {
    user_id: userId,
    gift_id: pick.giftId,
    pay_for_upgrade: !!payForUpgrade
  });

  return { sentTo: userId, giftId: pick.giftId, title: pick.title, priceStars: pick.stars, raw: out };
}

module.exports = {
  CASES,
  COLLECTION_MAP,
  getCasePricing,
  getStarsByCollection,
  autoBuyAndSend,
};

