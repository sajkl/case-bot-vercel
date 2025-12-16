// db.js
const { Pool } = require('pg');

// Глобальная переменная, которая "выживает" между вызовами одной и той же горячей функции
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false, // Для Neon это часто нужно
      },
      /
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

module.exports = {
  query: async (text, params) => {
    const p = getPool();
    return p.query(text, params);
  },
};
