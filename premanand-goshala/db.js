const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

function convertParams(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => '$' + (++idx));
}

async function queryAll(sql, params = []) {
  const { rows } = await pool.query(convertParams(sql), params);
  return rows;
}

async function queryOne(sql, params = []) {
  const { rows } = await pool.query(convertParams(sql), params);
  return rows[0] || null;
}

async function runSQL(sql, params = []) {
  await pool.query(convertParams(sql), params);
}

async function runInsert(sql, params = []) {
  const converted = convertParams(sql);
  if (!/\bRETURNING\b/i.test(converted)) {
    const { rows } = await pool.query(converted + ' RETURNING id', params);
    return rows[0] ? rows[0].id : null;
  }
  const { rows } = await pool.query(converted, params);
  return rows[0] ? rows[0].id : null;
}

async function checkConnection() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1 AS ok');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { pool, queryAll, queryOne, runSQL, runInsert, checkConnection };
