// /api/tg-auth.js
import crypto from 'crypto';

function parseInitData(initData) {
  const p = new URLSearchParams(initData);
  const obj = {}; for (const [k,v] of p.entries()) obj[k] = v;
  return obj;
}
function dataCheckString(obj) {
  return Object.entries(obj)
    .filter(([k]) => k !== 'hash')
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`)
    .join('\n');
}
function verify(initData, botToken, maxAgeSec=86400) {
  const obj = parseInitData(initData);
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secret).update(dataCheckString(obj)).digest('hex');
  if (hmac !== obj.hash) return { ok:false, reason:'bad hash' };
  const now = Math.floor(Date.now()/1000);
  if (!obj.auth_date || Math.abs(now - Number(obj.auth_date)) > maxAgeSec) return { ok:false, reason:'expired' };
  return { ok:true, obj };
}
function sign(payload, secret, expSec=60*60*24*7) {
  const head = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now()/1000)+expSec })).toString('base64url');
  const sig  = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export default async function handler(req,res){
  if (req.method!=='POST') return res.status(405).json({ok:false});
  const BOT_TOKEN  = process.env.BOT_TOKEN;
  const APP_SECRET = process.env.APP_SECRET || (BOT_TOKEN + ':dev');
  try {
    const { initData } = req.body || {};
    if (!BOT_TOKEN || !initData) return res.status(400).json({ ok:false, error:'Missing BOT_TOKEN/initData' });

    const ver = verify(initData, BOT_TOKEN);
    if (!ver.ok) return res.status(401).json({ ok:false, error: ver.reason });

    // Разбираем объект user из initData
    const params = parseInitData(initData);
    const user = params.user ? JSON.parse(params.user) : null;
    if (!user || typeof user.id !== 'number') return res.status(400).json({ ok:false, error:'no user' });

    // TODO: тут upsert в БД (id, username, first_name, photo_url и т.п.)
    const token = sign({ sub:String(user.id), tg:{
      id:user.id, username:user.username, first_name:user.first_name, last_name:user.last_name,
      language_code:user.language_code, photo_url:user.photo_url // часто Telegram отдаёт это поле
    }}, APP_SECRET);

    res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60*60*24*7}`);
    res.status(200).json({ ok:true });
  } catch(e) {
    console.error(e); res.status(500).json({ ok:false, error:'internal' });
  }
}
