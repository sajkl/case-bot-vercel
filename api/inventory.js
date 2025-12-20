// api/inventory.js
const db = require('../db');
const crypto = require('crypto');

// Секрет для проверки (как обычно)
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
  // 1. Авторизация
  const cookie = req.headers.cookie || '';
  let token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
  if (!token && req.headers.authorization) token = req.headers.authorization.slice(7);

  const jwt = verifyJwt(token, APP_SECRET);
  if (!jwt || !jwt.sub) return res.status(401).json({ error: 'Unauthorized' });

  const userId = jwt.sub;

  try {
    // 2. Забираем предметы из базы (сначала новые)
    const result = await db.query(`
      SELECT item_id, name, image_url, created_at 
      FROM inventory 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [userId]);

    // Преобразуем для фронтенда (если нужно менять названия полей)
    const items = result.rows.map(row => ({
      id: row.item_id,
      name: row.name,
      icon: row.image_url, // Твой фронт ждет поле 'icon'
      date: row.created_at
    }));

    res.status(200).json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB Error' });
  }
};
