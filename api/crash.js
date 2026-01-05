import { query } from '../db';
const crypto = require('crypto');

// === НАСТРОЙКИ ===
// RTP 70% означает, что House Edge (доля казино) = 30% (0.30)
// Формула: (1 - HouseEdge) / (1 - random)
// То есть 0.70 / (1 - random)
const HOUSE_EDGE = 0.30; 

// Хелпер авторизации
const getUserId = (req) => {
  // TODO: Замени на реальную проверку (JWT / session)
  return 1; 
};

// Формула роста (должна совпадать с фронтендом!)
const getMultiplier = (ms) => Math.pow(Math.E, 0.00006 * ms);

// === ГЕНЕРАЦИЯ КРАША (RTP 70%) ===
const generateCrashPoint = () => {
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  const maxUint32 = Math.pow(2, 32);
  const r = randomBuffer[0] / maxUint32; // 0.0 ... 1.0

  // Главная формула
  // При HOUSE_EDGE = 0.30:
  // Если r < 0.30 -> результат < 1.00 (Мгновенный краш)
  // Если r = 0.90 -> 0.7 / 0.1 = 7.00x
  const result = (1 - HOUSE_EDGE) / (1 - r);

  const crashPoint = Math.floor(result * 100) / 100;

  // Если выпало меньше 1.00, считаем это мгновенным крашем
  if (crashPoint < 1.00) {
    return 1.00; 
  }
  
  // Лимит, чтобы не улетело в бесконечность (можно поставить хоть 1000)
  if (crashPoint > 100) {
    return 100.00;
  }

  return crashPoint;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const userId = getUserId(req);
  const { action, bet, gameId } = req.body;

  try {
    // --- 1. СТАРТ ---
    if (action === 'start') {
      if (!bet || bet <= 0) return res.status(400).json({ error: 'Неверная ставка' });

      // Проверка баланса
      const userRes = await query('SELECT stars FROM users WHERE id = $1', [userId]);
      const balance = userRes.rows[0]?.stars || 0;

      if (balance < bet) return res.status(400).json({ error: 'Недостаточно средств' });

      // Списание
      await query('UPDATE users SET stars = stars - $1 WHERE id = $2', [bet, userId]);

      // Генерация точки краша
      const crashPoint = generateCrashPoint();
      const startTime = Date.now();

      // Запись игры
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

      // Проверка времени
      const now = Date.now();
      const elapsed = now - parseInt(game.start_time);
      const serverMultiplier = getMultiplier(elapsed);
      
      const cashedAt = Math.floor(serverMultiplier * 100) / 100;

      // Успел или нет?
      if (cashedAt > parseFloat(game.crash_point)) {
        await query("UPDATE crash_games SET status = 'busted' WHERE id = $1", [gameId]);
        return res.json({ ok: false, reason: 'Crashed', crashPoint: game.crash_point });
      }

      // Победа
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
    console.error(e);
    await query('ROLLBACK');
    return res.status(500).json({ error: 'Internal Error' });
  }
}
