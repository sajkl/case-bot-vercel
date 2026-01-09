const { query } = require('../db');
const crypto = require('crypto');

// === Валидация Telegram ===
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

const getMultiplier = (ms) => Math.pow(Math.E, 0.00006 * ms);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Data');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const initData = req.headers['x-telegram-data'];
    const user = verifyTelegramWebAppData(initData);
    if (!user || !user.id) return res.status(401).json({ error: 'Unauthorized' });

    const userId = user.id;
    const { action, bet, gameId } = req.body;

    // --- СДЕЛАТЬ СТАВКУ ---
    if (action === 'start') {
      if (!bet || bet <= 0) throw new Error('Неверная ставка');

      // 1. Ищем текущий раунд в фазе СТАВОК (start_time в будущем)
      const now = Date.now();
      const roundRes = await query(
        'SELECT * FROM rounds WHERE start_time > $1 ORDER BY start_time ASC LIMIT 1',
        [now]
      );

      if (roundRes.rows.length === 0) {
        throw new Error('Ставки закрыты! Ракета уже летит.');
      }
      
      const round = roundRes.rows[0];

      // 2. Баланс
      const balRes = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);
      if (balRes.rows.length === 0) throw new Error('Нет счета');
      const balance = balRes.rows[0].stars || 0;
      if (balance < bet) throw new Error('Недостаточно средств');

      // 3. Списываем и записываем ставку в ЭТОТ раунд
      await query('UPDATE balances SET stars = stars - $1 WHERE user_id = $2', [bet, userId]);

      const insertRes = await query(
        `INSERT INTO crash_games (user_id, round_id, bet_amount, crash_point, start_time, status)
         VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
        [userId, round.id, bet, round.crash_point, round.start_time]
      );

      return res.status(200).json({
        ok: true,
        gameId: insertRes.rows[0].id,
        roundId: round.id,
        balance: balance - bet
      });
    }

    // --- ЗАБРАТЬ ДЕНЬГИ ---
    if (action === 'cashout') {
      if (!gameId) throw new Error('No gameId');

      // Проверяем ставку
      const gameRes = await query('SELECT * FROM crash_games WHERE id = $1 AND user_id = $2', [gameId, userId]);
      if (gameRes.rows.length === 0) throw new Error('Игра не найдена');
      const game = gameRes.rows[0];
      if (game.status !== 'active') throw new Error('Уже завершена');

      // Проверяем, не взорвалась ли ракета
      const now = Date.now();
      const elapsed = now - parseInt(game.start_time);
      const serverMultiplier = getMultiplier(elapsed);
      const cashedAt = Math.floor(serverMultiplier * 100) / 100;

      // Если игрок нажал ПОЗЖЕ, чем был краш
      if (cashedAt > parseFloat(game.crash_point)) {
        await query("UPDATE crash_games SET status = 'busted' WHERE id = $1", [gameId]);
        return res.json({ ok: false, reason: 'Crashed', crashPoint: game.crash_point });
      }

      // Победа
      const winAmount = Math.floor(game.bet_amount * cashedAt);
      
      await query('BEGIN');
      await query("UPDATE crash_games SET status = 'cashed_out', cashout_point = $1, profit = $2 WHERE id = $3", [cashedAt, winAmount, gameId]);
      await query("UPDATE balances SET stars = stars + $1 WHERE user_id = $2", [winAmount, userId]);
      await query('COMMIT');

      const finalBal = await query('SELECT stars FROM balances WHERE user_id = $1', [userId]);

      return res.json({ ok: true, win: winAmount, multiplier: cashedAt, balance: finalBal.rows[0].stars });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
