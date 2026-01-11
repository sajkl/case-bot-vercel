const { query } = require('../db');

module.exports = async (req, res) => {
  const { itemId } = req.body;
  
  // TODO: Добавь тут проверку verifyTelegramWebAppData (как в open.js)
  
  try {
    // 1. Ищем предмет
    const itemRes = await query(`
      SELECT inv.id, inv.user_id, i.stars_cost 
      FROM inventory inv
      JOIN items i ON inv.item_id = i.id
      WHERE inv.id = $1 AND inv.status = 'active'
    `, [itemId]);

    if (itemRes.rows.length === 0) return res.status(400).json({ error: 'Предмет не найден' });
    
    const item = itemRes.rows[0];
    const sellPrice = item.stars_cost; // БЕРЕМ 100% ЦЕНЫ (без умножения на 0.8)
    const userId = item.user_id;

    // 2. Продаем
    await query('BEGIN');
    await query("UPDATE inventory SET status = 'sold' WHERE id = $1", [itemId]);
    await query("UPDATE balances SET stars = stars + $1 WHERE user_id = $2", [sellPrice, userId]);
    await query('COMMIT');

    const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
    
    return res.json({ success: true, balance: balRes.rows[0].stars, added: sellPrice });

  } catch (e) {
    await query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'Ошибка' });
  }
};
