// Supabase REST client (@supabase/supabase-js).
//
// NOTE: This is a SEPARATE client from db.js. The app's data layer is db.js
// (PostgreSQL via `pg`), which server.js depends on. This file only provides
// the Supabase REST client for optional use / connection testing — it does NOT
// replace db.js. Credentials are read from the environment only (never hardcode
// the API key). Set SUPABASE_URL and SUPABASE_API_KEY in .env / Hostinger.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_API_KEY
);

// All tables in this project's schema (created by initDB() in server.js).
const TABLES = [
  'users',
  'members',
  'donations',
  'events',
  'contacts',
  'gallery',
  'sliders',
  'activities',
  'achievements',
  'documents',
  'cows',
  'settings',
  'staff',
  'member_roles',
];

// Test the connection by checking every table. Runs when executed directly.
async function testConnection() {
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`Connection error [${table}]:`, error.message || error);
    } else {
      console.log(`Connected [${table}]: ${data.length} row(s) sampled`);
    }
  }
}

testConnection();

module.exports = supabase;
