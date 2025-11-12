// /api/tg-auth.js
import crypto from 'crypto';
import { validate } from '@telegram-apps/init-data-node'; // проверка Ed25519-подписи платформы

function computeHmacFromRaw(raw, token) {
  const key = crypto.createHash('sha256').update((token || '').trim()).digest();
  const parts = String(raw)
    .split('&')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => !p.startsWith('hash='))
    .sort((a,b)=> a.split('=')[0].localeCompare(b.split('=')[0]));
  const dcs = parts.join('\n');
  return crypto.createHmac('sha256', key).update(dcs).digest('hex');
}

function signJwt(payload, secret, expSec = 60*60*24*7) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body   = Buffer.from(JSON.stringify({...payload, exp: Math.floor(Date.now()/1000)+expSec})).toString('base64url');
  const sig    = crypto.createHmac('sha256', (secret||'').trim()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, reason:'method not allowed' });
    }

    // initData — должна быть СТРОКА из Telegram.WebApp.initData
    let body = {};
    if (typeof req.body === 'string') { try { body = JSON.parse(req.body || '{}'); } catch { body = {}; } }
    else { body = req.body || {}; }

    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!initData) return res.status(200).json({ ok:false, reason:'missing initData' });

    // 1) Попробуем классический HMAC по токенам бота (если запуск с кнопки бота)
    const TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '')
      .split(',').map(s=>s.trim()).filter(Boolean);

    const provided = new URLSearchParams(initData).get('hash') || '';
    let hmacOk = false, matchedToken = null;

    if (provided && TOKENS.length) {
      for (const t of TOKENS) {
        const comp = computeHmacFromRaw(initData, t);
        if (comp === provided) { hmacOk = true; matchedToken = t; break; }
      }
    }

    // 2) Если HMAC не совпал — валидируем платформенную подпись (Ed25519)
    // Это проходит при ЛЮБОМ способе запуска (кассовые, скрепка и т.д.)
    let signatureOk = false;
    if (!hmacOk) {
      try {
        signatureOk = await validate(initData, { signature: true });
      } catch {
        signatureOk = false;
      }
    }

    if (!hmacOk && !signatureOk) {
      return res.status(200).json({
        ok:false,
        reason:'bad auth', // ни HMAC, ни signature не подтвердились
      });
    }

    // 3) user из initData
    let user = null;
    try { user = JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch {}
    if (!user?.id) return res.status(200).json({ ok:false, reason:'no user in initData' });

    // 4) JWT + кука
    const base = (matchedToken || TOKENS[0] || 'sig') + ':app';
    const APP_SECRET = (process.env.APP_SECRET || base).trim();
    const jwt = signJwt({ sub:String(user.id), tg:user }, APP_SECRET);

    res.setHeader('Set-Cookie', `sid=${jwt}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`);
    return res.status(200).json({
      ok: true,
      token: jwt,
      mode: hmacOk ? 'hmac' : 'signature'
    });
  } catch (e) {
    console.error('tg-auth fatal:', e);
    return res.status(200).json({ ok:false, reason:'fatal', message: String(e?.message || e) });
  }
}
