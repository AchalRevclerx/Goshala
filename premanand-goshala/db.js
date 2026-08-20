const { Pool } = require('pg');

// Fail loudly and clearly if the connection string is missing. Without this,
// pg silently falls back to host=localhost:5432, which on most hosts refuses
// the connection and surfaces the confusing "AggregateError [ECONNREFUSED]"
// (no host shown) instead of telling you the real problem: DATABASE_URL is unset.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Configure it in the environment (e.g. Hostinger ' +
    'Node.js app -> Environment Variables) with your Supabase connection string. ' +
    'Use the IPv4 Supavisor pooler host (aws-0-<region>.pooler.supabase.com:6543), ' +
    'not the IPv6-only direct host (db.<ref>.supabase.co:5432).'
  );
}

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
