const { query } = require('../db');
const crypto = require('crypto');

// === НАСТРОЙКИ (RTP 70%) ===
const HOUSE_EDGE = 0.30; 

// Хелпер авторизации
// ВАЖНО: Сейчас мы ставим ID = 1. Убедись, что в таблице users есть пользователь с id=1
const getUserId = (req) => {
  return 1; 
};

// Формула роста
const getMultiplier = (ms) => Math.pow(Math.E, 0.00006 * ms);

// Генерация точки краша
const generateCrashPoint = () => {
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  const maxUint32 = Math.pow(2, 32);
  const r = randomBuffer[0] / maxUint32; 

  const result = (1 - HOUSE_EDGE) / (1 - r);
  const crashPoint = Math.floor(result * 100) / 100;

  if (crashPoint < 1.00) return 1.00; 
  if (crashPoint > 100) return 100.00;

  return crashPoint;
};

// Основной обработчик (CommonJS)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const userId = getUserId(req);
    const { action, bet, gameId } = req.body;

    // --- 1. СТАРТ ---
    if (action === 'start') {
      if (!bet || bet <= 0) return res.status(400).json({ error: 'Неверная ставка' });

      // Проверка баланса
      const userRes = await query('SELECT stars FROM users WHERE id = $1', [userId]);
      
      // Если пользователя нет, вернем понятную ошибку
      if (userRes.rows.length === 0) {
        console.error(`User ID ${userId} not found in DB`);
        return res.status(500).json({ error: 'User not found' });
      }

      const balance = userRes.rows[0].stars || 0;

      if (balance < bet) return res.status(400).json({ error: 'Недостаточно средств' });

      // Списание
      await query('UPDATE users SET stars = stars - $1 WHERE id = $2', [bet, userId]);

      // Генерация
      const crashPoint = generateCrashPoint();
      const startTime = Date.now();

      // Запись
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
      if (!gameId) return res.status(400).json({ error: 'No game ID' });

      const gameRes = await query('SELECT * FROM crash_games WHERE id = $1 AND user_id = $2', [gameId, userId]);
      const game = gameRes.rows[0];

      if (!game || game.status !== 'active') {
        return res.status(400).json({ error: 'Игра завершена', crashPoint: game?.crash_point || 1.00 });
      }

      const now = Date.now();
      const elapsed = now - parseInt(game.start_time);
      const serverMultiplier = getMultiplier(elapsed);
      const cashedAt = Math.floor(serverMultiplier * 100) / 100;

      if (cashedAt > parseFloat(game.crash_point)) {
        await query("UPDATE crash_games SET status = 'busted' WHERE id = $1", [gameId]);
        return res.json({ ok: false, reason: 'Crashed', crashPoint: game.crash_point });
      }

      const winAmount = Math.floor(game.bet_amount * cashedAt);
      
      await query('BEGIN');
      await query("UPDATE crash_games SET status = 'cashed_out', cashout_point = $1, profit = $2 WHERE id = $3", [cashedAt, winAmount, gameId]);
      await query("UPDATE users SET stars = stars + $1 WHERE id = $2", [winAmount, userId]);
      await query('COMMIT');

      const balRes = await query('SELECT stars FROM users WHERE id = $1', [userId]);

      return res.json({
        ok: true,
        win: winAmount,
        multiplier: cashedAt,
        balance: balRes.rows[0].stars
      });
    }

  } catch (e) {
    // Этот лог ты увидишь в Vercel Logs, если что-то пойдет не так
    console.error('CRASH API ERROR:', e);
    return res.status(500).json({ error: 'Internal Error', details: e.message });
  }
};
