const { query } = require('../db');

module.exports = async (req, res) => {
  // На всякий случай заголовки, чтобы не было CORS проблем
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  const { caseId } = req.query;
  
  if (!caseId) {
    return res.json([]); 
  }

  try {
    // Достаем предметы для конкретного кейса
    // Сортируем от дорогих к дешевым
    const result = await query(
      'SELECT name, image_url, is_rare, stars_cost FROM items WHERE case_id = $1 ORDER BY stars_cost ASC', 
      [caseId]
    );
    
    return res.json(result.rows);
  } catch (e) {
    console.error('[Case Items Error]', e);
    return res.status(500).json([]);
  }
};
