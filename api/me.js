import crypto from 'crypto';

function verify(token, secret) {
  try {
    const [h,p,s] = token.split('.');
    const check = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    if (check !== s) return null;
    const body = JSON.parse(Buffer.from(p,'base64url').toString());
    if (body.exp < Math.floor(Date.now()/1000)) return null;
    return body;
  } catch { return null; }
}

export default function handler(req, res) {
  const APP_SECRET = process.env.APP_SECRET || 'dev';

  const cookie = req.headers.cookie || '';
  const sid = cookie.split(';').find(c=>c.trim().startsWith('sid='));
  if (!sid) return res.status(401).json({ ok:false });

  const payload = verify(sid.split('=')[1], APP_SECRET);
  if (!payload) return res.status(401).json({ ok:false });

  res.json({ ok:true, user: payload.tg });
}
