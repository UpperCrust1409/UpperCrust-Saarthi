const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error', err);
});

// Simple query wrapper with error context
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const dur = Date.now() - start;
    if (dur > 1000) console.warn(`[SLOW QUERY] ${dur}ms: ${text.slice(0, 80)}`);
    return res;
  } catch (err) {
    console.error('[DB ERROR]', err.message, '\nQuery:', text.slice(0, 120));
    throw err;
  }
}

async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
