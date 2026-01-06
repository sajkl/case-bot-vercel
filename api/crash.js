const { query } = require('../db');

// === НАСТРОЙКИ (RTP 70%) ===
const HOUSE_EDGE = 0.30; 

// ВРЕМЕННО: Хардкодим твой ID со скриншота, чтобы тест заработал.
// Потом тут будет логика получения ID из Telegram initData
const getUserId = (req) => {
  return 323562728; 
};

// Формула роста
const getMultiplier = (ms) => Math.pow(Math.E, 0.00006 * ms);

// Генератор краша
const generateCrashPoint = () => {
  const r = Math.random(); 
  const result = (1 - HOUSE_EDGE) / (1 - r);
  let crashPoint = Math.floor(result * 100) / 100;
  if (crashPoint < 1.00) crashPoint = 1.00;
  if (crashPoint > 100) crashPoint = 100.00;
  return crashPoint;
};

module.exports = async (req, res) => {
  // Разрешаем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const userId = getUserId(req);
    const { action, bet, gameId } = req.body;

    // --- 1. СТАРТ ИГРЫ ---
    if (action === 'start') {
      if (!bet) throw new Error('Нет ставки');

      // ИЩЕМ БАЛАНС В ТАБЛИЦЕ BALANCES
      const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
      
      if (balRes.rows.length === 0) {
        throw new Error(`Баланс для юзера ${userId} не найден (таблица balances пуста для него)`);
      }

      const balance = balRes.rows[0].stars || 0;

      if (balance < bet) {
        // Чтобы тест прошел, даже если денег мало - раскомментируй строку ниже для "бесплатной" игры:
        // if (true) { 
        throw new Error(`Мало звезд: у тебя ${balance}, а ставка ${bet}`);
      }

      // СПИСЫВАЕМ ИЗ BALANCES
      await query('UPDATE balances SET stars = stars - $1 WHERE user_id = $2', [bet, userId]);

      // Генерируем игру
      const crashPoint = generateCrashPoint();
      const startTime = Date.now();

      // Создаем запись об игре
      // Убедись, что таблица crash_games существует!
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

    // --- 2. ЗАБРАТЬ (CASHOUT) ---
    if (action === 'cashout') {
      if (!gameId) throw new Error('No gameId');

      const gameRes = await query('SELECT * FROM crash_games WHERE id = $1', [gameId]);
      if (gameRes.rows.length === 0) throw new Error('Игра не найдена');
      
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
      
      // НАЧИСЛЯЕМ В BALANCES
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
    return res.status(500).json({ 
      error: e.message || 'Server Error', 
      stack: e.stack 
    });
  }
};
