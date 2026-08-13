#!/usr/bin/env node
// Standalone DB backup — run by cron, independent of the web server.
//   node backup.js
// Uses SQLite's "VACUUM INTO", which is safe to run while the app is live and
// produces a compact, self-contained backup file (no WAL/SHM sidecars).
//
// Env overrides (should match server.js on the host):
//   BACKUP_DIR        where to write backups (default: <project>/data/backups)
//   BACKUP_RETENTION  how many recent backups to keep (default: 14)

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
// Honor DB_PATH so backups target the same database the server uses (which now
// lives outside the deploy directory). Falls back to the legacy in-repo path.
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'goshala.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const BACKUP_RETENTION = parseInt(process.env.BACKUP_RETENTION || '14', 10);

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database found at ${DB_PATH} — nothing to back up.`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // VACUUM INTO won't overwrite; ensure a unique path if one already exists this second.
  let dest = path.join(BACKUP_DIR, `goshala-${stamp}.db`);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(BACKUP_DIR, `goshala-${stamp}-${i}.db`);

  const db = new DatabaseSync(DB_PATH);
  try {
    db.prepare('VACUUM INTO ?').run(dest);
  } finally {
    db.close();
  }

  // Retention: keep only the newest BACKUP_RETENTION files.
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('goshala-') && f.endsWith('.db'))
    .sort();
  while (files.length > BACKUP_RETENTION) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (e) {}
  }

  console.log(`DB backup written: ${dest} (${files.length} kept)`);
}

main().catch(err => {
  console.error('DB backup failed:', err.message);
  process.exit(1);
});
