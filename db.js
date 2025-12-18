const { Pool } = require('pg');

// Глобальная переменная для пула соединений
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false, // Обязательно для Neon
      },
      max: 1, // Лимит соединений для Serverless
      idleTimeoutMillis: 3000,
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
