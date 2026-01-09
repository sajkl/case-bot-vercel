const { query } = require('../db');

// === НАСТРОЙКИ ===
const BETTING_TIME_MS = 10000; // 10 секунд на ставки
const HOUSE_EDGE = 0.30;       // RTP 70%

// Генератор краша (тот же алгоритм)
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

    // 1. Ищем последний активный раунд
    // Мы ищем раунд, который либо "pending", либо "flying" (но не старый "ended")
    // Или просто берем самый последний созданный
    const lastRoundRes = await query('SELECT * FROM rounds ORDER BY created_at DESC LIMIT 1');
    let currentRound = lastRoundRes.rows[0];

    // Логика: Создавать новый раунд, если старый закончился или его вообще нет
    let needNewRound = false;

    if (!currentRound) {
      needNewRound = true;
    } else {
      // Если раунд существует, проверим, не пора ли его закончить
      const flightStart = parseInt(currentRound.start_time);
      
      // Если ракета уже должна была крашнуться (прошло много времени с начала полета)
      // Рассчитаем длительность полета до точки краша:
      // Multiplier = e^(0.00006 * t)  =>  ln(M) = 0.00006 * t  =>  t = ln(M) / 0.00006
      const flightDuration = Math.log(parseFloat(currentRound.crash_point)) / 0.00006;
      
      // Время окончания = Время старта + Длительность полета + 3 секунды запаса на анимацию взрыва
      const roundEndTime = flightStart + flightDuration + 3000;

      if (now > roundEndTime) {
        needNewRound = true;
      }
    }

    // 2. СОЗДАНИЕ НОВОГО РАУНДА (Если нужно)
    if (needNewRound) {
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

    // 3. ОПРЕДЕЛЯЕМ ТЕКУЩЕЕ СОСТОЯНИЕ ДЛЯ ИГРОКА
    const startTime = parseInt(currentRound.start_time);
    let phase = 'BETTING';
    let timeBoard = 0; // Время на табло (либо обратный отсчет, либо кэф)

    if (now < startTime) {
      // Фаза СТАВОК
      phase = 'BETTING';
      timeBoard = (startTime - now); // Сколько мс осталось до взлета
    } else {
      // Фаза ПОЛЕТА
      phase = 'FLYING';
      // Считаем текущий кэф
      const elapsed = now - startTime;
      
      // Проверяем, не долетели ли мы до краша
      const currentMult = Math.pow(Math.E, 0.00006 * elapsed);
      const crashP = parseFloat(currentRound.crash_point);

      if (currentMult >= crashP) {
        phase = 'CRASHED';
        timeBoard = crashP; // Показываем финальный кэф
      } else {
        timeBoard = currentMult; // Показываем текущий полет
      }
    }

    // 4. ПОЛУЧАЕМ СПИСОК СТАВОК (КТО ИГРАЕТ?)
    // Берем юзеров, их ставки и статус (вывел/не вывел)
    // Можно добавить JOIN users, чтобы получить имена, но пока по id
    const betsRes = await query(
      `SELECT user_id, bet_amount, status, cashout_point 
       FROM crash_games 
       WHERE round_id = $1 
       ORDER BY bet_amount DESC`, // Сортируем: крутые ставки сверху
      [currentRound.id]
    );

    // Отдаем клиенту всё инфо
    return res.json({
      roundId: currentRound.id,
      phase: phase,           // BETTING, FLYING, CRASHED
      value: timeBoard,       // Либо мс до старта, либо текущий кэф
      bets: betsRes.rows      // Список игроков в этом раунде
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'State Error' });
  }
};
