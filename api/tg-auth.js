import crypto from 'crypto';

function parse(initData) {
  const p = new URLSearchParams(initData);
  const o = {}; for (const [k,v] of p) o[k] = v;
  return o;
}

function check(initData, botToken) {
  const obj = parse(initData);
  if (!obj.hash) return false;
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const data = Object.entries(obj)
    .filter(([k]) => k !== 'hash')
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`)
    .join('\n');

  const hmac = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return hmac === obj.hash ? obj : false;
}

function sign(payload, secret, expSec=60*60*24*7) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp:Math.floor(Date.now()/1000)+expSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const APP_SECRET = process.env.APP_SECRET || (BOT_TOKEN + ':dev');

  const { initData } = req.body || {};
  if (!BOT_TOKEN || !initData) return res.status(400).json({ ok:false });

  const verified = check(initData, BOT_TOKEN);
  if (!verified) return res.status(401).json({ ok:false });

  const user = verified.user ? JSON.parse(verified.user) : null;
  if (!user?.id) return res.status(400).json({ ok:false });

  const token = sign({ sub:String(user.id), tg:user }, APP_SECRET);

  res.setHeader('Set-Cookie', [
    `sid=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60*60*24*7}`
  ]);

  res.json({ ok:true });
}
