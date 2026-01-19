// api/live.js
const { query } = require('../db');

const ADMIN_SECRET = process.env.ADMIN_SECRET; 

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, secret, user_id } = req.query;

    // === АДМИНСКАЯ ЗОНА ===
    if (action === 'admin' || action === 'user_history') {
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      // 1. ДОСЬЕ ИГРОКА (Без изменений)
      if (action === 'user_history') {
        if (!user_id) return res.status(400).json({ error: 'Нужен user_id' });
        
        const historyRes = await query(`
            SELECT 'CASE' as type, created_at, CONCAT(case_id, ' | ', dropped_item) as info, (-case_price) as change, item_price as value FROM logs_cases WHERE user_id = $1
            UNION ALL
            SELECT 'CRASH' as type, created_at, CONCAT('x', cashout_point, ' (Crash: x', crash_point, ')') as info, profit as change, bet_amount as value FROM logs_crash WHERE user_id = $1
            ORDER BY created_at DESC LIMIT 50
        `, [user_id]);

        const totalStats = await query(`
            SELECT 
                (SELECT COALESCE(SUM(case_price),0) FROM logs_cases WHERE user_id=$1) as total_case_spend,
                (SELECT COALESCE(SUM(item_price),0) FROM logs_cases WHERE user_id=$1) as total_case_won,
                (SELECT COALESCE(SUM(bet_amount),0) FROM logs_crash WHERE user_id=$1) as total_crash_spend,
                (SELECT COALESCE(SUM(bet_amount + profit),0) FROM logs_crash WHERE user_id=$1 AND profit > 0) as total_crash_won
        `, [user_id]);

        return res.json({ history: historyRes.rows, stats: totalStats.rows[0] });
      }

      // 2. ОБЩИЙ ОТЧЕТ + ДЕТАЛИЗАЦИЯ (NEW!)
      
      // А) Общая сводка (как было)
      const mainStats = await query('SELECT * FROM admin_analytics');
      const richRes = await query('SELECT username, stars FROM users u JOIN balances b ON u.telegram_id = b.user_id ORDER BY stars DESC LIMIT 5');

      // Б) [NEW] Статистика по КАЖДОМУ КЕЙСУ
      // Группируем логи по case_id и считаем доходы/расходы
      const casesBreakdown = await query(`
        SELECT 
            case_id,
            COUNT(*) as opens,
            SUM(case_price) as revenue,        -- Сколько нам заплатили
            SUM(item_price) as expenses,       -- Сколько мы отдали предметами
            (SUM(case_price) - SUM(item_price)) as profit -- Наш навар
        FROM logs_cases
        GROUP BY case_id
        ORDER BY revenue DESC
      `);

      // В) [NEW] Статистика по CRASH
      // expenses (расходы) = ставка + профит (только если профит > 0)
      const crashBreakdown = await query(`
        SELECT 
            COUNT(*) as rounds,
            COALESCE(SUM(bet_amount), 0) as revenue,
            COALESCE(SUM(CASE WHEN profit > 0 THEN bet_amount + profit ELSE 0 END), 0) as expenses
        FROM logs_crash
      `);
      
      const crashData = crashBreakdown.rows[0];
      const crashProfit = crashData.revenue - crashData.expenses;
      const crashRTP = crashData.revenue > 0 ? ((crashData.expenses / crashData.revenue) * 100).toFixed(1) : '0';

      // Формируем детальный отчет для ИИ
      const breakdownText = casesBreakdown.rows.map(c => 
        `- ${c.case_id.toUpperCase()}: Открытий: ${c.opens} | Вход: ${c.revenue} | Выход: ${c.expenses} | Профит: ${c.profit}`
      ).join('\n');

      const s = mainStats.rows[0];
      const report = `
📊 ГЛОБАЛЬНЫЙ АУДИТ
Юзеров: ${s.total_users}
Долг перед игроками: ${s.total_liability} ★

📦 ДЕТАЛИЗАЦИЯ ПО КЕЙСАМ:
${breakdownText}

🚀 ДЕТАЛИЗАЦИЯ CRASH:
Ставок: ${crashData.rounds}
Принято ставок: ${crashData.revenue}
Выплачено выигрышей: ${crashData.expenses}
Чистый профит: ${crashProfit} (RTP: ${crashRTP}%)
      `;

      return res.json({
        stats: s,
        cases_detailed: casesBreakdown.rows,
        crash_detailed: { ...crashData, profit: crashProfit, rtp: crashRTP },
        full_report: report
      });
    }

    // === ОБЫЧНАЯ ЛЕНТА ===
    const result = await query('SELECT * FROM live_drops ORDER BY id DESC LIMIT 30');
    return res.json(result.rows);

  } catch (e) {
    console.error('API Error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
