// api/live.js
const { query } = require('../db');

module.exports = async (req, res) => {
  // Настройки CORS (чтобы браузер не ругался)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Берем последние 30 выпавших предметов
    const result = await query('SELECT * FROM live_drops ORDER BY id DESC LIMIT 30');
    
    // Отдаем их клиенту
    res.json(result.rows);
  } catch (e) {
    console.error('Live Feed Error:', e);
    res.status(500).json([]);
  }
};
