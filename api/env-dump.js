// /api/env-dump.js
export default function handler(req, res) {
  const raw = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',').map(s => s.trim()).filter(Boolean);
  const masks = raw.map(t => t ? (t.slice(0,6)+'…'+t.slice(-4)) : '');
  res.status(200).json({
    vercel_env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    count: raw.length,
    tokens_masked: masks,
    // не возвращаем весь токен в ответе, только маски
  });
}
