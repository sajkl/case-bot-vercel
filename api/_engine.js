// api/_engine.js
// Runtime: Node.js 18 (CommonJS). Централизованный движок цен/кейсов/диагностики.

// ====== ENV & CONSTANTS ======
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE  = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
const GIFTS_SOURCE_URL = process.env.GIFTS_SOURCE_URL || 'https://tg.me/gifts/available_gifts';

// Форсировать публичный источник (игнорируя Bot API)
const FORCE_PUBLIC = String(process.env.FORCE_PUBLIC || '0') === '1';
// Строгая фильтрация: только improved + resale + покупка за ⭐
const STRICT_FILTER = String(process.env.STRICT_FILTER || '1') === '1';

// Период автообновления снапшота с рынка
const REFRESH_MS = 60_000;

// Параметры ценообразования кейсов
const PRICING = {
  rtp: 0.80,            // целевой RTP
  markup: 0.08,         // наценка сверху
  roundStep: 1          // округление до ... (1 = ближайшее целое кол-во ⭐)
};

// (опционально) Разрешить безопасный fallback на 1-й лот (first-floor) с коэффициентом
// Если коллекция имеет только 1 цену за ⭐, можно временно считать её как first-floor * factor,
// чтобы не блокировать кейсы. По умолчанию выключено — используем строгий second-floor.
// Включить — раскомментируйте две строки ниже И блок в priceCase().
/*
const ALLOW_FIRST_FLOOR = true;
const FIRST_FLOOR_FACTOR = 1.15;
*/

// ====== DEFINITIONS: CASES & COLLECTION MAP ======
// Кейсы (читаемые id коллекций) — ниже есть маппинг на реальные collectionId.
// Замените значения в COLLECTION_MAP на реальные ID с /api/snapshot (samples/collections).
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

// Маппинг «локальный ключ → реальный collectionId».
// Замените правую часть на реальные ID из /api/snapshot (samples/collections).
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

// ====== STATE (in-memory cache) ======
const S = globalThis.__ENGINE_STATE__ || {
  ts: 0,                         // timestamp последнего refresh
  lastSource: 'none',            // 'bot' | 'public' | 'demo'
  lastRawCount: 0,               // сколько пришло от источника
  starsItems: [],                // нормализованные лоты (за ⭐)
  secondFloors: new Map(),       // Map<collectionId, { secondFloorStars, hasAtLeastTwo, sampleSorted[] }>
  casePricing: [],               // рассчитанные кейсы
  refreshing: false,
};
globalThis.__ENGINE_STATE__ = S;

// ====== UTILS ======
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
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok || !json || json.ok !== true) {
    const msg = json?.description || text || `HTTP ${r.status}`;
    throw new Error(`${method} failed: ${msg}`);
  }
  return json.result;
}

async function fetchPublicGifts() {
  try {
    const r = await fetch(GIFTS_SOURCE_URL, { headers: { 'Accept':'application/json' } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    // расплющиваем популярные варианты
    let arr =
      (Array.isArray(json) && json) ||
      json?.data?.gifts ||
      json?.gifts ||
      json?.items ||
      json?.available_gifts ||
      json?.list ||
      json?.results || [];
    if (!Array.isArray(arr)) arr = [];
    // лог первых двух для отладки
    if (arr.length) console.log('[engine] public.raw example:', JSON.stringify(arr.slice(0,2)).slice(0,800));
    return arr;
  } catch (e) {
    console.warn('[public gifts] fetch failed:', e?.message || e);
    return [];
  }
}

function extractStars(obj) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj > 0 ? obj : null;
  if (typeof obj === 'string') {
    const m = obj.match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }
  if (typeof obj === 'object') {
    if ((obj.unit === 'stars' || obj.currency === 'stars') && typeof obj.value === 'number') {
      return obj.value > 0 ? obj.value : null;
    }
    if (typeof obj.stars === 'number') return obj.stars > 0 ? obj.stars : null;
    if (typeof obj.price === 'number') return obj.price > 0 ? obj.price : null;
  }
  return null;
}

function isImproved(g){
  return Boolean(
    g?.unique || g?.is_unique || g?.improved || g?.is_improved ||
    (String(g?.kind||'').toLowerCase().includes('upgrad')) ||
    (String(g?.type||'').toLowerCase().includes('upgrad'))
  );
}
function isResale(g){
  return Boolean(
    g?.resale || g?.is_resale ||
    (String(g?.market||'').toLowerCase().includes('resale')) ||
    (String(g?.section||'').toLowerCase().includes('resale')) ||
    (String(g?.sale_type||'').toLowerCase().includes('resale'))
  );
}
function canBuyWithStars(g){
  // явные признаки
  if (g?.purchaseWithStars === true || g?.starsBuyable === true) return true;

  // варианты/опции
  const options = Array.isArray(g?.purchaseOptions) ? g.purchaseOptions
               : Array.isArray(g?.options) ? g.options
               : Array.isArray(g?.variants) ? g.variants : null;
  if (options && options.length) {
    // есть вариант со звёздами?
    const hasStars = options.some(o =>
      (String(o?.currency||o?.unit||'').toLowerCase() === 'stars') ||
      (typeof extractStars(o?.price ?? o?.value) === 'number')
    );
    if (hasStars) return true;
    // все варианты только TON?
    const tonOnly = options.every(o => String(o?.currency||o?.unit||'').toLowerCase() === 'ton');
    if (tonOnly) return false;
  }

  // fallback: min_price/minStars может быть объектом {unit:'stars', value:N}
  const minStars = extractStars(g?.min_price) ?? extractStars(g?.minPrice) ?? extractStars(g?.minStars);
  if (typeof minStars === 'number' && minStars > 0) return true;

  return false;
}

function normalizeGift(g) {
  const giftId = g?.gift_id ?? g?.id ?? g?.uid ?? g?.slug ?? g?.code ?? null;
  const title  = g?.title ?? g?.name ?? g?.label ?? 'Gift';
  const collectionId =
    g?.collection?.id ?? g?.collection_id ?? g?.collectionId ??
    g?.collection ?? g?.set ?? g?.series ?? null;

  // Приоритеты извлечения звёздной цены
  // (а) прямое поле
  let stars = extractStars(g?.price) ?? extractStars(g?.cost) ?? extractStars(g?.stars);

  // (б) из options/variants
  if (stars == null) {
    const opts = Array.isArray(g?.purchaseOptions) ? g.purchaseOptions
               : Array.isArray(g?.options) ? g.options
               : Array.isArray(g?.variants) ? g.variants : null;
    if (opts) {
      const starList = opts
        .filter(o => (String(o?.currency||o?.unit||'').toLowerCase()==='stars') ||
                     (typeof extractStars(o?.price ?? o?.value) === 'number'))
        .map(o => extractStars(o?.price ?? o?.value))
        .filter(v => typeof v === 'number' && v > 0);
      if (starList.length) stars = Math.min(...starList);
    }
  }

  // (в) min_price/minStars
  if (stars == null) {
    stars = extractStars(g?.min_price) ?? extractStars(g?.minPrice) ?? extractStars(g?.minStars);
  }

  const improved = isImproved(g);
  const resale   = isResale(g);
  const starsBuyable = canBuyWithStars(g);

  return {
    giftId,
    title,
    collectionId,
    stars: (typeof stars === 'number' && stars > 0) ? stars : null,
    improved,
    resale,
    starsBuyable,
    raw: g
  };
}

function filterUsable(items) {
  return (items || []).filter(it => {
    if (!it || typeof it.stars !== 'number' || it.stars <= 0) return false;
    if (!it.collectionId || !it.giftId) return false;
    if (!it.starsBuyable) return false;
    if (STRICT_FILTER) {
      // строгий режим: только улучшенные / перепродажа
      return (it.improved === true) || (it.resale === true);
    }
    return true;
  });
}

function buildSecondFloorsByCollection(starItems) {
  const byCol = new Map();
  for (const it of starItems) {
    if (!byCol.has(it.collectionId)) byCol.set(it.collectionId, []);
    byCol.get(it.collectionId).push({ giftId: it.giftId, title: it.title, stars: it.stars });
  }
  const out = new Map();
  for (const [cid, arr] of byCol.entries()) {
    const sorted = arr.slice().sort((a,b)=> a.stars - b.stars);
    const has2 = sorted.length >= 2;
    out.set(cid, {
      hasAtLeastTwo: has2,
      secondFloorStars: has2 ? sorted[1].stars : (sorted[0]?.stars ?? null),
      sampleSorted: sorted.slice(0, 8),
    });
  }
  return out;
}

function priceCase(prizes, floors){
  const rows = prizes.map(p=>{
    const realCol = COLLECTION_MAP[p.collectionId] || p.collectionId;
    const rec = floors.get(realCol);

    let blocked = !(rec && rec.hasAtLeastTwo && typeof rec.secondFloorStars === 'number');
    let value = blocked ? 0 : rec.secondFloorStars;

    // Если хотите first-floor fallback — раскомментируйте ALLOW_FIRST_FLOOR вверху и блок ниже.
    /*
    if (blocked && rec && typeof rec.secondFloorStars === 'number' && rec.secondFloorStars > 0 && ALLOW_FIRST_FLOOR) {
      blocked = false;
      value = Math.ceil(rec.secondFloorStars * FIRST_FLOOR_FACTOR);
    }
    */

    return { id:p.id, label:p.label, collectionId: realCol, weight:(p.weight||0), valueStars:value, blocked };
  });

  const available = rows.filter(r => !r.blocked);
  if (!available.length) {
    return {
      rtp: PRICING.rtp, markup: PRICING.markup,
      evStars: 0, basePrice: 0, finalPrice: 0,
      blockedCollections: rows.map(r=>r.collectionId),
      blockedRatio: 1,
      prizes: rows.map(r => ({ ...r, prob: 0, valueStars: round2(r.valueStars) }))
    };
  }

  const totalW = available.reduce((s,r)=> s + r.weight, 0) || 1;
  const withProb = rows.map(r => ({
    ...r,
    prob: r.blocked ? 0 : (r.weight / totalW)
  }));

  const ev = withProb.reduce((s,r)=> s + (r.blocked ? 0 : r.valueStars * r.prob), 0);
  const base = ev / Math.max(PRICING.rtp, 1e-6);
  const final = roundTo(base * (1 + PRICING.markup), PRICING.roundStep);

  return {
    rtp: PRICING.rtp, markup: PRICING.markup,
    evStars: round2(ev), basePrice: round2(base), finalPrice: final,
    blockedCollections: rows.filter(r=>r.blocked).map(r=>r.collectionId),
    blockedRatio: rows.filter(r=>r.blocked).length / rows.length,
    prizes: withProb.map(r => ({ ...r, prob: round4(r.prob), valueStars: round2(r.valueStars) }))
  };
}

// ====== REFRESH PIPELINE ======
async function refresh() {
  if (S.refreshing) return;
  const now = Date.now();
  if (now - S.ts < REFRESH_MS) return;

  S.refreshing = true;
  try {
    let raw = [];
    let source = 'none';

    // 1) Bot API (если не форсим публичный)
    if (!FORCE_PUBLIC && BOT_TOKEN) {
      try {
        const res = await tgCall('getAvailableGifts');
        const arr =
          (Array.isArray(res) && res) ||
          res?.data?.gifts ||
          res?.gifts ||
          res?.items ||
          res?.available_gifts ||
          res?.list ||
          res?.results || [];
        if (Array.isArray(arr) && arr.length) {
          raw = arr;
          source = 'bot';
          console.log('[engine] bot.items =', arr.length);
        }
      } catch (e) {
        console.warn('[engine] bot getAvailableGifts failed:', e?.message || e);
      if (Array.isArray(arr) && arr.length) {
  raw = arr;
  source = 'bot';

  // 👇 логируем один раз за жизнь процесса, чтобы не засорять логи
  if (!S.__loggedBotExample) {
    console.log('[engine] bot.items =', arr.length);
    // печатаем 1-2 объекта целиком, но обрезаем по длине для безопасности
    const sample = JSON.stringify(arr.slice(0, 2), null, 2);
    console.log('[engine] bot.raw example:', sample.length > 1500 ? sample.slice(0, 1500) + '…(trimmed)' : sample);
    S.__loggedBotExample = true;
  }
}

      }
    }

    // 2) Публичный источник (если bot пуст или принудительно)
    if (!raw.length) {
      const arr = await fetchPublicGifts();
      if (arr.length) {
        raw = arr;
        source = 'public';
        console.log('[engine] public.items =', arr.length);
      }
    }

    // 3) DEMO fallback (только если ничего и раньше тоже пусто)
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
      source = 'demo';
      console.log('[engine] demo.items =', raw.length);
    }

    if (!raw.length) {
      console.warn('[engine] gifts still empty; keeping previous snapshot');
      S.ts = now;
      return;
    }

    // нормализация → фильтрация usable
    const normalized = raw.map(normalizeGift);
    const usable = filterUsable(normalized);

    // построение second-floor по коллекциям
    const floors = buildSecondFloorsByCollection(usable);

    // ценообразование кейсов
    const casePricing = CASES.map(c => ({
      caseId: c.id,
      title: c.title,
      pricing: priceCase(c.prizes, floors),
    }));

    // Save snapshot
    S.ts = now;
    S.lastSource = source;
    S.lastRawCount = raw.length;
    S.starsItems = usable;
    S.secondFloors = floors;
    S.casePricing = casePricing;

    console.log(`[engine] source=${source}, strict=${STRICT_FILTER?1:0}, usable=${usable.length}, cases=${casePricing.length}`);
  } finally {
    S.refreshing = false;
  }
}

// ====== PUBLIC API ======
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

// Демоверсия автопокупки: выбирает самый дешёвый лот в коллекции и отправляет.
// При наличии BOT_TOKEN вызывает sendGift (проверьте фактическое имя метода в Bot API вашей среды).
async function autoBuyAndSend({ collectionId, recipient, payForUpgrade=true }) {
  await refresh();
  if (!collectionId) throw new Error('collectionId required');
  if (!recipient) throw new Error('recipient required (@username or numeric user_id)');

  const list = (S.starsItems || [])
    .filter(x => x.collectionId === collectionId)
    .sort((a,b)=> a.stars - b.stars);

  if (!list.length) throw new Error('No stars-buyable lots right now in this collection');

  const pick = list[0];

  if (!BOT_TOKEN) {
    return { demo:true, sentTo: recipient, giftId: pick.giftId, title: pick.title, priceStars: pick.stars };
  }

  // resolve @username → numeric id (если нужно)
  const userId = /^\d+$/.test(String(recipient))
    ? Number(recipient)
    : (await tgCall('getChat', { chat_id: recipient }))?.id;

  if (!userId) throw new Error('Cannot resolve recipient');

  // Проверьте фактический метод Telegram на отправку gift в вашей среде.
  const out = await tgCall('sendGift', {
    user_id: userId,
    gift_id: pick.giftId,
    pay_for_upgrade: !!payForUpgrade
  });

  return { sentTo: userId, giftId: pick.giftId, title: pick.title, priceStars: pick.stars, raw: out };
}

// ====== DIAGNOSTICS ======
async function getDiagnostics() {
  await refresh();
  const by = {};
  for (const it of S.starsItems) {
    (by[it.collectionId] ||= []).push({ giftId: it.giftId, title: it.title, stars: it.stars });
  }
  const collections = Object.keys(by).sort();
  const samples = {};
  for (const k of collections) {
    by[k].sort((a,b)=> a.stars - b.stars);
    samples[k] = by[k].slice(0, 5);
  }
  return {
    ts: S.ts,
    source: S.lastSource,
    rawCount: S.lastRawCount,
    normalizedCount: S.starsItems.length,
    collections,
    samples
  };
}

async function getPeek(limit=10) {
  await refresh();
  return (S.starsItems || []).slice(0, limit).map(x => ({
    giftId: x.giftId,
    title:  x.title,
    collectionId: x.collectionId,
    stars: x.stars,
    improved: x.improved,
    resale: x.resale,
    starsBuyable: x.starsBuyable
  }));
}

// ====== EXPORTS ======
module.exports = {
  CASES,
  COLLECTION_MAP,
  getCasePricing,
  getStarsByCollection,
  autoBuyAndSend,
  // diagnostics
  getDiagnostics,
  getPeek,
};
