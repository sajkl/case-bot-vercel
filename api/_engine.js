// api/_engine.js
// Общая логика: опрос getAvailableGifts, фильтр (improved+resale+за ⭐),
// second-floor (2-я снизу цена в ⭐), цена кейсов = EV/0.8 * 1.08, кэш 60с.
// + авто-покупка и отправка через sendGift.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set (Vercel env var required).');
}
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const REFRESH_MS = 60_000;

const PRICING = { rtp: 0.80, markup: 0.08, roundStep: 1 };

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
  },
];

// 👉 Сопоставление «наших» кодов с реальными Telegram collectionId.
// Временно стоят заглушки — ЗАМЕНИ на реальные ID коллекций из /api/gifts/stars
// (см. endpoint ниже). Эти ID — те, что возвращает getAvailableGifts в поле collection.id
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

const State = {
  ts: 0,
  raw: [],
  starsItems: [],
  secondFloors: new Map(),
  casePricing: [],
  refreshing: false,
};

function roundTo(n, step){ return Math.round(n/step)*step; }
function round2(n){ return Math.round(n*100)/100; }
function round4(n){ return Math.round(n*10000)/10000; }

async function tgGet(method, params=null) {
  if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  const url = `${API_BASE}/${method}`;
  const init = params ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(params) } : {};
  const r = await fetch(url, init);
  const t = await r.text();
  let json=null; try{ json=JSON.parse(t); }catch(_){}
  if (!r.ok || !json || json.ok!==true) throw new Error(json?.description || t || `HTTP ${r.status}`);
  return json.result;
}

function extractStars(obj) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'string') { const n = Number(obj.replace(/[^\d.-]/g,'')); return Number.isFinite(n)?n:null; }
  if (typeof obj === 'object') {
    if (typeof obj.stars==='number') return obj.stars;
    if (typeof obj.amount==='number') return obj.amount;
    if (typeof obj.value==='number' && (obj.currency==='stars'||obj.unit==='stars')) return obj.value;
  }
  return null;
}
function isImproved(g){ return Boolean(g?.unique||g?.is_unique||g?.improved||g?.is_improved||(g?.kind||'').toLowerCase().includes('upgrad')); }
function isResale(g){ return Boolean(g?.resale||g?.is_resale||(g?.market||'').toLowerCase().includes('resale')||(g?.section||'').toLowerCase().includes('resale')); }
function canBuyWithStars(g){
  const direct = extractStars(g?.price) ?? extractStars(g?.cost) ?? extractStars(g?.stars);
  if (typeof direct==='number' && direct>0) return true;
  const options = Array.isArray(g?.purchaseOptions)?g.purchaseOptions : Array.isArray(g?.options)?g.options : Array.isArray(g?.variants)?g.variants : null;
  if (options && options.length) {
    const hasStars = options.some(o => (o?.currency||'').toLowerCase()==='stars' || (o?.unit||'').toLowerCase()==='stars' || typeof extractStars(o?.price)==='number');
    const tonOnly = options.every(o => (o?.currency||'').toLowerCase()==='ton' || (o?.unit||'').toLowerCase()==='ton');
    if (hasStars) return true;
    if (tonOnly) return false;
  }
  if ((g?.currency||'').toLowerCase()==='ton' || g?.only_ton===true) return false;
  return false;
}
function normalizeGift(g){
  const giftId = g?.gift_id ?? g?.id ?? g?.uid ?? null;
  const title  = g?.title ?? g?.name ?? g?.label ?? null;
  const stars  = extractStars(g?.price) ?? extractStars(g?.cost) ?? extractStars(g?.stars) ?? null;
  const collectionId   = g?.collection?.id ?? g?.collection_id ?? null;
  const collectionName = g?.collection?.name ?? g?.collection_name ?? null;

  let variantStars = null;
  const options = Array.isArray(g?.purchaseOptions)?g.purchaseOptions : Array.isArray(g?.options)?g.options : Array.isArray(g?.variants)?g.variants : null;
  if (options) {
    const starOptions = options.filter(o=> (o?.currency||'').toLowerCase()==='stars'||(o?.unit||'').toLowerCase()==='stars' || typeof extractStars(o?.price)==='number')
                               .map(o=> extractStars(o?.price))
                               .filter(v=> typeof v==='number' && v>0);
    if (starOptions.length) variantStars = Math.min(...starOptions);
  }
  const starsPrice = (typeof stars==='number' && stars>0) ? stars : variantStars;

  return {
    giftId, title, stars: starsPrice ?? null,
    collectionId, collectionName,
    improved: isImproved(g), resale: isResale(g),
    starsBuyable: canBuyWithStars(g),
    raw: g
  };
}
function selectStarsImprovedResale(items){
  return items.map(normalizeGift).filter(x =>
    x.giftId && x.collectionId && x.improved && x.resale && x.starsBuyable &&
    typeof x.stars==='number' && x.stars>0
  );
}
function buildSecondFloorsByCollection(starItems){
  const byCol = new Map();
  for (const it of starItems) {
    if (!byCol.has(it.collectionId)) byCol.set(it.collectionId, []);
    byCol.get(it.collectionId).push({ giftId: it.giftId, stars: it.stars, title: it.title });
  }
  const result = new Map();
  for (const [cid, arr] of byCol.entries()) {
    const sorted = arr.slice().sort((a,b)=> a.stars-b.stars);
    const has2 = sorted.length>=2;
    result.set(cid, { hasAtLeastTwo: has2, blocked: !has2, secondFloorStars: has2 ? sorted[1].stars : (sorted[0]?.stars ?? null), sampleSorted: sorted.slice(0,8) });
  }
  return result;
}
function priceCase(prizes, floors){
  const total = prizes.reduce((s,p)=> s+(p.weight||0), 0) || 1;
  const details = prizes.map(p=>{
    const real = COLLECTION_MAP[p.collectionId] || p.collectionId;
    const rec  = floors.get(real);
    const blocked = !(rec && rec.hasAtLeastTwo && typeof rec.secondFloorStars==='number');
    const value  = blocked ? 0 : rec.secondFloorStars;
    return { id:p.id, label:p.label, collectionId: real, prob:(p.weight||0)/total, valueStars:value, blocked };
  });
  const ev = details.reduce((s,p)=> s + p.valueStars*p.prob, 0);
  const base  = ev / Math.max(PRICING.rtp, 1e-6);
  let final   = roundTo(base * (1+PRICING.markup), PRICING.roundStep);
  return {
    rtp:PRICING.rtp, markup:PRICING.markup,
    evStars: round2(ev), basePrice: round2(base), finalPrice: final,
    blockedCollections: details.filter(d=>d.blocked).map(d=>d.collectionId),
    blockedRatio: details.filter(d=>d.blocked).length / details.length,
    prizes: details.map(d => ({ ...d, prob: round4(d.prob), valueStars: round2(d.valueStars) }))
  };
}

async function refreshIfNeeded() {
  const now = Date.now();
  if (State.refreshing) return;
  if (now - State.ts < REFRESH_MS) return;

  State.refreshing = true;
  try{
    const raw = await tgGet('getAvailableGifts');
    const starItems = selectStarsImprovedResale(raw);
    const floors = buildSecondFloorsByCollection(starItems);
    const casePricing = CASES.map(c => ({ caseId: c.id, title:c.title, pricing: priceCase(c.prizes, floors) }));

    State.ts = now;
    State.raw = raw;
    State.starsItems = starItems;
    State.secondFloors = floors;
    State.casePricing = casePricing;
  } finally {
    State.refreshing = false;
  }
}

async function getCasePricing(){ await refreshIfNeeded(); return State.casePricing; }
async function getStarsByCollection(){
  await refreshIfNeeded();
  const by = {};
  for (const it of State.starsItems) { (by[it.collectionId] ||= []).push({ giftId: it.giftId, title: it.title, stars: it.stars }); }
  for (const k of Object.keys(by)) by[k].sort((a,b)=> a.stars-b.stars);
  return by;
}

async function resolveRecipientId(recipient){
  if (!recipient) throw new Error('recipient required');
  if (/^\d+$/.test(String(recipient))) return Number(recipient);
  const chat = await tgGet('getChat', { chat_id: recipient });
  if (!chat || !chat.id) throw new Error('Cannot resolve recipient');
  return chat.id;
}
async function autoBuyAndSend({ collectionId, recipient, payForUpgrade=true }){
  await refreshIfNeeded();
  const list = State.starsItems.filter(x => x.collectionId===collectionId).sort((a,b)=> a.stars-b.stars);
  if (!list.length) throw new Error('No stars-buyable lots now');
  const pick = list[0];
  const userId = await resolveRecipientId(recipient);
  const out = await tgGet('sendGift', { user_id: userId, gift_id: pick.giftId, pay_for_upgrade: !!payForUpgrade });
  return { sentTo:userId, giftId:pick.giftId, title:pick.title, priceStars:pick.stars, raw: out };
}

module.exports = {
  CASES, COLLECTION_MAP,
  getCasePricing, getStarsByCollection, autoBuyAndSend,
};
export async function getGiftCollections() {
  // Здесь будет запрос к Telegram API /availableGifts
  // Пока демо-версия с фейковыми коллекциями:
  return [
    {
      id: 'col-basic',
      name: 'Бюджетная коллекция',
      gifts: [
        { name: 'Сердце', priceStars: 5 },
        { name: 'Цветок', priceStars: 7 },
        { name: 'Кофе', priceStars: 9 },
      ]
    },
    {
      id: 'col-mid',
      name: 'Средняя коллекция',
      gifts: [
        { name: 'Котик', priceStars: 15 },
        { name: 'Звезда', priceStars: 17 },
        { name: 'Букет', priceStars: 19 },
      ]
    },
    {
      id: 'col-rare',
      name: 'Редкая коллекция',
      gifts: [
        { name: 'Дракон', priceStars: 30 },
        { name: 'Ракета', priceStars: 32 },
        { name: 'Сова', priceStars: 35 },
      ]
    },
    {
      id: 'col-ultra',
      name: 'Эпическая коллекция',
      gifts: [
        { name: 'Коронка', priceStars: 70 },
        { name: 'Молния', priceStars: 72 },
        { name: 'Феникс', priceStars: 80 },
      ]
    },
  ];
}

export async function updateCasePrices(giftCollections) {
  // Используем твою формулу с RTP=0.8 и +8% маржой
  const cases = giftCollections.map((col) => {
    const sorted = col.gifts
      .filter(g => typeof g.priceStars === 'number')
      .sort((a, b) => a.priceStars - b.priceStars);

    const gift = sorted[1] || sorted[0]; // вторая по низкой цене
    const base = gift.priceStars || 10;
    const casePrice = Math.round(base / 0.8 * 1.08);

    return {
      id: col.id,
      title: col.name,
      baseGift: gift.name,
      casePriceStars: casePrice,
      gifts: sorted,
    };
  });

  return cases;
}
