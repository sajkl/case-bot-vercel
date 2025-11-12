// /api/tg-auth.js
'use strict';
const crypto = require('crypto');

let validateSig = null;
try {
  // опционально: если добавишь зависимость — будем проверять Ed25519-подпись платформы
  validateSig = require('@telegram-apps/init-data-node').validate;
} catch (_) {}

const TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',')
  .map(s => s.trim()).filter(Boolean);
const APP_SECRET = (process.env.APP_SECRET || (TOKENS[0] ? TOKENS[0] + ':dev' : 'sig:dev')).trim();

function computeHmacFromRawInitData(raw, botToken) {
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const pairs = String(raw).split('&').map(s => s.trim()).filter(Boolean);
  const withoutHash = pairs.filter(p => !p.startsWith('hash='));
  withoutHash.sort((a,b) => {
    const ka = a.split('=')[0]; const kb = b.split('=')[0];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const dcs = withoutHash.join('\n');
  return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
}

function signJwt(payload, secret, expSec = 60*60*24*7) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body   = Buffer.from(JSON.stringify({...payload, exp: Math.floor(Date.now()/1000)+expSec})).toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function mask(s){ return s ? s.slice(0,6)+'…'+s.slice(-4) : '(empty)'; }

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok:true, tokens_count: TOKENS.length, tokens_mask: TOKENS.map(mask) });
    }
    if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method not allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!initData) return res.status(200).json({ ok:false, reason:'missing initData' });
    if (!TOKENS.length) return res.status(200).json({ ok:false, reason:'missing BOT_TOKENS env' });

    // 1) Сначала пробуем Ed25519-подпись платформы (если есть библиотека и поле signature в initData)
    let mode = null;
    let platformOk = false;
    if (validateSig) {
      try {
        platformOk = await validateSig(initData, { signature: true });
        if (platformOk) mode = 'signature';
      } catch {}
    }

    // 2) Если не прошло — пробуем HMAC по всем бот-токенам
    let hmacOk = false, matchedToken = null;
    if (!platformOk) {
      const m = String(initData).match(/(?:^|&)hash=([A-Fa-f0-9]{64})(?:$|&)/);
      const providedHash = m ? m[1].toLowerCase() : '';
      if (!providedHash) return res.status(200).json({ ok:false, reason:'missing hash' });

      for (const t of TOKENS) {
        const comp = computeHmacFromRawInitData(initData, t).toLowerCase();
        if (comp === providedHash) { hmacOk = true; matchedToken = t; break; }
      }
      if (hmacOk) mode = 'hmac';
    }

    if (!platformOk && !hmacOk) {
      const debug = !!(req.query && ('debug' in req.query));
      const provided = (new URLSearchParams(initData).get('hash') || '').slice(0,16)+'…';
      const sample = TOKENS.slice(0,4).map(t => computeHmacFromRawInitData(initData, t).slice(0,16)+'…');
      return res.status(200).json({
        ok:false, reason:'bad auth',
        ...(debug ? { debug: { provided, sample_computed_first4: sample, tokens_count: TOKENS.length } } : {})
      });
    }

    // 3) Достаём user
    let user = null;
    try { user = JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch {}
    if (!user?.id) return res.status(200).json({ ok:false, reason:'no user in initData' });

    // 4) JWT + кука
    const jwt = signJwt({ sub:String(user.id), tg:user, mode }, APP_SECRET);
    res.setHeader('Set-Cookie', `sid=${jwt}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`);

    return res.status(200).json({ ok:true, mode, user: { id:user.id, username:user.username, first_name:user.first_name, last_name:user.last_name, photo_url:user.photo_url } });
  } catch (e) {
    console.error('tg-auth fatal:', e);
    return res.status(200).json({ ok:false, reason:'exception', error:String(e?.message||e) });
  }
};

