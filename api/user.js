// api/user.js
const crypto = require('crypto');
const db = require('../db');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const APP_SECRET = (process.env.APP_SECRET || (BOT_TOKEN + ':dev')).trim();

// === ХЕЛПЕРЫ ===
function signJwt(payload, secret, expSec = 60 * 60 * 24 * 7) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

async function tgFetch(method, data) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json());
}

// === MAIN HANDLER ===
module.exports = async (req, res) => {
  const { action } = req.query;

  // --- 1. АВТОРИЗАЦИЯ (POST) ---
  if (req.method === 'POST' && action === 'auth') {
    try {
      const body = req.body || {};
      const raw = body.initData || '';
      if (!raw) return res.status(200).json({ ok: false, reason: 'missing initData' });

      const params = new URLSearchParams(raw);
      let user = null;
      try { user = JSON.parse(params.get('user')); } catch (_) {}

      if (!user || !user.id) return res.status(200).json({ ok: false, reason: 'no user' });

      // Синхронизация с БД
      await db.query(`
        INSERT INTO users (telegram_id, username, first_name, photo_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (telegram_id) DO UPDATE SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          photo_url = EXCLUDED.photo_url
      `, [user.id, user.username || null, user.first_name || '', user.photo_url || null]);

      await db.query(`
        INSERT INTO balances (user_id, stars) VALUES ($1, 0)
        ON CONFLICT (user_id) DO NOTHING
      `, [user.id]);

      // Токен (DEV режим без проверки подписи initData, как было у тебя)
      const token = signJwt({ sub: String(user.id), tg: user, mode: 'DEV_NO_HASH' }, APP_SECRET);
      res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`);

      return res.status(200).json({ ok: true, user });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- 2. АВАТАРКА (GET) ---
  if (req.method === 'GET' && action === 'avatar') {
    const user_id = Number(req.query.user_id);
    if (!BOT_TOKEN || !user_id) return res.status(400).end();

    try {
      const ph = await tgFetch('getUserProfilePhotos', { user_id, limit: 1 });
      const file_id = ph?.result?.photos?.[0]?.[0]?.file_id;
      if (!file_id) return res.status(204).end(); // Нет фото

      const gf = await tgFetch('getFile', { file_id });
      const path = gf?.result?.file_path;
      if (!path) return res.status(204).end();

      const f = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
      res.setHeader('Content-Type', f.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Кеш на сутки
      
      const buffer = await f.arrayBuffer();
      return res.end(Buffer.from(buffer));
    } catch (e) {
      console.error(e);
      return res.status(500).end();
    }
  }

  return res.status(404).json({ error: 'Unknown action' });
};
