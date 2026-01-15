const { query } = require('../db');

module.exports = async (req, res) => {
  const { itemId } = req.body;
  
  // TODO: Добавь проверку verifyTelegramWebAppData (для безопасности)
  
  try {
    // 1. Ищем предмет и его цену
    // ИСПРАВЛЕНИЕ: добавил ::uuid к inv.item_id
    const itemRes = await query(`
      SELECT inv.id, inv.user_id, i.stars_cost 
      FROM inventory inv
      JOIN items i ON inv.item_id::uuid = i.id  
      WHERE inv.id = $1 AND inv.status = 'active'
    `, [itemId]);

    if (itemRes.rows.length === 0) {
      return res.status(400).json({ error: 'Предмет не найден или уже продан' });
    }
    
    const item = itemRes.rows[0];
    const sellPrice = item.stars_cost; // Продаем за 100% стоимости
    const userId = item.user_id;

    // 2. Транзакция: Продажа + Начисление
    await query('BEGIN');
    
    // Помечаем как проданный
    await query("UPDATE inventory SET status = 'sold' WHERE id = $1", [itemId]);
    
    // Начисляем звезды
    await query("UPDATE balances SET stars = stars + $1 WHERE user_id = $2", [sellPrice, userId]);
    
    await query('COMMIT');

    // 3. Получаем новый баланс
    const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
    
    return res.json({ 
      success: true, 
      balance: balRes.rows[0].stars, 
      added: sellPrice 
    });

  } catch (e) {
    await query('ROLLBACK');
    console.error('[Sell Error]', e); // Увидим ошибку в логах, если что-то не так
    return res.status(500).json({ error: 'Ошибка сервера при продаже' });
  }
};
