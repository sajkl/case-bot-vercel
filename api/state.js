const { query } = require('../db');

// === НАСТРОЙКИ ===
const BETTING_TIME_MS = 10000; // 10 секунд на ставки
const HOUSE_EDGE = 0.30;       // RTP 70%

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0'); // Не кешировать!

  try {
    const now = Date.now();

    // 1. ПОЛУЧАЕМ ИСТОРИЮ (НОВОЕ!)
    // Берем последние 15 завершенных раундов для отображения сверху
    const historyRes = await query(`
      SELECT crash_point 
      FROM rounds 
      WHERE status = 'ended' 
      ORDER BY created_at DESC 
      LIMIT 15
    `);
    // Превращаем результат в простой массив чисел [2.10, 1.05, ...]
    const history = historyRes.rows.map(r => parseFloat(r.crash_point));

    // 2. Ищем последний активный раунд
    const lastRoundRes = await query('SELECT * FROM rounds ORDER BY created_at DESC LIMIT 1');
    let currentRound = lastRoundRes.rows[0];

    // Логика: Создавать новый раунд, если старый закончился или его вообще нет
    let needNewRound = false;

    if (!currentRound) {
      needNewRound = true;
    } else {
      // Если раунд существует, проверим, не пора ли его закончить
      const flightStart = parseInt(currentRound.start_time);
      
      // Если это старый "зависший" раунд или он уже прошел
      // Рассчитаем длительность полета
      const crashP = parseFloat(currentRound.crash_point);
      const flightDuration = Math.log(crashP) / 0.00006;
      
      // Время окончания = Старт + Полет + 4 секунды (запас на анимацию взрыва)
      const roundEndTime = flightStart + flightDuration + 4000;

      if (now > roundEndTime) {
        needNewRound = true;
      }
    }

    // 3. СОЗДАНИЕ НОВОГО РАУНДА (Если нужно)
    if (needNewRound) {
      // ВАЖНО: Помечаем старый раунд как 'ended', чтобы он попал в историю
      if (currentRound) {
        await query("UPDATE rounds SET status = 'ended' WHERE id = $1", [currentRound.id]);
      }

      const crashPoint = generateCrashPoint();
      // Ракета взлетит через 10 секунд от "сейчас"
      const startTime = now + BETTING_TIME_MS; 
      
      const newRound = await query(
        `INSERT INTO rounds (crash_point, start_time, status) 
         VALUES ($1, $2, 'pending') RETURNING *`,
        [crashPoint, startTime]
      );
      currentRound = newRound.rows[0];
    }

    // 4. ОПРЕДЕЛЯЕМ ТЕКУЩЕЕ СОСТОЯНИЕ ДЛЯ ИГРОКА
    const startTime = parseInt(currentRound.start_time);
    let phase = 'BETTING';
    let timeBoard = 0; // Время на табло

    if (now < startTime) {
      // Фаза СТАВОК
      phase = 'BETTING';
      timeBoard = (startTime - now); // Сколько мс осталось до взлета
    } else {
      // Фаза ПОЛЕТА
      const elapsed = now - startTime;
      
      // Проверяем, не долетели ли мы до краша
      const currentMult = Math.pow(Math.E, 0.00006 * elapsed);
      const crashP = parseFloat(currentRound.crash_point);

      if (currentMult >= crashP) {
        phase = 'CRASHED';
        timeBoard = crashP; // Показываем финальный кэф
      } else {
        phase = 'FLYING';
        timeBoard = currentMult; // Показываем текущий полет
      }
    }

    // 5. ПОЛУЧАЕМ СПИСОК СТАВОК
    const betsRes = await query(
      `SELECT user_id, bet_amount, status, cashout_point 
       FROM crash_games 
       WHERE round_id = $1 
       ORDER BY bet_amount DESC LIMIT 50`,
      [currentRound.id]
    );

    // Отдаем клиенту всё инфо + ИСТОРИЮ
    return res.json({
      roundId: currentRound.id,
      phase: phase,           // BETTING, FLYING, CRASHED
      value: timeBoard,       // Таймер или Кэф
      bets: betsRes.rows,     // Игроки
      history: history        // <-- Массив истории для полоски сверху
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'State Error' });
  }
};
