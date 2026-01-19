// api/live.js
const { query } = require('../db');

// 🔒 Берем секрет из настроек Vercel
const ADMIN_SECRET = process.env.ADMIN_SECRET; 

module.exports = async (req, res) => {
  // Настройки CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, secret } = req.query;

    // === 1. АДМИНСКАЯ АНАЛИТИКА (Для тебя и ИИ) ===
    // Вызов: /api/live?action=admin&secret=ТВОЙ_ПАРОЛЬ_ИЗ_VERCEL
    if (action === 'admin') {
      // Если переменная не задана в Vercel или пароль не совпадает — ошибка
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Доступ запрещен (Неверный секрет)' });
      }

      // Собираем статистику прямыми запросами к БД
      const usersRes = await query('SELECT COUNT(*) FROM users');
      const balanceRes = await query('SELECT COALESCE(SUM(stars), 0) FROM balances');
      const opensRes = await query('SELECT COUNT(*) FROM live_drops');
      const popItemRes = await query('SELECT item_name, COUNT(*) as c FROM live_drops GROUP BY item_name ORDER BY c DESC LIMIT 1');
      const sadUsersRes = await query('SELECT COUNT(*) FROM user_case_streaks WHERE loss_count >= 3');
      const richRes = await query('SELECT user_id, stars FROM balances ORDER BY stars DESC LIMIT 5');

      const s = {
        total_users: parseInt(usersRes.rows[0].count),
        debt_to_players: parseInt(balanceRes.rows[0].coalesce),
        total_opens: parseInt(opensRes.rows[0].count),
        top_item: popItemRes.rows[0] ? `${popItemRes.rows[0].item_name} (${popItemRes.rows[0].c} шт)` : 'Нет данных',
        users_waiting_guarant: parseInt(sadUsersRes.rows[0].count)
      };

      // Готовый текст для ChatGPT
      const report = `
=== ОТЧЕТ ПО ЭКОНОМИКЕ ===
Всего юзеров: ${s.total_users}
Баланс игроков (долг системы): ${s.debt_to_players} звезд
Открыто кейсов: ${s.total_opens}
Популярный предмет: ${s.top_item}
Игроков ждут Гарант (3 луза): ${s.users_waiting_guarant}

Топ-5 богачей: ${JSON.stringify(richRes.rows)}
      `;

      return res.json({
        stats: s,
        ai_prompt: "Проанализируй эти данные и скажи, не слишком ли много я раздаю денег?",
        full_report: report
      });
    }

    // === 2. ОБЫЧНАЯ ЛАЙВ ЛЕНТА (Для игроков) ===
    // Вызов: /api/live (по умолчанию)
    const result = await query('SELECT * FROM live_drops ORDER BY id DESC LIMIT 30');
    return res.json(result.rows);

  } catch (e) {
    console.error('Live Feed Error:', e);
    return res.status(500).json([]);
  }
};
