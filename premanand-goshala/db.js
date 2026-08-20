const { Pool } = require('pg');

// Two supported ways to configure the connection:
//   1. DATABASE_URL — a full postgresql:// connection string.
//   2. Discrete PG* vars — PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
//      (pg reads these from the environment automatically). PREFER THIS when the
//      password contains special characters like # @ % : / — those must be
//      percent-encoded inside a URL and some hosting panels (e.g. Hostinger)
//      mangle the encoding, causing "password authentication failed". With
//      discrete vars the password is a plain literal, so there is nothing to
//      encode or misparse.
//
// Without either, pg would silently fall back to localhost:5432 and produce a
// confusing "AggregateError [ECONNREFUSED]" — so we fail loudly instead.
const hasUrl = Boolean(process.env.DATABASE_URL);
const hasDiscrete = Boolean(
  process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
);

if (!hasUrl && !hasDiscrete) {
  throw new Error(
    'No database configuration found. Set DATABASE_URL, OR set discrete ' +
    'PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE env vars (recommended ' +
    'when the password has special characters, since URL encoding breaks in ' +
    'some hosting panels). Use the Supabase pooler host ' +
    '(aws-0-<region>.pooler.supabase.com), not the IPv6-only direct host ' +
    '(db.<ref>.supabase.co).'
  );
}

// When DATABASE_URL is absent, pg picks up PGHOST/PGPORT/PGUSER/PGPASSWORD/
// PGDATABASE from the environment on its own — we only need to add SSL.
const pool = new Pool(
  hasUrl
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { ssl: { rejectUnauthorized: false } }
);

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
