const { query } = require('../db');
const crypto = require('crypto');
const querystring = require('querystring');

// === НАСТРОЙКИ ===
const HOUSE_EDGE = 0.30; // RTP 70%

// === ВАЛИДАЦИЯ TELEGRAM (Безопасность) ===
// Проверяем, что запрос реально от Телеграма, а не от хакера
function verifyTelegramWebAppData(telegramInitData) {
  if (!telegramInitData) return null;

  const encoded = decodeURIComponent(telegramInitData);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  
  // Парсим строку
  const arr = encoded.split('&');
  const hashIndex = arr.findIndex(str => str.startsWith('hash='));
  const hash = arr.splice(hashIndex, 1)[0].split('=')[1];
  
  // Сортируем и подписываем
  arr.sort((a, b) => a.localeCompare(b));
  const dataCheckString = arr.join('\n');
  
  const _hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  
  if (_hash !== hash) return null; // Подпись не совпала!
  
  // Достаем user_id из JSON внутри строки
  const userStr = arr.find(s => s.startsWith('user=')).split('user=')[1];
  return JSON.parse(userStr);
}

// === ИГРОВАЯ ЛОГИКА ===
const getMultiplier = (ms) => Math.pow(Math.E, 0.00006 * ms);

const generateCrashPoint = () => {
  const r = Math.random();
  const result = (1 - HOUSE_EDGE) / (1 - r);
  let crashPoint = Math.floor(result * 100) / 100;
  if (crashPoint < 1.00) crashPoint = 1.00;
  if (crashPoint > 100) crashPoint = 100.00;
  return crashPoint;
};

// === ОСНОВНОЙ ХЕНДЛЕР ===
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Data');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. ПОЛУЧАЕМ ДАННЫЕ ИЗ ХЕДЕРА
    const initData = req.headers['x-telegram-data'];
    const user = verifyTelegramWebAppData(initData);

    // Если валидация не прошла (или токена нет), выкидываем ошибку
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Unauthorized: Bad Telegram Data' });
    }

    const userId = user.id; // Настоящий ID пользователя (например, 323562728)
    const { action, bet, gameId } = req.body;

    // --- СТАРТ ИГРЫ ---
    if (action === 'start') {
      if (!bet || bet <= 0) throw new Error('Неверная ставка');

      // Проверяем баланс в таблице BALANCES
      const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
      
      // Если юзера нет в balances, создадим его с 0 (или кинем ошибку)
      if (balRes.rows.length === 0) {
        throw new Error('Пользователь не найден в системе (нет баланса)');
      }

      const balance = balRes.rows[0].stars || 0;

      if (balance < bet) {
        throw new Error(`Недостаточно средств. Баланс: ${balance}, Ставка: ${bet}`);
      }

      // Списываем
      await query('UPDATE balances SET stars = stars - $1 WHERE user_id = $2', [bet, userId]);

      const crashPoint = generateCrashPoint();
      const startTime = Date.now();

      const insertRes = await query(
        `INSERT INTO crash_games (user_id, bet_amount, crash_point, start_time, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [userId, bet, crashPoint, startTime]
      );

      return res.status(200).json({
        ok: true,
        gameId: insertRes.rows[0].id,
        startTime: startTime,
        balance: balance - bet
      });
    }

    // --- ЗАБРАТЬ (CASHOUT) ---
    if (action === 'cashout') {
      if (!gameId) throw new Error('No gameId');

      const gameRes = await query('SELECT * FROM crash_games WHERE id = $1 AND user_id = $2', [gameId, userId]);
      
      if (gameRes.rows.length === 0) throw new Error('Игра не найдена или чужая');
      const game = gameRes.rows[0];
      
      if (game.status !== 'active') throw new Error('Игра уже завершена');

      const now = Date.now();
      const elapsed = now - parseInt(game.start_time);
      const serverMultiplier = getMultiplier(elapsed);
      const cashedAt = Math.floor(serverMultiplier * 100) / 100;

      // Проверка на краш
      if (cashedAt > parseFloat(game.crash_point)) {
        await query("UPDATE crash_games SET status = 'busted' WHERE id = $1", [gameId]);
        return res.json({ ok: false, reason: 'Crashed', crashPoint: game.crash_point });
      }

      const winAmount = Math.floor(game.bet_amount * cashedAt);
      
      // Начисляем выигрыш
      await query('BEGIN');
      await query("UPDATE crash_games SET status = 'cashed_out', cashout_point = $1, profit = $2 WHERE id = $3", [cashedAt, winAmount, gameId]);
      await query("UPDATE balances SET stars = stars + $1 WHERE user_id = $2", [winAmount, userId]);
      await query('COMMIT');

      const finalBal = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);

      return res.json({
        ok: true,
        win: winAmount,
        multiplier: cashedAt,
        balance: finalBal.rows[0].stars
      });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    console.error('API Error:', e);
    return res.status(500).json({ error: e.message });
  }
};
