// api/live.js
const { query } = require('../db');

// 🔒 Секрет из переменных Vercel
const ADMIN_SECRET = process.env.ADMIN_SECRET; 

// Описание конфига (хардкод, так как это часть логики кода, а не БД)
const GAME_CONFIG = `
🔹 ЛОГИКА ГАРАНТА (Pity System):
- Работает для каждого кейса отдельно.
- Стрик лузов хранится в БД (user_case_streaks).
- Условие: Если 3 раза подряд выпал предмет дешевле стоимости открытия -> 4-й предмет ГАРАНТИРОВАННО будет дороже стоимости открытия.
- Механика: Обычный дроп ЗАМЕНЯЕТСЯ на окупной. Выбирается самый дешевый окуп (95% шанс) или более дорогой (5%).

🔹 РИСК-МЕНЕДЖМЕНТ CRASH:
- Точка краша генерируется заранее (или по хэшу).
- House Edge: Заложен в алгоритме (обычно краш на 1.00x с шансом 3-5%).
- Лимиты: Макс. ставка и Макс. выигрыш ограничиваются на фронтенде/бэкенде (нужно проверить в api/crash).
`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, secret } = req.query;

    // === 🧠 МОЗГ АДМИНИСТРАТОРА (РАСШИРЕННЫЙ) ===
    if (action === 'admin') {
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      // 1. БАЗОВАЯ СТАТИСТИКА (Из VIEW)
      const mainStats = await query('SELECT * FROM admin_analytics');
      const s = mainStats.rows[0];

      // 2. ЭКОНОМИКА CRASH (Считаем профит казино)
      // crash_bets: profit = чистый выигрыш игрока. Если 0, значит проиграл ставку.
      const crashStats = await query(`
        SELECT 
          COUNT(*) as total_rounds,
          COALESCE(SUM(bet_amount), 0) as total_wagered,
          COALESCE(SUM(CASE WHEN profit > 0 THEN profit + bet_amount ELSE 0 END), 0) as total_payout,
          COALESCE(SUM(bet_amount) - SUM(CASE WHEN profit > 0 THEN profit + bet_amount ELSE 0 END), 0) as house_profit
        FROM crash_bets
      `);
      const c = crashStats.rows[0];
      // Считаем RTP (Return to Player) = Выплаты / Ставки * 100
      const crashRTP = c.total_wagered > 0 ? ((c.total_payout / c.total_wagered) * 100).toFixed(2) : '0';

      // 3. ЭКОНОМИКА КЕЙСОВ (Unit Economy)
      // Находим самый популярный кейс
      const topCaseRes = await query(`
        SELECT case_id, COUNT(*) as opens 
        FROM user_case_streaks 
        GROUP BY case_id 
        ORDER BY opens DESC 
        LIMIT 1
      `);
      const topCaseId = topCaseRes.rows[0]?.case_id || 'jiga'; // По дефолту жига

      // Достаем предметы этого кейса для аудита
      const itemsRes = await query(`
        SELECT name, stars_cost, chance, is_rare 
        FROM items 
        WHERE case_id = $1 
        ORDER BY stars_cost ASC
      `, [topCaseId]);

      // Формируем таблицу дропа
      const dropTable = itemsRes.rows.map(i => 
        `- ${i.name} | Цена: ${i.stars_cost} | Шанс: ${i.chance}% ${i.is_rare ? '(RARE)' : ''}`
      ).join('\n');

      // 4. ТОП БОГАЧЕЙ (Risk Control)
      const richRes = await query(`
        SELECT u.username, b.stars 
        FROM balances b 
        JOIN users u ON b.user_id = u.telegram_id 
        ORDER BY b.stars DESC LIMIT 5
      `);

      // === ГЕНЕРАЦИЯ ОТЧЕТА ===
      const report = `
📊 ГЛУБОКИЙ ФИНАНСОВЫЙ АУДИТ (Lambo Drop)

📦 ЧАСТЬ 1: ЭКОНОМИКА КЕЙСОВ
Самый популярный кейс: "${topCaseId.toUpperCase()}"
Таблица предметов (Drop List):
${dropTable}

Логика Гаранта и Настройки:
${GAME_CONFIG}

📈 ЧАСТЬ 2: РЕЖИМ CRASH (Статистика)
- Всего раундов (ставок): ${c.total_rounds}
- Общий оборот (Wagered): ${c.total_wagered} ★
- Выплачено игрокам (Won): ${c.total_payout} ★
- Прибыль системы (House Profit): ${c.house_profit} ★
- Текущий RTP (Отдача): ${crashRTP}% 
  *(Если RTP > 100%, мы теряем деньги! Норма: 90-97%)*

💰 ЧАСТЬ 3: ОБЩИЙ БАЛАНС
- Долг перед игроками (Всего звезд на руках): ${s.total_liability} ★
- Топ-5 Холдеров: ${richRes.rows.map(r => `${r.username||'Anon'}: ${r.stars}`).join(', ')}
`;

      return res.json({
        stats: s,
        ai_prompt: "Ты финансовый аудитор казино. Проанализируй эти данные. 1) Не убыточен ли Crash с таким RTP? 2) Не слишком ли щедрый дроп-лист у популярного кейса? 3) Есть ли риск банкротства из-за гаранта?",
        full_report: report
      });
    }

    // === ОБЫЧНАЯ ЛЕНТА (ДЛЯ ИГРОКОВ) ===
    const result = await query('SELECT * FROM live_drops ORDER BY id DESC LIMIT 30');
    return res.json(result.rows);

  } catch (e) {
    console.error('Live API Error:', e);
    return res.status(500).json([]);
  }
};
