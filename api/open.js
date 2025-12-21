// api/open.js
const db = require('../db');
const { CASES } = require('./data'); // Подключаем твои настройки с RTP
const crypto = require('crypto');

// Секрет для проверки токена (тот же, что в auth)
const APP_SECRET = (process.env.APP_SECRET || (process.env.BOT_TOKEN + ':dev')).trim();

// Функция проверки авторизации
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

// ГЛАВНАЯ ФУНКЦИЯ РАНДОМА (Рулетка)
// Выбирает предмет на основе поля 'chance'
function spinRoulette(items) {
  // Генерируем число от 0 до 100 (можно до суммарного веса, если он не ровно 100)
  const totalChance = items.reduce((acc, item) => acc + item.chance, 0);
  const random = Math.random() * totalChance;
  
  let currentWeight = 0;
  for (const item of items) {
    currentWeight += item.chance;
    if (random <= currentWeight) {
      return item;
    }
  }
  // На всякий случай возвращаем последний (fallback)
  return items[items.length - 1];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST' });

  // 1. АВТОРИЗАЦИЯ (Безопасная, через куки/токен)
  const cookie = req.headers.cookie || '';
  let token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
  if (!token && req.headers.authorization) token = req.headers.authorization.slice(7);

  const jwt = verifyJwt(token, APP_SECRET);
  if (!jwt || !jwt.sub) return res.status(401).json({ error: 'Unauthorized' });
  const userId = jwt.sub;

  // 2. Получаем ID кейса
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ error: 'No caseId' });

  // 3. Ищем кейс в конфиге
  const targetCase = CASES[caseId];
  if (!targetCase) return res.status(404).json({ error: 'Case not found' });

  try {
    // 4. КРУТИМ РУЛЕТКУ (Математика)
    // Делаем это ДО базы данных, чтобы знать, что писать
    const prize = spinRoulette(targetCase.items);

    // 5. ТРАНЗАКЦИЯ В БД
    await db.query('BEGIN');

    // А) Списываем деньги
    // Проверяем, хватает ли средств (stars >= price)
    const balanceRes = await db.query(`
      UPDATE balances 
      SET stars = stars - $2, updated_at = NOW()
      WHERE user_id = $1 AND stars >= $2
      RETURNING stars
    `, [userId, targetCase.price]);

    // Если баланс не вернулся, значит денег не хватило
    if (balanceRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(402).json({ error: 'Недостаточно звезд' });
    }

    const newBalance = balanceRes.rows[0].stars;

    // Б) Пишем в историю транзакций
    await db.query(`
      INSERT INTO balance_tx (user_id, type, amount, balance_before, balance_after, meta)
      VALUES ($1, 'open_case', $2, $3, $4, $5)
    `, [
      userId, 
      targetCase.price, 
      newBalance + targetCase.price, // было
      newBalance,                    // стало
      JSON.stringify({ caseId, prizeId: prize.id, prizeName: prize.name })
    ]);

    // В) Выдаем приз в инвентарь
    // Сохраняем item_id, название, картинку и редкость
    await db.query(`
      INSERT INTO inventory (user_id, item_id, name, image_url, rarity)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, prize.id, prize.name, prize.image, prize.rarity]);

    await db.query('COMMIT');

    // 6. ОТДАЕМ РЕЗУЛЬТАТ
    // Возвращаем и новый баланс, и данные о призе (включая его ценность value для отображения)
    return res.json({
      success: true,
      stars: newBalance,
      prize: {
        id: prize.id,
        title: prize.name,
        image: prize.image,
        rarity: prize.rarity,
        value: prize.value // Фронт может показать "Вы выиграли предмет стоимостью X звезд"
      }
    });

  } catch (e) {
    await db.query('ROLLBACK');
    console.error('[Open Case Error]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
