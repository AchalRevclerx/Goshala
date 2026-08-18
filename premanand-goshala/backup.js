#!/usr/bin/env node
// Standalone DB backup — run by cron, independent of the web server.
//   node backup.js
// Dumps all table data as SQL INSERT statements from the Supabase PostgreSQL
// database. Supabase also provides built-in daily backups and point-in-time
// recovery on paid plans — this script is a supplementary safety net.
//
// Env overrides:
//   DATABASE_URL       PostgreSQL connection string (from .env)
//   BACKUP_DIR         where to write backups (default: <project>/data/backups)
//   BACKUP_RETENTION   how many recent backups to keep (default: 14)

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { Pool } = require('pg');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'data', 'backups');
const BACKUP_RETENTION = parseInt(process.env.BACKUP_RETENTION || '14', 10);

const TABLES = [
  'users', 'members', 'donations', 'events', 'contacts',
  'gallery', 'sliders', 'activities', 'achievements', 'documents',
  'cows', 'settings', 'staff', 'member_roles'
];

function escapeVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Nothing to back up.');
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dest = path.join(BACKUP_DIR, `goshala-${stamp}.sql`);

  const lines = ['-- Goshala DB backup ' + now.toISOString(), ''];
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
    if (rows.length === 0) continue;
    lines.push(`-- Table: ${table} (${rows.length} rows)`);
    const cols = Object.keys(rows[0]);
    for (const row of rows) {
      const vals = cols.map(c => escapeVal(row[c]));
      lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
    }
    lines.push('');
  }

  fs.writeFileSync(dest, lines.join('\n'), 'utf8');

  // Retention: keep only the newest BACKUP_RETENTION files.
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('goshala-') && f.endsWith('.sql'))
    .sort();
  while (files.length > BACKUP_RETENTION) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (e) {}
  }

  console.log(`DB backup written: ${dest} (${files.length} kept)`);
  await pool.end();
}

main().catch(err => {
  console.error('DB backup failed:', err.message);
  process.exit(1);
});
