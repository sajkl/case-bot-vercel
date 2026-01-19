// api/live.js
const { query } = require('../db');

// 🔒 Секрет из переменных Vercel
const ADMIN_SECRET = process.env.ADMIN_SECRET; 

module.exports = async (req, res) => {
  // Настройки CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, secret } = req.query;

    // === 🧠 АДМИНСКАЯ АНАЛИТИКА ===
    // Вызов: /api/live?action=admin&secret=ТВОЙ_ПАРОЛЬ
    if (action === 'admin') {
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      // 1. Берем общую статистику из VIEW
      const mainStats = await query('SELECT * FROM admin_analytics');
      const s = mainStats.rows[0];

      // 2. Топ-5 богачей (проверить, нет ли читеров/абузеров)
      const richRes = await query(`
        SELECT u.username, u.first_name, b.stars 
        FROM balances b 
        JOIN users u ON b.user_id = u.telegram_id 
        ORDER BY b.stars DESC LIMIT 5
      `);

      // 3. Последние 5 крупных выигрышей (Редкие предметы)
      const dropsRes = await query(`
        SELECT item_name, created_at 
        FROM live_drops 
        WHERE is_rare = true 
        ORDER BY id DESC LIMIT 5
      `);

      // === ФОРМИРУЕМ ОТЧЕТ ДЛЯ ИИ ===
      const report = `
📊 ОТЧЕТ ПО ЭКОНОМИКЕ ПРОЕКТА (Lambo Drop)

👥 АУДИТОРИЯ:
- Всего игроков: ${s.total_users}
- Новых за 24ч: ${s.new_users_24h || 'н/д'}

💰 ДЕНЬГИ (Звезды):
- Общий долг (сумма балансов): ${s.total_liability} ★
- Средний баланс на игрока: ${s.avg_balance} ★
- ТОП-5 Богачей: ${richRes.rows.map(r => `${r.first_name} (${r.stars}★)`).join(', ')}

📦 КЕЙСЫ:
- Всего открыто: ${s.total_cases_opened}
- Открыто за 24ч: ${s.cases_24h}
- Самый частый дроп: ${s.top_item}
- Последние топ-выигрыши: ${dropsRes.rows.map(d => d.item_name).join(', ')}

⚠️ РИСКИ:
- Игроков на стрике лузов (ждут Гарант): ${s.users_waiting_guarant}
`;

      return res.json({
        stats: s,
        ai_prompt: "Я владелец игры с кейсами. Проанализируй этот отчет. Нормальная ли экономика? Не слишком ли большой долг перед игроками? Есть ли подозрительные богачи?",
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
