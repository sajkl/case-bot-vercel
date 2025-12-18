// api/profile.js
const db = require('../db'); // Подключаем базу
const crypto = require('crypto');

// Та же функция проверки токена (можно вынести в отдельный файл, но пока дублируем)
const APP_SECRET = (process.env.APP_SECRET || (process.env.BOT_TOKEN + ':dev')).trim();

function verifyJwt(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const sig = crypto.createHmac('sha256', (secret || '').trim()).update(`${h}.${p}`).digest('base64url');
    if (s !== sig) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch { return null; }
}

module.exports = async (req, res) => {
  // 1. Проверяем авторизацию
  const cookie = req.headers.cookie || '';
  let token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
  if (!token && req.headers.authorization) {
    token = req.headers.authorization.slice(7);
  }

  const jwt = verifyJwt(token, APP_SECRET);
  if (!jwt || !jwt.sub) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = jwt.sub;

  // 2. Достаем реальный баланс из базы
  try {
    const result = await db.query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
    const stars = result.rows[0] ? result.rows[0].stars : 0;
    
    // Возвращаем JSON, который ждет фронтенд
    res.status(200).json({ stars: stars });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB Error' });
  }
};
