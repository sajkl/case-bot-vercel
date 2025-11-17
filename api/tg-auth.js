// /api/tg-auth.js
'use strict';

const crypto = require('crypto');

const BOT_TOKEN  = (process.env.BOT_TOKEN || '').trim(); // пока не используем, но пусть будет
const APP_SECRET = (process.env.APP_SECRET || (BOT_TOKEN + ':dev')).trim();

function signJwt(payload, secret, expSec = 60 * 60 * 24 * 7) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expSec
  })).toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function mask(s){ return s ? s.slice(0,6)+'…'+s.slice(-4) : '(empty)'; }

module.exports = async function handler(req, res) {
  try {
    // GET — быстрая диагностика
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        mode: 'DEV_NO_HASH',
        bot_token_mask: mask(BOT_TOKEN),
        app_secret_mask: mask(APP_SECRET)
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, reason: 'method not allowed' });
    }

    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const raw = typeof body.initData === 'string'
      ? body.initData
      : (body.init_data || '');

    if (!raw) {
      return res.status(200).json({ ok: false, reason: 'missing initData' });
    }

    const params = new URLSearchParams(raw);
    let user = null;
    try {
      user = JSON.parse(params.get('user') || 'null');
    } catch (_) {
      user = null;
    }

    if (!user || !user.id) {
      return res.status(200).json({ ok: false, reason: 'no user in initData' });
    }

    // ⚠️ ВАЖНО: без проверки подписи! ТОЛЬКО для разработки.
    const token = signJwt(
      { sub: String(user.id), tg: user, mode: 'DEV_NO_HASH' },
      APP_SECRET
    );

    res.setHeader(
      'Set-Cookie',
      `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`
    );

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        photo_url: user.photo_url
      }
    });
  } catch (e) {
    console.error('tg-auth fatal:', e);
    return res.status(200).json({ ok: false, reason: 'exception', error: String(e?.message || e) });
  }
};
