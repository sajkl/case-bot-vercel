// api/open.js
const db = require('../db'); // Твое подключение к Neon
const { CASES } = require('./data'); // Твои настройки цен (бесплатно для БД)

// Простенький список призов (можно тоже вынести в data.js или хранить в БД)
const PRIZES = [
  { id: 'xp_100', title: '100 опыта', image: '/assets/prizes/xp.png' },
  { id: 'skin_common', title: 'Обычный скин', image: '/assets/prizes/skin1.png' },
  // ... добавь свои
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Only POST');

  try {
    // 1. Получаем юзера (из куки или заголовка, как у тебя настроено в tg-auth)
    // Для простоты предположим, что мы передаем userId в body (но лучше брать из сессии!)
    // В реальном коде раскомментируй проверку авторизации
    const { userId, caseId } = req.body; 

    if (!userId || !caseId) return res.status(400).json({ error: 'No data' });

    // 2. Узнаем цену БЕЗ запроса к БД
    const targetCase = CASES[caseId];
    if (!targetCase) return res.status(404).json({ error: 'Case not found' });

    const price = targetCase.price;

    // 3. ОДНА большая транзакция к БД
    // Мы проверяем баланс, списываем средства и записываем выигрыш одним махом.
    // Это защищает от "гонки запросов" и экономит лимиты.
    
    const result = await db.query(`
      WITH user_bal AS (
        SELECT stars FROM balances WHERE user_id = $1
      ),
      deduct AS (
        UPDATE balances 
        SET stars = stars - $2, updated_at = NOW()
        WHERE user_id = $1 AND stars >= $2
        RETURNING stars -- возвращаем новый баланс
      )
      SELECT stars FROM deduct;
    `, [userId, price]);

    // Если ничего не вернулось, значит не хватило денег или юзера нет
    if (result.rows.length === 0) {
      return res.status(402).json({ error: 'Недостаточно звезд' });
    }

    const newBalance = result.rows[0].stars;

    // 4. Генерируем приз (рандом на сервере)
    const randomPrize = PRIZES[Math.floor(Math.random() * PRIZES.length)];

    // 5. Сохраняем приз в инвентарь (асинхронно, можно не ждать для ответа юзеру, но лучше подождать)
    await db.query(`
      INSERT INTO inventory (user_id, item_id, name, image_url)
      VALUES ($1, $2, $3, $4)
    `, [userId, randomPrize.id, randomPrize.title, randomPrize.image]);

    // 6. Отдаем результат
    return res.json({
      success: true,
      stars: newBalance,
      prize: randomPrize
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
};
