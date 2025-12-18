// api/me.js
const crypto = require('crypto');

function verifyJwt(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const sig = crypto.createHmac('sha256', (secret || '').trim())
      .update(`${h}.${p}`)
      .digest('base64url');

    if (s !== sig) return null;

    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  const cookie = req.headers.cookie || '';
  const authHeader = req.headers.authorization || '';
  
  // Достаем токен из Bearer или из куки sid
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  let token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
  
  if (!token && bearer) token = bearer;
  
  if (!token) return res.status(401).json({ ok: false });

  // Секрет должен совпадать с тем, что в tg-auth.js
  const APP_SECRET = (process.env.APP_SECRET || (process.env.BOT_TOKEN + ':dev')).trim();
  
  const payload = verifyJwt(token, APP_SECRET);
  if (!payload) return res.status(401).json({ ok: false });

  // Возвращаем данные пользователя, которые зашиты в токене
  return res.status(200).json({ 
    ok: true, 
    user: payload.tg || { id: payload.sub } 
  });
};
