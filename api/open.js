// api/open.js
const { query } = require('../db');
const crypto = require('crypto');

// === НАСТРОЙКИ ===
const CASE_PRICES = {
  'jiga': 209,
  'camry': 629,
  'bmw': 1499,
  'lambo': 3899
};

// === ВАЛИДАЦИЯ TELEGRAM ===
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

// === ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ РУЛЕТКИ ===
function spinRoulette(items) {
  const totalChance = items.reduce((acc, item) => acc + parseFloat(item.chance), 0);
  let random = Math.random() * totalChance;
  for (const item of items) {
    random -= parseFloat(item.chance);
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

// === ГЛАВНЫЙ ХЕНДЛЕР ===
module.exports = async (req, res) => {
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

    if (!price) return res.status(400).json({ error: 'Неверный кейс' });

    // 3. ПРОВЕРЯЕМ БАЛАНС
    const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
    const currentBalance = balRes.rows[0]?.stars || 0;

    if (currentBalance < price) {
      return res.status(402).json({ error: 'Недостаточно звезд' });
    }

    // 4. ПОЛУЧАЕМ ПРЕДМЕТЫ
    const itemsRes = await query('SELECT * FROM items WHERE case_id = $1', [caseId]);
    const items = itemsRes.rows;

    if (items.length === 0) {
      return res.status(500).json({ error: 'Кейс пуст' });
    }

    // --- ЛОГИКА ГАРАНТА ---
    
    // А) Узнаем текущий стрик проигрышей для ЭТОГО кейса
    const streakRes = await query(
        'SELECT loss_count FROM user_case_streaks WHERE user_id = $1 AND case_id = $2',
        [userId, caseId]
    );
    const currentStreak = streakRes.rows[0]?.loss_count || 0;

    let prize = null;
    let newLossCount = 0;

    // Б) Если 3 проигрыша подряд -> 4-й раз ГАРАНТ
    if (currentStreak >= 3) {
        // Фильтруем предметы, которые дороже кейса (окуп)
        const winningItems = items.filter(i => parseInt(i.stars_cost) > price);
        
        // Сортируем от дешевых к дорогим
        winningItems.sort((a, b) => parseInt(a.stars_cost) - parseInt(b.stars_cost));

        if (winningItems.length > 0) {
            // 95% шанс на самый дешевый окуп (первый в списке)
            const randomPercent = Math.random() * 100;
            
            if (randomPercent < 95 || winningItems.length === 1) {
                prize = winningItems[0]; // Самый маленький окуп
            } else {
                // 5% шанс на любой другой окупной предмет (крутим рулетку среди оставшихся)
                const superWins = winningItems.slice(1);
                prize = spinRoulette(superWins);
            }
            // При победе стрик сбрасываем
            newLossCount = 0;
        }
        // Если вдруг в кейсе нет окупа (технически невозможно, но на всякий случай), сработает обычная рулетка ниже
    }

    // В) Если гарант не сработал или еще не определен приз -> Обычная рулетка
    if (!prize) {
        prize = spinRoulette(items);
        
        // Считаем стрик: если цена приза <= цены кейса, то это проигрыш
        if (parseInt(prize.stars_cost) <= price) {
            newLossCount = currentStreak + 1;
        } else {
            newLossCount = 0; // Выиграл сам - сбросили стрик
        }
    }

    // 5. ТРАНЗАКЦИЯ
    await query('BEGIN');

    // А) Списываем деньги
    await query('UPDATE balances SET stars = stars - $1 WHERE user_id = $2', [price, userId]);

    // Б) Добавляем предмет в инвентарь
    const invRes = await query(
      `INSERT INTO inventory (user_id, item_id, status) 
       VALUES ($1, $2, 'active') 
       RETURNING id`, 
      [userId, prize.id]
    );
    const newInventoryId = invRes.rows[0].id;

    // В) Обновляем счетчик проигрышей (UPSERT - вставка или обновление)
    await query(
        `INSERT INTO user_case_streaks (user_id, case_id, loss_count)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, case_id) 
         DO UPDATE SET loss_count = $3`,
        [userId, caseId, newLossCount]
    );

    // Г) Добавляем в LIVE ленту
    await query(
        `INSERT INTO live_drops (user_id, item_name, image_url, is_rare)
         VALUES ($1, $2, $3, $4)`,
        [userId, prize.name, prize.image_url, prize.is_rare]
    );

    await query('COMMIT');

    // Получаем новый баланс
    const newBalRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);

    // 6. ОТДАЕМ РЕЗУЛЬТАТ
    return res.json({
      success: true,
      inventoryId: newInventoryId,
      stars: newBalRes.rows[0].stars,
      prize: {
        id: prize.id,
        title: prize.name,
        image: prize.image_url,
        rarity: prize.is_rare ? 'rare' : 'common',
        value: prize.stars_cost
      }
    });

  } catch (e) {
    await query('ROLLBACK');
    console.error('[Open Case Error]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
