// api/open.js
const { query } = require('../db');
const crypto = require('crypto');

// === НАСТРОЙКИ ===
// Цены должны совпадать с тем, что на фронтенде!
const CASE_PRICES = {
  'jiga': 209,
  'camry': 629,
  'bmw': 1499,
  'lambo': 3899
};

// === ВАЛИДАЦИЯ TELEGRAM (Твоя текущая система) ===
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

// === ГЛАВНЫЙ ХЕНДЛЕР ===
module.exports = async (req, res) => {
  // Настройка заголовков для WebApp
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Data');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  try {
    // 1. АВТОРИЗАЦИЯ
    const initData = req.headers['x-telegram-data'];
    const user = verifyTelegramWebAppData(initData);
    
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Telegram Data' });
    }
    const userId = user.id;

    // 2. ПОЛУЧАЕМ ID КЕЙСА
    const { caseId } = req.body;
    const price = CASE_PRICES[caseId];

    if (!price) return res.status(400).json({ error: 'Неверный или несуществующий кейс' });

    // 3. ПРОВЕРЯЕМ БАЛАНС
    const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
    const currentBalance = balRes.rows[0]?.stars || 0;

    if (currentBalance < price) {
      return res.status(402).json({ error: 'Недостаточно звезд для открытия' });
    }

    // 4. ПОЛУЧАЕМ ПРЕДМЕТЫ ИЗ БД (Вместо data.js)
    const itemsRes = await query('SELECT * FROM items WHERE case_id = $1', [caseId]);
    const items = itemsRes.rows;

    if (items.length === 0) {
      return res.status(500).json({ error: 'Кейс пуст (обратитесь в поддержку)' });
    }

    // 5. КРУТИМ РУЛЕТКУ (Математика)
    // Считаем общий вес шансов
    const totalChance = items.reduce((acc, item) => acc + parseFloat(item.chance), 0);
    let random = Math.random() * totalChance;
    let prize = null;

    for (const item of items) {
      random -= parseFloat(item.chance);
      if (random <= 0) {
        prize = item;
        break;
      }
    }
    // Страховка на случай ошибок округления JS
    if (!prize) prize = items[items.length - 1];

    // 6. ТРАНЗАКЦИЯ В БД (ACID)
    await query('BEGIN');

    // А) Списываем деньги
    await query('UPDATE balances SET stars = stars - $1 WHERE user_id = $2', [price, userId]);

    // Б) Добавляем предмет в инвентарь
    // Мы пишем только item_id, остальные данные подтянутся джойном при просмотре
    await query(
      `INSERT INTO inventory (user_id, item_id, status) VALUES ($1, $2, 'active')`, 
      [userId, prize.id]
    );

    // В) (Опционально) Запись в историю транзакций, если таблица balance_tx есть
    // await query(
    //   `INSERT INTO balance_tx (user_id, type, amount, created_at) VALUES ($1, 'open_case', $2, NOW())`,
    //   [userId, -price]
    // );

    await query('COMMIT');

    // Получаем актуальный баланс после списания
    const newBalRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);

    // 7. ОТДАЕМ РЕЗУЛЬТАТ
    return res.json({
      success: true,
      stars: newBalRes.rows[0].stars,
      prize: {
        id: prize.id,
        title: prize.name,      // Название из БД
        image: prize.image_url, // Картинка из БД
        rarity: prize.is_rare ? 'rare' : 'common',
        value: prize.stars_cost // Ценность подарка
      }
    });

  } catch (e) {
    await query('ROLLBACK');
    console.error('[Open Case Error]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
