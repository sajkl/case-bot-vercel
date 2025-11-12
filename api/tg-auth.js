// /api/tg-auth.js
'use strict';

const crypto = require('crypto');

const BOT_TOKEN  = (process.env.BOT_TOKEN || '').trim();
const APP_SECRET = (process.env.APP_SECRET || (BOT_TOKEN + ':dev')).trim();

function mask(s) { return s ? s.slice(0,6) + '…' + s.slice(-4) : '(empty)'; }

// HMAC по «сырым» парам key=value без декодирования (Telegram Web Apps)
function computeHmacFromRawInitData(rawInitData, botToken) {
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const pairs = String(rawInitData).split('&').map(s => s.trim()).filter(Boolean);
  const withoutHash = pairs.filter(p => !p.startsWith('hash='));
  withoutHash.sort((a, b) => {
    const ka = a.split('=')[0];
    const kb = b.split('=')[0];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const dataCheckString = withoutHash.join('\n');
  return crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

// маленький помощник к Telegram Bot API (для быстрой самопроверки токена)
async function tg(method) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const r = await fetch(url);
  return r.json().catch(() => ({}));
}

module.exports = async function handler(req, res) {
  try {
    // GET — самодиагностика токена (очень удобно!)
    if (req.method === 'GET') {
      const me = BOT_TOKEN ? await tg('getMe') : { ok:false, reason:'no token' };
      return res.status(200).json({ ok:true, token_mask: mask(BOT_TOKEN), getMe: me });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, reason:'method not allowed' });
    }

    if (!BOT_TOKEN) {
      return res.status(200).json({ ok:false, reason:'missing BOT_TOKEN env' });
    }

    const initData = (req.body && (req.body.initData || req.body.init_data || req.body.raw)) || '';
    if (!initData) {
      return res.status(200).json({ ok:false, reason:'missing initData' });
    }

    // достаём hash из сырой строки, без декодирования
    const m = String(initData).match(/(?:^|&)hash=([A-Fa-f0-9]{64})(?:$|&)/);
    const providedHash = m ? m[1].toLowerCase() : '';
    if (!providedHash) {
      return res.status(200).json({ ok:false, reason:'missing hash' });
    }

    const computedHash = computeHmacFromRawInitData(initData, BOT_TOKEN).toLowerCase();

    if (computedHash !== providedHash) {
      // если попросили отладку — вернём расчёт
      const debug = !!(req.query && ('debug' in req.query));
      return res.status(200).json({
        ok:false, reason:'bad hash',
        ...(debug ? { debug: {
          provided: providedHash.slice(0,16)+'…',
          computed: computedHash.slice(0,16)+'…',
          token_mask: mask(BOT_TOKEN),
          raw_sample: String(initData).slice(0,160)+'…'
        }} : {})
      });
    }

    // подпись сошлась — достанем user (тут можно декодировать)
    let user = null;
    try {
      const params = new URLSearchParams(initData);
      user = JSON.parse(params.get('user') || 'null');
    } catch {}

    if (!user?.id) {
      return res.status(200).json({ ok:false, reason:'no user in initData' });
    }

    // простой JWT в куку sid (для /api/me)
    const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const body   = Buffer.from(JSON.stringify({
      sub: String(user.id),
      tg:  user,
      exp: Math.floor(Date.now()/1000) + 60*60*24*7
    })).toString('base64url');
    const sig    = crypto.createHmac('sha256', APP_SECRET).update(`${header}.${body}`).digest('base64url');
    const token  = `${header}.${body}.${sig}`;

    res.setHeader('Set-Cookie',
      `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`);

    return res.status(200).json({ ok:true, user: { id:user.id, username:user.username, first_name:user.first_name, last_name:user.last_name, photo_url:user.photo_url } });
  } catch (e) {
    console.error('tg-auth fatal:', e);
    return res.status(200).json({ ok:false, reason:'exception', error: String(e?.message || e) });
  }
};
