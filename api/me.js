// /api/me.js
import crypto from 'crypto';

function verifyJwt(token, secret) {
  const [h,p,s] = String(token).split('.');
  if (!h || !p || !s) return null;
  const sig = crypto.createHmac('sha256', (secret||'').trim()).update(`${h}.${p}`).digest('base64url');
  if (s !== sig) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload;
}

export default function handler(req, res) {
  const cookie = req.headers.cookie || '';
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : '';

  let token = cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('sid='))?.slice(4);
  if (!token && bearer) token = bearer;
  if (!token) return res.status(401).json({ ok:false });

  const APP_SECRET = (process.env.APP_SECRET || 'sig:app').trim();
  const payload = verifyJwt(token, APP_SECRET);
  if (!payload) return res.status(401).json({ ok:false });

  return res.status(200).json({ ok:true, user: payload.tg || { id: payload.sub } });
}
