// api/live.js
const { query } = require('../db');

// Секрет из настроек Vercel
const ADMIN_SECRET = process.env.ADMIN_SECRET; 

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, secret, user_id } = req.query;

    // === АДМИНСКАЯ ЗОНА ===
    if (action === 'admin' || action === 'user_history') {
      // 1. Проверка доступа
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      // 2. ОТЧЕТ ПО КОНКРЕТНОМУ ИГРОКУ
      if (action === 'user_history') {
        if (!user_id) return res.status(400).json({ error: 'Нужен user_id' });

        // Забираем последние 50 действий (объединяем кейсы и краш)
        const historyRes = await query(`
            SELECT 'CASE' as type, created_at, 
                   CONCAT(case_id, ' | ', dropped_item) as info, 
                   (-case_price) as change, item_price as value
            FROM logs_cases WHERE user_id = $1
            UNION ALL
            SELECT 'CRASH' as type, created_at,
                   CONCAT('x', cashout_point, ' (Crash: x', crash_point, ')') as info,
                   profit as change, bet_amount as value
            FROM logs_crash WHERE user_id = $1
            ORDER BY created_at DESC LIMIT 50
        `, [user_id]);

        // Считаем суммы (сколько всего потратил и поднял)
        const totalStats = await query(`
            SELECT 
                (SELECT COALESCE(SUM(case_price),0) FROM logs_cases WHERE user_id=$1) as total_case_spend,
                (SELECT COALESCE(SUM(item_price),0) FROM logs_cases WHERE user_id=$1) as total_case_won,
                (SELECT COALESCE(SUM(bet_amount),0) FROM logs_crash WHERE user_id=$1) as total_crash_spend,
                (SELECT COALESCE(SUM(bet_amount + profit),0) FROM logs_crash WHERE user_id=$1 AND profit > 0) as total_crash_won
        `, [user_id]);

        return res.json({ 
            history: historyRes.rows, 
            stats: totalStats.rows[0] 
        });
      }

      // 3. ОБЩИЙ ОТЧЕТ ПО ЭКОНОМИКЕ (action=admin)
      // (Тот код, который мы писали раньше)
      const mainStats = await query('SELECT * FROM admin_analytics');
      const richRes = await query('SELECT username, stars FROM users u JOIN balances b ON u.telegram_id = b.user_id ORDER BY stars DESC LIMIT 5');
      
      const s = mainStats.rows[0];
      const report = `
📊 БЫСТРЫЙ АУДИТ
Юзеров: ${s.total_users}
Долг (балансы): ${s.total_liability} ★
Открытий кейсов: ${s.total_cases_opened}
Топ-богачи: ${richRes.rows.map(r=>`${r.username}:${r.stars}`).join(', ')}
      `;

      return res.json({
        stats: s,
        full_report: report
      });
    }

    // === ОБЫЧНАЯ ЛЕНТА (ДЛЯ ИГРОКОВ) ===
    const result = await query('SELECT * FROM live_drops ORDER BY id DESC LIMIT 30');
    return res.json(result.rows);

  } catch (e) {
    console.error('API Error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
