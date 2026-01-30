// api/open.js
const { query } = require('../db');
const crypto = require('crypto');

// === НАСТРОЙКИ ===
const CASE_PRICES = {
  'jiga': 270,
  'camry': 620,
  'bmw': 1750,
  'lambo': 4900
};

// [FIX] СПИСОК КЕЙСОВ С ГАРАНТОМ
// Жиги (jiga) тут нет, значит для нее стрик считаться не будет
const GUARANTEED_CASES = ['camry', 'bmw', 'lambo'];

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
    
    // [FIX] Проверяем, включен ли гарант для этого кейса
    const useGuarantee = GUARANTEED_CASES.includes(caseId);

    let currentStreak = 0;

    // А) Узнаем текущий стрик проигрышей (ТОЛЬКО ЕСЛИ КЕЙС В СПИСКЕ)
    if (useGuarantee) {
        const streakRes = await query(
            'SELECT loss_count FROM user_case_streaks WHERE user_id = $1 AND case_id = $2',
            [userId, caseId]
        );
        currentStreak = streakRes.rows[0]?.loss_count || 0;
    }

    let prize = null;
    let newLossCount = 0;
    let isGuaranteed = false;

    // Б) Если 3 проигрыша подряд -> 4-й раз ГАРАНТ (ТОЛЬКО ЕСЛИ КЕЙС В СПИСКЕ)
    if (useGuarantee && currentStreak >= 3) {
        // Фильтруем предметы, которые дороже кейса (окуп)
        const winningItems = items.filter(i => parseInt(i.stars_cost) > price);
        
        // Сортируем от дешевых к дорогим
        winningItems.sort((a, b) => parseInt(a.stars_cost) - parseInt(b.stars_cost));

        if (winningItems.length > 0) {
            // 95% шанс на самый дешевый окуп (первый в списке)
            const randomPercent = Math.random() * 100;
            
            if (randomPercent < 95 || winningItems.length === 1) {
                prize = winningItems[0]; 
            } else {
                // 5% шанс на любой другой окупной предмет
                const superWins = winningItems.slice(1);
                prize = spinRoulette(superWins);
            }
            
            // При победе стрик сбрасываем
            newLossCount = 0;
            isGuaranteed = true;
        }
    }

    // В) Если гарант не сработал или кейс не в списке -> Обычная рулетка
    if (!prize) {
        prize = spinRoulette(items);
        
        // Считаем стрик ТОЛЬКО если кейс в списке гарантов
        if (useGuarantee) {
            // если цена приза <= цены кейса, то это проигрыш
            if (parseInt(prize.stars_cost) <= price) {
                newLossCount = currentStreak + 1;
            } else {
                newLossCount = 0; // Выиграл сам - сбросили стрик
            }
        }
    }

    // 5. ТРАНЗАКЦИЯ (ВСЕ ЗАПИСИ В БД)
    await query('BEGIN');

    // А) Списываем деньги
    await query('UPDATE balances SET stars = stars - $1 WHERE user_id = $2', [price, userId]);

    // Получаем актуальный баланс
    const newBalRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
    const balanceAfter = newBalRes.rows[0].stars;

    // Б) Записываем в TRANSACTIONS
    await query(
        `INSERT INTO transactions (user_id, amount, type, balance_after) 
         VALUES ($1, $2, 'CASE_OPEN', $3)`,
        [userId, -price, balanceAfter]
    );

    // В) Записываем в LOGS_CASES
    await query(
        `INSERT INTO logs_cases (user_id, case_id, case_price, dropped_item, item_price, is_guaranteed) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, caseId, price, prize.name, prize.stars_cost, isGuaranteed]
    );

    // Г) Добавляем предмет в инвентарь
    const invRes = await query(
      `INSERT INTO inventory (user_id, item_id, status) 
       VALUES ($1, $2, 'active') 
       RETURNING id`, 
      [userId, prize.id]
    );
    const newInventoryId = invRes.rows[0].id;

    // [FIX] Д) Обновляем счетчик проигрышей (ТОЛЬКО ЕСЛИ КЕЙС В СПИСКЕ)
    // Для Жиги этот код просто не выполнится, база данных не будет засоряться лишними записями
    if (useGuarantee) {
        await query(
            `INSERT INTO user_case_streaks (user_id, case_id, loss_count)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, case_id) 
             DO UPDATE SET loss_count = $3`,
            [userId, caseId, newLossCount]
        );
    }

    // Е) Добавляем в LIVE ленту
    await query(
        `INSERT INTO live_drops (user_id, item_name, image_url, is_rare)
         VALUES ($1, $2, $3, $4)`,
        [userId, prize.name, prize.image_url, prize.is_rare]
    );

    await query('COMMIT');

    // 6. ОТДАЕМ РЕЗУЛЬТАТ
    return res.json({
      success: true,
      inventoryId: newInventoryId,
      stars: balanceAfter,
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
