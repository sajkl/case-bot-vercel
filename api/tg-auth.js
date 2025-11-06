// /api/tg-auth.js
import crypto from 'crypto';

function computeFromRaw(raw, token) {
  const key = crypto.createHash('sha256').update((token || '').trim()).digest();
  const parts = String(raw)
    .split('&')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => !p.startsWith('hash='))
    .sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0]));
  const dcs = parts.join('\n');
  return crypto.createHmac('sha256', key).update(dcs).digest('hex');
}

function signJwt(payload, secret, expSec = 60 * 60 * 24 * 7) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expSec })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', (secret || '').trim())
    .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, reason: 'method not allowed' });
    }

    // Тело может прийти строкой или объектом – разбираем безопасно
    let body = {};
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body || '{}'); } catch { body = {}; }
    } else {
      body = req.body || {};
    }

    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!initData) {
      return res.status(200).json({ ok: false, reason: 'missing initData' });
    }

    // Собираем токены
    const TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (!TOKENS.length) {
      return res.status(200).json({ ok: false, reason: 'missing BOT_TOKEN(S) env' });
    }

    // Вытаскиваем hash безопасно
    let provided = '';
    try { provided = new URLSearchParams(initData).get('hash') || ''; }
    catch { return res.status(200).json({ ok: false, reason: 'bad initData format' }); }
    if (!provided) return res.status(200).json({ ok: false, reason: 'missing hash' });

    // Перебор токенов
    let matched = null, matchedIndex = -1, sample = null;
    for (let i = 0; i < TOKENS.length; i++) {
      const comp = computeFromRaw(initData, TOKENS[i]);
      if (!sample) sample = comp;
      if (comp === provided) { matched = TOKENS[i]; matchedIndex = i; break; }
    }
    if (!matched) {
      return res.status(200).json({
        ok: false, reason: 'bad hash',
        debug: {
          provided: provided.slice(0, 16) + '…',
          sample_computed: sample ? sample.slice(0, 16) + '…' : null,
          tokens_count: TOKENS.length
        }
      });
    }

    // user
    let user = null;
    try { user = JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch {}
    if (!user?.id) return res.status(200).json({ ok: false, reason: 'no user in initData' });

    // JWT
    const APP_SECRET = (process.env.APP_SECRET || (matched + ':dev')).trim();
    const jwt = signJwt({ sub: String(user.id), tg: user }, APP_SECRET);

    // Ставит cookie + возвращает токен в теле (на случай проблем с куками)
    res.setHeader(
      'Set-Cookie',
      `sid=${jwt}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`
    );
    return res.status(200).json({
      ok: true,
      token: jwt,
      matched_index: matchedIndex,
      matched_mask: matched.slice(0, 6) + '…' + matched.slice(-4)
    });
  } catch (e) {
    // В логах Vercel будет стек
    console.error('tg-auth fatal:', e);
    // Клиенту – компактная ошибка, чтобы не падало r.json()
    return res.status(200).json({ ok: false, reason: 'fatal', message: String(e && e.message || e) });
  }
}
