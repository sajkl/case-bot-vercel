import crypto from 'crypto';

function parse(initData) {
  const p = new URLSearchParams(initData);
  const o = {}; for (const [k,v] of p) o[k] = v;
  return o;
}
function buildDataCheck(obj) {
  return Object.entries(obj)
    .filter(([k]) => k !== 'hash')
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`)
    .join('\n');
}
function verify(initData, botToken, maxAgeSec=86400) {
  const obj = parse(initData);
  const { hash, auth_date } = obj;
  if (!hash || !auth_date) return { ok:false, reason:'no hash/auth_date', obj };
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secret).update(buildDataCheck(obj)).digest('hex');
  if (hmac !== hash) return { ok:false, reason:'bad hash', obj };
  const now = Math.floor(Date.now()/1000);
  if (Math.abs(now - Number(auth_date)) > maxAgeSec) return { ok:false, reason:'expired', obj };
  return { ok:true, obj };
}
function signJwt(payload, secret, expSec=60*60*24*7) {
  const h = Buffer.from(JSON.stringify({ alg:'HS256', typ:'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now()/1000)+expSec })).toString('base64url');
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'method not allowed' });

  const BOT_TOKEN  = process.env.BOT_TOKEN;
  const APP_SECRET = process.env.APP_SECRET || (BOT_TOKEN || '') + ':dev';
  const { initData } = req.body || {};

  if (!initData) return res.status(200).json({ ok:false, reason:'missing initData' });
  if (!BOT_TOKEN)  return res.status(200).json({ ok:false, reason:'missing BOT_TOKEN env' });

  const ver = verify(initData, BOT_TOKEN);
  if (!ver.ok) return res.status(200).json({ ok:false, reason:ver.reason });

  const userRaw = ver.obj.user;
  let user = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch {}
  if (!user?.id) return res.status(200).json({ ok:false, reason:'no user field in initData', debug:{ keys:Object.keys(ver.obj) } });

  const token = signJwt({ sub:String(user.id), tg:user }, APP_SECRET);

  // ставим куку и также возвращаем токен (fallback для iOS)
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`);
  res.status(200).json({ ok:true, token });
}
