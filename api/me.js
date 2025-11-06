// /api/me.js
import crypto from 'crypto';
function verifyJwt(token, secret){
  try {
    const [h,p,s] = token.split('.');
    const check = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    if (check!==s) return null;
    const payload = JSON.parse(Buffer.from(p,'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}
export default async function handler(req,res){
  const APP_SECRET = process.env.APP_SECRET || 'dev';
  const cookie = req.headers.cookie || '';
  const sid = cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('sid='));
  const token = sid ? sid.slice(4) : null;
  const payload = token ? verifyJwt(token, APP_SECRET) : null;
  if (!payload) return res.status(401).json({ ok:false, error:'no session' });

  const tg = payload.tg || {};
  // Здесь можно дополнительно подтягивать из БД, если нужно.
  res.status(200).json({ ok:true, user:{
    id: tg.id, username: tg.username, first_name: tg.first_name, last_name: tg.last_name, photo_url: tg.photo_url
  }});
}
