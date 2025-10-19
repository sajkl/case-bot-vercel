// api/open.js
// POST /api/open
// body: { caseId: "lite"|"starter"|"pro"|"ultra" | "jiga"|"camry"|"bmw"|"lambo" }
// resp: { prize: { id, label, emoji?, rarity, weight?, starsValue? } }

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ---- чтение и нормализация caseId ----
  // (на случай, если body придёт строкой — безопасно распарсим)
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const rawCaseId = (body.caseId || '').toString().trim();

  // фронтовые алиасы → серверные id
  const ALIAS = {
    jiga:  'lite',
    camry: 'starter',
    bmw:   'pro',
    lambo: 'ultra',
  };
  const caseId = ALIAS[rawCaseId] || rawCaseId;
  if (!caseId) return res.status(400).json({ error: 'Missing caseId' });

  // ----- все кейсы -----
  const CASES = {
    lite: {
      prizes: [
        { id: 'l1', label: 'Стикер мини',        emoji: '🐾', rarity: 'common',    weight: 55 },
        { id: 'l2', label: '1⭐ назад',           emoji: '⭐',  rarity: 'common',    weight: 30, starsValue: 1 },
        { id: 'l3', label: 'Малый буст профиля', emoji: '🔹',  rarity: 'rare',      weight: 12 },
        { id: 'l4', label: '5⭐ джекпот',         emoji: '💥',  rarity: 'epic',      weight: 3,  starsValue: 5 },
      ]
    },
    starter: {
      prizes: [
        { id: 's1', label: 'Стикер-пак',         emoji: '😺', rarity: 'common',    weight: 45 },
        { id: 's2', label: '2⭐ назад',           emoji: '⭐',  rarity: 'common',    weight: 28, starsValue: 2 },
        { id: 's3', label: 'Эксклюзивный бейдж', emoji: '🏅', rarity: 'rare',      weight: 17 },
        { id: 's4', label: 'Аватар-рамка',       emoji: '🖼️', rarity: 'epic',      weight: 8  },
        { id: 's5', label: 'Мегаприз: 20⭐',      emoji: '💫', rarity: 'legendary', weight: 2,  starsValue: 20 },
      ]
    },
    pro: {
      prizes: [
        { id: 'p1', label: '3⭐ назад',           emoji: '⭐',  rarity: 'common',    weight: 32, starsValue: 3 },
        { id: 'p2', label: 'Скин для профиля',   emoji: '🎨', rarity: 'rare',      weight: 28 },
        { id: 'p3', label: 'Анимация имени',     emoji: '✨', rarity: 'rare',      weight: 20 },
        { id: 'p4', label: '10⭐ назад',          emoji: '🌟', rarity: 'epic',      weight: 15, starsValue: 10 },
        { id: 'p5', label: 'Суперприз: 60⭐',     emoji: '🚀', rarity: 'legendary', weight: 5,  starsValue: 60 },
      ]
    },
    ultra: {
      prizes: [
        { id: 'u1', label: '7⭐ назад',                 emoji: '⭐',  rarity: 'rare',      weight: 30, starsValue: 7 },
        { id: 'u2', label: 'Редкий скин + эффект',     emoji: '🧿', rarity: 'epic',      weight: 28 },
        { id: 'u3', label: '15⭐ назад',                emoji: '🌟', rarity: 'epic',      weight: 20, starsValue: 15 },
        { id: 'u4', label: 'Легенда: 120⭐',            emoji: '🏆', rarity: 'legendary', weight: 6,  starsValue: 120 },
        { id: 'u5', label: 'Легендарный сет предметов',emoji: '🎖️', rarity: 'legendary', weight: 4 },
        { id: 'u6', label: 'Мифический: 300⭐',         emoji: '🦄', rarity: 'legendary', weight: 2,  starsValue: 300 },
      ]
    }
  };

  const c = CASES[caseId];
  if (!c) {
    return res.status(404).json({ error: 'Unknown caseId', got: rawCaseId, normalized: caseId });
  }

  // выбор по весам (как у тебя)
  const total = c.prizes.reduce((s, p) => s + Math.max(0, p.weight || 0), 0);
  let r = Math.random() * Math.max(1, total);
  let prize = c.prizes[c.prizes.length - 1];
  for (const p of c.prizes) {
    r -= Math.max(0, p.weight || 0);
    if (r <= 0) { prize = p; break; }
  }

  return res.status(200).json({ prize });
};
