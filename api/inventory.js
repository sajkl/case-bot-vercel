const { query } = require('../db');
const crypto = require('crypto');

// Хелпер проверки (можно вынести в отдельный lib/auth.js)
function verifyTelegramWebAppData(telegramInitData) {
  if (!telegramInitData) return null;
  const encoded = decodeURIComponent(telegramInitData);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const arr = encoded.split('&');
  const hashIndex = arr.findIndex(str => str.startsWith('hash='));
  const hash = arr.splice(hashIndex, 1)[0].split('=')[1];
  arr.sort((a, b) => a.localeCompare(b));
  const _hash = crypto.createHmac('sha256', secret).update(arr.join('\n')).digest('hex');
  if (_hash !== hash) return null;
  return JSON.parse(arr.find(s => s.startsWith('user=')).split('user=')[1]);
}

module.exports = async (req, res) => {
  try {
    const initData = req.headers['x-telegram-data'];
    const user = verifyTelegramWebAppData(initData);
    if (!user) return res.json({ items: [] }); // Не авторизован = пустой инвентарь

    // Выбираем только АКТИВНЫЕ предметы (не проданные)
    // JOIN items, чтобы получить картинку и название
    const result = await query(`
      SELECT inv.id, i.name, i.image_url, i.stars_cost, i.is_rare 
      FROM inventory inv
      JOIN items i ON inv.item_id = i.id
      WHERE inv.user_id = $1 AND inv.status = 'active'
      ORDER BY inv.created_at DESC
    `, [user.id]);

    return res.json({ items: result.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ items: [] });
  }
};
