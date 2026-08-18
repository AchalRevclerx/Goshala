// Load .env deterministically from the app folder (this file's directory), so the
// process finds it regardless of the working directory it was started from. The
// result is kept for startup diagnostics (whether the file was actually found).
const dotenvResult = require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  quiet: true,
});
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { queryAll, queryOne, runSQL, runInsert, checkConnection } = require('./db');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Razorpay = require('razorpay');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// Razorpay client — only enabled when both keys are provided via env.
// The SECRET stays on the server; only the public key_id is ever sent to the browser.
// Keys are read from the process environment first; if the host injects them as
// empty strings, we fall back to the values in the .env file (dotenv never
// overrides already-set environment variables, including empty ones).
const envOrDefault = (name) =>
  process.env[name] || (dotenvResult.parsed && dotenvResult.parsed[name]) || '';
const RAZORPAY_KEY_ID = envOrDefault('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = envOrDefault('RAZORPAY_KEY_SECRET');
const razorpayEnabled = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
const razorpay = razorpayEnabled
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Single admin credentials sourced from .env. When set, these take priority in
// the login check (username + password); DB users remain a fallback.
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// JWT secret resolution. Prefer the environment variable. If it's not set, we
// generate one ONCE and persist it to disk so it survives restarts — otherwise
// every restart would invalidate all issued tokens and log everyone out. It is
// still never hardcoded in source, so it can't be forged from the code.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const dataDir = path.join(__dirname, 'data');
  const secretFile = path.join(dataDir, '.jwt_secret');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing) return existing;
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn('WARNING: JWT_SECRET env not set — generated and persisted one at data/.jwt_secret. Set JWT_SECRET for multi-instance deployments.');
    return generated;
  } catch (e) {
    console.warn('WARNING: could not persist a JWT secret (' + e.message + '); using an ephemeral one. Set the JWT_SECRET env var.');
    return crypto.randomBytes(48).toString('hex');
  }
}
const JWT_SECRET = resolveJwtSecret();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Hostinger's reverse proxy; needed for correct client IPs (rate limiting)

// Security headers. CSP is left off because the static HTML relies on inline
// scripts/styles and external CDNs; enabling a strict policy would break the site.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow images/uploads to load from the pages
}));

// CORS: same-origin by default (the frontend is served by this app). Set
// ALLOWED_ORIGINS (comma-separated) only if a different origin must call the API.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiters: a tight one for auth (brute-force protection) and a broad one for the API.
// authLimiter only counts FAILED logins, so a legitimate user who signs in
// successfully is never throttled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed attempts. Please try again in 15 minutes.' },
});
// Broad ceiling for the whole API. High enough that a normal admin session
// (the dashboard fires many requests per page) never trips it.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', apiLimiter);

const PUBLIC_DIR = __dirname;
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Never trust the client extension — derive it from the allowed list only.
    const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf' };
    cb(null, `${uuidv4()}${extMap[file.mimetype] || ''}`);
  }
});
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
const ALLOWED_EXT = /\.(jpe?g|png|gif|webp|pdf)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    // Require BOTH a whitelisted MIME type and a matching extension.
    const ok = ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.test(file.originalname);
    cb(null, ok);
  }
});

// Wrap async route handlers so Express 4 catches rejections.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Safely delete an uploaded file (e.g. when a record's image is replaced/removed).
function removeUpload(filename) {
  if (!filename) return;
  try {
    const p = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) { /* ignore */ }
}

async function initDB() {
  await runSQL(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    photo TEXT,
    id_card_number TEXT,
    status TEXT DEFAULT 'pending',
    roles TEXT DEFAULT '',
    working_valid_till TEXT,
    valid_from TEXT,
    valid_till TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS donations (
    id SERIAL PRIMARY KEY,
    donor_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    pan TEXT,
    address TEXT,
    amount DOUBLE PRECISION NOT NULL,
    purpose TEXT,
    payment_method TEXT DEFAULT 'offline',
    transaction_id TEXT,
    photo TEXT,
    status TEXT DEFAULT 'pending',
    created_by TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    date TEXT,
    time TEXT,
    location TEXT,
    organizer TEXT,
    organizer_phone TEXT,
    organizer_email TEXT,
    image TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    topic TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS gallery (
    id SERIAL PRIMARY KEY,
    title TEXT,
    image TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS sliders (
    id SERIAL PRIMARY KEY,
    title TEXT,
    image TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS activities (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    image TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    image TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    file TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS cows (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    breed TEXT,
    image TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    designation TEXT,
    photo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await runSQL(`CREATE TABLE IF NOT EXISTS member_roles (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  const rolesExist = await queryOne('SELECT COUNT(*)::int as count FROM member_roles');
  if (rolesExist.count === 0) {
    const roles = ['Coordinator','Manager','Seva Pramukh','Event Incharge','Donation Incharge','Accounts','Volunteer','Other'];
    for (const r of roles) {
      await runSQL('INSERT INTO member_roles (name) VALUES ($1)', [r]);
    }
    console.log('Default member roles created');
  }

  const existing = await queryOne('SELECT COUNT(*)::int as count FROM users');
  if (existing.count === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || ADMIN_USERNAME || 'admin@goshala.org';
    const adminPassword = ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(adminPassword, 12);
    await runSQL('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)', [
      'Super Admin', adminEmail, hash, 'admin'
    ]);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('SECURITY WARNING: default admin password in use. Set ADMIN_EMAIL/ADMIN_PASSWORD env vars and change it immediately.');
    }
    console.log(`Default admin created: ${adminEmail}`);
  }

  const settingsExist = await queryOne('SELECT COUNT(*)::int as count FROM settings');
  if (settingsExist.count === 0) {
    const defaultSettings = [
      ['site_name', 'Shri Premand Gaushala'],
      ['site_name_hi', '\u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u0917\u094B\u0936\u093E\u0932\u093E'],
      ['tagline', '\u0917\u094C \u0938\u0947\u0935\u093E \u0939\u0940 \u092E\u093E\u0928\u0935 \u0938\u0947\u0935\u093E'],
      ['address', 'Gaushala Road, Vrindavan, District Mathura, Uttar Pradesh - 281121'],
      ['phone', '+91-7000000000'],
      ['phone2', '+91-7000000001'],
      ['official_mobile', '+91-7000000000'],
      ['email', 'info@premanandgaushala.org'],
      ['cin_number', 'U00000UP2024NPL000000'],
      ['registration_number', 'REG/2024/000001'],
      ['bank_name', 'Bank of Baroda, Mathura'],
      ['bank_holder', 'Shri Premand Gaushala'],
      ['bank_account', '12345678901234'],
      ['bank_ifsc', 'BARB0VRINDA'],
      ['bank_micr', '281012025'],
      ['bank_branch', 'Vrindavan, Mathura'],
      ['upi_id', 'premanandgaushala@upi'],
      ['whatsapp', 'https://wa.me/917000000000'],
      ['facebook', 'https://facebook.com'],
      ['instagram', 'https://instagram.com'],
      ['youtube', 'https://youtube.com'],
      ['twitter', 'https://twitter.com'],
      ['map_embed', 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d113200.52538001038!2d77.60682787278276!3d27.523688100000005!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x397371e0b4d2ca53%3A0x7c1ec6c5d0f50d09!2sVrindavan%2C%20Uttar%20Pradesh!5e0!3m2!1sen!2sin!4v1690000000000'],
      ['working_hours', 'Mon - Sun: 6:00 AM - 8:00 PM'],
      ['seal_org_name', '\u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u0917\u094C\u0936\u093E\u0932\u093E'],
      ['seal_reg_number', 'REG/2024/000001'],
      ['seal_location', '\u0935\u0943\u0902\u0926\u093E\u0935\u0928, \u092E\u0925\u0941\u0930\u093E'],
      ['seal_color', '#D32F2F']
    ];
    for (const [key, value] of defaultSettings) {
      await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
    }
    console.log('Default settings created');
  }

  const sealDefaults = [
    ['seal_org_name', '\u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u0917\u094C\u0936\u093E\u0932\u093E'],
    ['seal_reg_number', 'REG/2024/000001'],
    ['seal_location', '\u0935\u0943\u0902\u0926\u093E\u0935\u0928, \u092E\u0925\u0941\u0930\u093E'],
    ['seal_color', '#D32F2F']
  ];
  for (const [key, value] of sealDefaults) {
    const exists = await queryOne('SELECT id FROM settings WHERE key = $1', [key]);
    if (!exists) await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  }

  const aboutDefaults = [
    ['about_heading', 'About Us'],
    ['about_text', '\u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u0917\u094B\u0936\u093E\u0932\u093E \u090F\u0915 \u0927\u093E\u0930\u094D\u092E\u093F\u0915 \u090F\u0935\u0902 \u0938\u0947\u0935\u093E \u0938\u0902\u0938\u094D\u0925\u093E \u0939\u0948 \u091C\u094B \u0917\u093E\u092F\u094B\u0902 \u0915\u0947 \u0938\u0902\u0930\u0915\u094D\u0937\u0923 \u090F\u0935\u0902 \u0926\u0947\u0916\u092D\u093E\u0932 \u0915\u0947 \u0932\u093F\u092F\u0947 \u0938\u092E\u0930\u094D\u092A\u093F\u0924 \u0939\u0948\u0964 \u0939\u092E\u093E\u0930\u0940 \u0917\u094B\u0936\u093E\u0932\u093E \u092E\u0947\u0902 \u092C\u0942\u0922\u093C\u0940, \u092C\u0940\u092E\u093E\u0930 \u0914\u0930 \u092C\u0947\u0938\u0939\u093E\u0930\u093E \u0917\u093E\u092F\u094B\u0902 \u0915\u094B \u0906\u0936\u094D\u0930\u092F \u0926\u093F\u092F\u093E \u091C\u093E\u0924\u093E \u0939\u0948\u0964 \u0939\u092E\u093E\u0930\u093E \u0909\u0926\u094D\u0926\u0947\u0936\u094D\u092F \u0917\u093E\u092F \u092E\u093E\u0924\u093E \u0915\u0940 \u0938\u0947\u0935\u093E \u0915\u0930\u0928\u093E \u0914\u0930 \u0917\u094C \u0938\u0902\u0930\u0915\u094D\u0937\u0923 \u0915\u0947 \u092A\u094D\u0930\u0924\u093F \u0938\u092E\u093E\u091C \u092E\u0947\u0902 \u091C\u093E\u0917\u0930\u0942\u0915\u0924\u093E \u092B\u0948\u0932\u093E\u0928\u093E \u0939\u0948\u0964'],
    ['about_mission', '\u0917\u094C \u092E\u093E\u0924\u093E \u0915\u0940 \u0938\u0947\u0935\u093E, \u0909\u0928\u0915\u093E \u0938\u0902\u0930\u0915\u094D\u0937\u0923 \u0914\u0930 \u0917\u094C-\u092A\u093E\u0932\u0928 \u0915\u094B \u092C\u0922\u093C\u093E\u0935\u093E \u0926\u0947\u0928\u093E\u0964'],
    ['about_vision', '\u090F\u0915 \u0907\u0938\u0924\u0930\u0939 \u0938\u092E\u093E\u091C \u091C\u0939\u093E\u0901 \u0939\u0930 \u0917\u093E\u092F \u0915\u094B \u0938\u092E\u094D\u092E\u093E\u0928, \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924\u093E \u0914\u0930 \u092A\u094D\u092F\u093E\u0930 \u092E\u093F\u0932\u0947\u0964'],
    ['about_image', '']
  ];
  for (const [key, value] of aboutDefaults) {
    const exists = await queryOne('SELECT id FROM settings WHERE key = $1', [key]);
    if (!exists) await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  }

  const presidentDefaults = [
    ['president_name', '\u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u091C\u0940'],
    ['president_title', 'Founder & President, \u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u0917\u094B\u0936\u093E\u0932\u093E'],
    ['president_heading', '\u0917\u094C \u0938\u0947\u0935\u093E \u0939\u0940 \u0938\u092C\u0938\u0947 \u092C\u0921\u093C\u093E \u0927\u0930\u094D\u092E'],
    ['president_message', '\u092A\u094D\u0930\u093F\u092F \u0917\u094C \u092D\u0915\u094D\u0924\u094B\u0902,\n\n\u092E\u0948\u0902 \u0936\u094D\u0930\u0940 \u092A\u094D\u0930\u0947\u092E\u093E\u0928\u0902\u0926 \u0917\u094B\u0936\u093E\u0932\u093E \u0915\u0940 \u0913\u0930 \u0938\u0947 \u0906\u092A \u0938\u092D\u0940 \u0915\u093E \u0939\u093E\u0930\u094D\u0926\u093F\u0915 \u0938\u094D\u0935\u093E\u0917\u0924 \u0915\u0930\u0924\u093E \u0939\u0942\u0901\u0964 \u0939\u092E\u093E\u0930\u0940 \u0917\u094B\u0936\u093E\u0932\u093E \u0917\u093E\u092F\u094B\u0902 \u0915\u0940 \u0938\u0947\u0935\u093E \u0914\u0930 \u0909\u0928\u0915\u0947 \u0938\u0902\u0930\u0915\u094D\u0937\u0923 \u0915\u0947 \u0932\u093F\u092F\u0947 \u0938\u092E\u0930\u094D\u092A\u093F\u0924 \u0939\u0948\u0964 \u0917\u093E\u092F \u0939\u092E\u093E\u0930\u0940 \u0938\u0902\u0938\u094D\u0915\u0943\u0924\u093F \u0915\u0940 \u0906\u0927\u093E\u0930\u0936\u093F\u0932\u093E \u0939\u0948\u0902 \u0914\u0930 \u0909\u0928\u0915\u0940 \u0938\u0947\u0935\u093E \u0915\u0930\u0928\u093E \u0939\u0940 \u092E\u093E\u0928\u0935 \u0938\u0947\u0935\u093E \u0939\u0948\u0964\n\n\u0939\u092E \u0938\u092D\u0940 \u0917\u094C \u092D\u0915\u094D\u0924\u094B\u0902 \u0938\u0947 \u0928\u093F\u0935\u0947\u0926\u0928 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902 \u0915\u093F \u0935\u0947 \u0907\u0938 \u092A\u0941\u0923\u094D\u092F \u0915\u093E\u0930\u094D\u092F \u092E\u0947\u0902 \u0939\u092E\u093E\u0930\u093E \u0938\u0939\u092F\u094B\u0917 \u0915\u0930\u0947\u0902\u0964\n\n\u0917\u094C \u092E\u093E\u0924\u093E \u0915\u0940 \u091C\u092F\u0964'],
    ['president_image', '']
  ];
  for (const [key, value] of presidentDefaults) {
    const exists = await queryOne('SELECT id FROM settings WHERE key = $1', [key]);
    if (!exists) await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  }

  const miscDefaults = [
    ['official_mobile', '+91-7000000000']
  ];
  for (const [key, value] of miscDefaults) {
    const exists = await queryOne('SELECT id FROM settings WHERE key = $1', [key]);
    if (!exists) await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  }

  console.log('Database initialized');
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function noCacheMiddleware(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}

// ===== Health Check =====
app.get('/api/health/db', asyncHandler(async (req, res) => {
  const result = await checkConnection();
  if (result.ok) {
    res.json({ status: 'healthy', database: 'connected', latencyMs: result.latencyMs });
  } else {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: result.error });
  }
}));

// ===== Settings API =====
app.get('/api/settings', noCacheMiddleware, asyncHandler(async (req, res) => {
  const settings = await queryAll('SELECT key, value FROM settings');
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
}));

app.get('/api/settings/all', authMiddleware, asyncHandler(async (req, res) => {
  const settings = await queryAll('SELECT * FROM settings ORDER BY id');
  res.json(settings);
}));

app.put('/api/settings', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const { settings } = req.body;
  if (!settings || !Array.isArray(settings)) {
    return res.status(400).json({ error: 'Settings array required' });
  }
  for (const { key, value } of settings) {
    const existing = await queryOne('SELECT id FROM settings WHERE key = $1', [key]);
    if (existing) {
      await runSQL('UPDATE settings SET value = $1 WHERE key = $2', [value, key]);
    } else {
      await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
    }
  }
  res.json({ success: true });
}));

// ===== Auth API =====
app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const identifier = String(req.body.username || req.body.email || '').trim();
  const password = req.body.password || '';
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  // Env-configured single admin (ADMIN_USERNAME / ADMIN_PASSWORD) takes priority.
  if (ADMIN_USERNAME && ADMIN_PASSWORD) {
    if (identifier === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = jwt.sign({ id: 0, email: ADMIN_USERNAME, role: 'admin', name: 'Super Admin' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: 0, name: 'Super Admin', email: ADMIN_USERNAME, role: 'admin' } });
    }
  }
  // Fall back to DB users (email-based login).
  const user = await queryOne('SELECT * FROM users WHERE email = $1', [identifier]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.post('/api/auth/register', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const hash = bcrypt.hashSync(password, 12);
  const id = await runInsert('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)', [
    name, email, hash, role || 'staff'
  ]);
  res.status(201).json({ id, name, email, role: role || 'staff' });
}));

// Change own password (any authenticated user).
app.post('/api/auth/change-password', authMiddleware, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await runSQL('UPDATE users SET password = $1 WHERE id = $2', [bcrypt.hashSync(newPassword, 12), req.user.id]);
  res.json({ success: true });
}));

// ===== Users Management (Admin) =====
app.get('/api/users', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const users = await queryAll('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
}));

app.put('/api/users/:id/role', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!role || !role.trim()) {
    return res.status(400).json({ error: 'Role required' });
  }
  await runSQL('UPDATE users SET role = $1 WHERE id = $2', [role.trim(), req.params.id]);
  res.json({ success: true });
}));

app.delete('/api/users/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await runSQL('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

// ===== Contact API =====
app.post('/api/contact', asyncHandler(async (req, res) => {
  const { name, phone, email, topic, message } = req.body;
  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Name, phone, and message required' });
  }
  await runSQL('INSERT INTO contacts (name, phone, email, topic, message) VALUES ($1, $2, $3, $4, $5)', [
    name, phone, email || null, topic || null, message
  ]);
  res.status(201).json({ success: true, message: 'Message sent successfully' });
}));

// ===== Donate API =====
app.post('/api/donate', upload.fields([
  { name: 'photo', maxCount: 5 }
]), asyncHandler(async (req, res) => {
  const { donor_name, phone, email, pan, address, amount, purpose, transaction_id } = req.body;
  if (!donor_name || !phone || !amount) {
    return res.status(400).json({ error: 'Name, phone, and amount required' });
  }
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }
  const photoPaths = req.files?.photo ? req.files.photo.map(f => f.filename) : [];
  await runSQL(
    'INSERT INTO donations (donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, photo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [donor_name, phone, email || null, pan || null, address || null,
    amt, purpose || null, 'offline', transaction_id || null,
    photoPaths.join(',')]
  );
  res.status(201).json({ success: true, message: 'Donation recorded successfully' });
}));

// ===== Payment Gateway (Razorpay + UPI QR) =====

// Public config the checkout page needs. Never exposes the secret.
app.get('/api/payment/config', noCacheMiddleware, asyncHandler(async (req, res) => {
  const upiRow = await queryOne("SELECT value FROM settings WHERE key = 'upi_id'");
  const nameRow = await queryOne("SELECT value FROM settings WHERE key = 'bank_holder'");
  res.json({
    razorpay_enabled: razorpayEnabled,
    key_id: RAZORPAY_KEY_ID,
    upi_id: upiRow ? upiRow.value : '',
    payee_name: nameRow ? nameRow.value : '',
    // Human-readable reason the frontend can surface when online payment is off.
    razorpay_disabled_reason: razorpayEnabled
      ? null
      : 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set in the server environment',
  });
}));

// Build a scannable UPI QR (data URL) for the given amount from the configured UPI ID.
app.get('/api/payment/upi-qr', noCacheMiddleware, asyncHandler(async (req, res) => {
  const upiRow = await queryOne("SELECT value FROM settings WHERE key = 'upi_id'");
  const upiId = upiRow ? String(upiRow.value).trim() : '';
  if (!upiId) return res.status(400).json({ error: 'UPI ID is not configured yet.' });
  const nameRow = await queryOne("SELECT value FROM settings WHERE key = 'bank_holder'");
  const payeeName = (nameRow && nameRow.value) ? nameRow.value : 'Goshala';
  const amount = parseFloat(req.query.amount);
  let uri = 'upi://pay?pa=' + encodeURIComponent(upiId) +
    '&pn=' + encodeURIComponent(payeeName) + '&cu=INR&tn=' + encodeURIComponent('Donation');
  if (Number.isFinite(amount) && amount > 0) uri += '&am=' + amount.toFixed(2);
  const qr = await QRCode.toDataURL(uri, { width: 260, margin: 1 });
  res.json({ qr, upiUri: uri, upiId, payeeName });
}));

// Create a Razorpay order for the amount (amount is authoritative on the server).
app.post('/api/payment/order', asyncHandler(async (req, res) => {
  if (!razorpayEnabled) return res.status(503).json({ error: 'Online payment is not configured.' });
  const amt = parseFloat(req.body.amount);
  if (!Number.isFinite(amt) || amt < 1) {
    return res.status(400).json({ error: 'Amount must be at least \u20B91.' });
  }
  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amt * 100), // paise
      currency: 'INR',
      receipt: 'don_' + Date.now(),
      payment_capture: 1,
      notes: {
        donor_name: String(req.body.donor_name || '').slice(0, 100),
        phone: String(req.body.phone || '').slice(0, 20),
        purpose: String(req.body.purpose || '').slice(0, 100),
      },
    });
    res.json({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Razorpay order error:', err && err.error ? err.error : err.message);
    res.status(502).json({ error: 'Could not start payment. Please try again.' });
  }
}));

// Verify the payment signature server-side, then record the donation as completed.
app.post('/api/payment/verify', asyncHandler(async (req, res) => {
  if (!razorpayEnabled) return res.status(503).json({ error: 'Online payment is not configured.' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature,
    donor_name, phone, email, pan, address, purpose } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields.' });
  }
  // Signature = HMAC_SHA256(order_id | payment_id) keyed with the secret.
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'Payment verification failed.' });
  }
  try {
    // Fetch the payment from Razorpay for the authoritative amount/status —
    // the client cannot tamper with what actually gets recorded.
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!payment || (payment.status !== 'captured' && payment.status !== 'authorized')) {
      return res.status(400).json({ error: 'Payment not completed.' });
    }
    // Idempotency: never record the same payment twice.
    const already = await queryOne('SELECT id FROM donations WHERE transaction_id = $1', [razorpay_payment_id]);
    if (already) return res.json({ success: true, message: 'Payment already recorded.', duplicate: true });

    const amt = payment.amount / 100;
    await runInsert(
      'INSERT INTO donations (donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [donor_name || 'Donor', phone || (payment.contact || ''), email || (payment.email || null),
      pan || null, address || null, amt, purpose || 'General Donation',
      'online', razorpay_payment_id, 'completed', 'user']
    );
    res.json({ success: true, message: 'Thank you! Your donation was received.', payment_id: razorpay_payment_id, amount: amt });
  } catch (err) {
    console.error('Razorpay verify error:', err && err.error ? err.error : err.message);
    res.status(502).json({ error: 'Could not confirm payment. If money was deducted, contact us with your payment ID.' });
  }
}));

app.get('/api/donations/public', noCacheMiddleware, asyncHandler(async (req, res) => {
  const donations = await queryAll('SELECT donor_name, address, amount, created_at FROM donations ORDER BY created_at DESC');
  res.json(donations);
}));

app.get('/api/donations/my', authMiddleware, asyncHandler(async (req, res) => {
  const donations = await queryAll('SELECT * FROM donations ORDER BY created_at DESC');
  res.json(donations);
}));

// ===== Public Donation Search by Phone =====
app.get('/api/donations/search', noCacheMiddleware, asyncHandler(async (req, res) => {
  const { phone } = req.query;
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  const cleanPhone = phone.trim();
  const donations = await queryAll("SELECT * FROM donations WHERE phone = $1 ORDER BY created_at DESC", [cleanPhone]);
  if (donations.length === 0) {
    return res.status(404).json({ error: 'No donations found for this phone number.' });
  }
  res.json(donations);
}));

// ===== Member API =====
app.post('/api/member/apply', upload.single('photo'), asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone required' });
  }
  const cleanPhone = phone.trim();
  const cleanEmail = email ? email.trim() : null;
  const phoneExists = await queryOne("SELECT id FROM members WHERE phone = $1", [cleanPhone]);
  if (phoneExists) {
    return res.status(400).json({ error: 'This phone number is already registered.' });
  }
  if (cleanEmail) {
    const emailExists = await queryOne("SELECT id FROM members WHERE email = $1", [cleanEmail]);
    if (emailExists) {
      return res.status(400).json({ error: 'This email address is already registered.' });
    }
  }
  const idCard = 'GOS' + Date.now().toString().slice(-8);
  const photoPath = req.file ? req.file.filename : null;
  const validFrom = new Date().toISOString();
  const validTill = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  await runSQL('INSERT INTO members (name, phone, email, address, photo, id_card_number, status, valid_from, valid_till) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    name, phone, email || null, address || null, photoPath, idCard, 'pending', validFrom, validTill
  ]);
  res.status(201).json({ success: true, id_card_number: idCard, message: 'Application submitted. Your ID: ' + idCard });
}));

// ===== Events API =====
app.get('/api/events', noCacheMiddleware, asyncHandler(async (req, res) => {
  const events = await queryAll('SELECT * FROM events ORDER BY date DESC');
  res.json(events);
}));

app.post('/api/events', authMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const { title, description, date, time, location, organizer, organizer_phone, organizer_email } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const image = req.file ? req.file.filename : null;
  await runSQL('INSERT INTO events (title, description, date, time, location, organizer, organizer_phone, organizer_email, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    title, description || null, date || null, time || null, location || null, organizer || null, organizer_phone || null, organizer_email || null, image
  ]);
  res.status(201).json({ success: true });
}));

app.put('/api/events/:id', authMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM events WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { title, description, date, time, location, organizer, organizer_phone, organizer_email, removeImage } = req.body;
  let image;
  if (req.file) {
    image = req.file.filename;
  } else if (removeImage === 'true') {
    image = null;
  } else {
    image = existing.image;
  }
  await runSQL('UPDATE events SET title = $1, description = $2, date = $3, time = $4, location = $5, organizer = $6, organizer_phone = $7, organizer_email = $8, image = $9 WHERE id = $10', [
    title || existing.title, description ?? existing.description, date ?? existing.date,
    time ?? existing.time, location ?? existing.location, organizer ?? existing.organizer,
    organizer_phone ?? existing.organizer_phone, organizer_email ?? existing.organizer_email,
    image, req.params.id
  ]);
  if (existing.image && image !== existing.image) {
    const oldPath = path.join(UPLOADS_DIR, existing.image);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  res.json({ success: true });
}));

app.delete('/api/events/:id', authMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM events WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  await runSQL('DELETE FROM events WHERE id = $1', [req.params.id]);
  if (existing.image) {
    const imgPath = path.join(UPLOADS_DIR, existing.image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  res.json({ success: true });
}));

// ===== Gallery API =====
app.get('/api/gallery', noCacheMiddleware, asyncHandler(async (req, res) => {
  const images = await queryAll('SELECT * FROM gallery ORDER BY created_at DESC');
  res.json(images);
}));

app.post('/api/gallery', authMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const title = req.body.title || null;
  await runSQL('INSERT INTO gallery (title, image) VALUES ($1, $2)', [title, req.file.filename]);
  res.status(201).json({ success: true, filename: req.file.filename });
}));

app.delete('/api/gallery/:id', authMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM gallery WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Image not found' });
  await runSQL('DELETE FROM gallery WHERE id = $1', [req.params.id]);
  const imgPath = path.join(UPLOADS_DIR, existing.image);
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  res.json({ success: true });
}));

// ===== Slider / Carousel API =====
app.get('/api/sliders', noCacheMiddleware, asyncHandler(async (req, res) => {
  const sliders = await queryAll('SELECT * FROM sliders ORDER BY sort_order ASC, id ASC');
  res.json(sliders);
}));

app.post('/api/sliders', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const title = req.body.title || null;
  const sort_order = parseInt(req.body.sort_order) || 0;
  await runInsert('INSERT INTO sliders (title, image, sort_order) VALUES ($1, $2, $3)', [title, req.file.filename, sort_order]);
  res.status(201).json({ success: true, filename: req.file.filename });
}));

app.put('/api/sliders/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM sliders WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Slider not found' });
  await runSQL('UPDATE sliders SET title = $1, sort_order = $2 WHERE id = $3', [
    req.body.title !== undefined ? req.body.title : existing.title,
    req.body.sort_order !== undefined ? (parseInt(req.body.sort_order) || 0) : existing.sort_order,
    req.params.id
  ]);
  res.json({ success: true });
}));

app.delete('/api/sliders/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM sliders WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Slider not found' });
  await runSQL('DELETE FROM sliders WHERE id = $1', [req.params.id]);
  const imgPath = path.join(UPLOADS_DIR, existing.image);
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  res.json({ success: true });
}));

// ===== Donations API (admin) =====
app.get('/api/donations', authMiddleware, asyncHandler(async (req, res) => {
  const donations = await queryAll('SELECT * FROM donations ORDER BY created_at DESC');
  res.json(donations);
}));

app.post('/api/donations', authMiddleware, adminMiddleware, upload.fields([
  { name: 'photo', maxCount: 5 }
]), asyncHandler(async (req, res) => {
  const { donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, status } = req.body;
  if (!donor_name || !phone || !amount) {
    return res.status(400).json({ error: 'Name, phone, and amount required' });
  }
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }
  const photoPaths = req.files?.photo ? req.files.photo.map(f => f.filename) : [];
  await runSQL(
    'INSERT INTO donations (donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, photo, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
    [donor_name, phone, email || null, pan || null, address || null,
    amt, purpose || null, payment_method || 'offline', transaction_id || null,
    photoPaths.join(','), status || 'completed', 'admin']
  );
  res.status(201).json({ success: true, message: 'Donation recorded successfully' });
}));

app.get('/api/donations/:id', authMiddleware, asyncHandler(async (req, res) => {
  const donation = await queryOne('SELECT * FROM donations WHERE id = $1', [req.params.id]);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  res.json(donation);
}));

app.delete('/api/donations/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM donations WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Donation not found' });
  if (existing.photo) {
    existing.photo.split(',').forEach(function(f) {
      const imgPath = path.join(UPLOADS_DIR, f.trim());
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    });
  }
  await runSQL('DELETE FROM donations WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

app.put('/api/donations/:id/status', authMiddleware, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'completed', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await runSQL('UPDATE donations SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ success: true });
}));

// ===== Members API (admin) =====
app.get('/api/members', authMiddleware, asyncHandler(async (req, res) => {
  const members = await queryAll('SELECT * FROM members ORDER BY created_at DESC');
  res.json(members);
}));

app.put('/api/members/:id/status', authMiddleware, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await runSQL('UPDATE members SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ success: true });
}));

app.put('/api/members/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { status, roles, working_valid_till, name, phone, email, address } = req.body;
  const member = await queryOne('SELECT * FROM members WHERE id = $1', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const newStatus = status || member.status;
  const newRoles = roles !== undefined ? roles : (member.roles || '');
  const newValidTill = working_valid_till !== undefined ? working_valid_till : (member.working_valid_till || '');

  // Editable member fields — let admin correct wrong details from the application.
  const newName = (name !== undefined && String(name).trim()) ? String(name).trim() : member.name;
  const newPhone = (phone !== undefined && String(phone).trim()) ? String(phone).trim() : member.phone;
  const newEmail = email !== undefined ? (String(email).trim() || null) : member.email;
  const newAddress = address !== undefined ? (String(address).trim() || null) : member.address;

  // Phone/email must stay unique across other members.
  const phoneClash = await queryOne('SELECT id FROM members WHERE phone = $1 AND id != $2', [newPhone, req.params.id]);
  if (phoneClash) return res.status(400).json({ error: 'Another member already uses this phone number.' });
  if (newEmail) {
    const emailClash = await queryOne('SELECT id FROM members WHERE email = $1 AND id != $2', [newEmail, req.params.id]);
    if (emailClash) return res.status(400).json({ error: 'Another member already uses this email address.' });
  }

  await runSQL(
    'UPDATE members SET status = $1, roles = $2, working_valid_till = $3, name = $4, phone = $5, email = $6, address = $7 WHERE id = $8',
    [newStatus, newRoles, newValidTill, newName, newPhone, newEmail, newAddress, req.params.id]
  );
  res.json({ success: true });
}));

app.delete('/api/members/:id', authMiddleware, asyncHandler(async (req, res) => {
  const member = await queryOne('SELECT * FROM members WHERE id = $1', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  await runSQL('DELETE FROM members WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

// ===== Contacts API (admin) =====
app.get('/api/contacts', authMiddleware, asyncHandler(async (req, res) => {
  const contacts = await queryAll('SELECT * FROM contacts ORDER BY created_at DESC');
  res.json(contacts);
}));

// ===== Activities API =====
app.get('/api/activities', noCacheMiddleware, asyncHandler(async (req, res) => {
  const activities = await queryAll('SELECT * FROM activities ORDER BY created_at DESC LIMIT 20');
  res.json(activities);
}));

app.post('/api/activities', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const image = req.file ? req.file.filename : null;
  const id = await runInsert('INSERT INTO activities (title, description, image) VALUES ($1, $2, $3)', [title, description || null, image]);
  res.status(201).json({ success: true, id });
}));

app.put('/api/activities/:id', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM activities WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });
  const { title, description } = req.body;
  const image = req.file ? req.file.filename : existing.image;
  await runSQL('UPDATE activities SET title = $1, description = $2, image = $3 WHERE id = $4',
    [title || existing.title, description ?? existing.description, image, req.params.id]);
  if (req.file && existing.image) removeUpload(existing.image);
  res.json({ success: true });
}));

app.delete('/api/activities/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM activities WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });
  await runSQL('DELETE FROM activities WHERE id = $1', [req.params.id]);
  if (existing.image) removeUpload(existing.image);
  res.json({ success: true });
}));

// ===== Achievements API =====
app.get('/api/achievements', noCacheMiddleware, asyncHandler(async (req, res) => {
  res.json(await queryAll('SELECT * FROM achievements ORDER BY sort_order ASC, id DESC'));
}));

app.post('/api/achievements', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const image = req.file ? req.file.filename : null;
  const sort_order = parseInt(req.body.sort_order) || 0;
  const id = await runInsert('INSERT INTO achievements (title, description, image, sort_order) VALUES ($1, $2, $3, $4)',
    [title, description || null, image, sort_order]);
  res.status(201).json({ success: true, id });
}));

app.put('/api/achievements/:id', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM achievements WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Achievement not found' });
  const { title, description } = req.body;
  const image = req.file ? req.file.filename : existing.image;
  const sort_order = req.body.sort_order !== undefined ? (parseInt(req.body.sort_order) || 0) : existing.sort_order;
  await runSQL('UPDATE achievements SET title = $1, description = $2, image = $3, sort_order = $4 WHERE id = $5',
    [title || existing.title, description ?? existing.description, image, sort_order, req.params.id]);
  if (req.file && existing.image) removeUpload(existing.image);
  res.json({ success: true });
}));

app.delete('/api/achievements/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM achievements WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Achievement not found' });
  await runSQL('DELETE FROM achievements WHERE id = $1', [req.params.id]);
  if (existing.image) removeUpload(existing.image);
  res.json({ success: true });
}));

// ===== Documents API (reports/certificates) =====
app.get('/api/documents', noCacheMiddleware, asyncHandler(async (req, res) => {
  res.json(await queryAll('SELECT * FROM documents ORDER BY sort_order ASC, id DESC'));
}));

app.post('/api/documents', authMiddleware, adminMiddleware, upload.single('file'), asyncHandler(async (req, res) => {
  const { title, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const sort_order = parseInt(req.body.sort_order) || 0;
  const id = await runInsert('INSERT INTO documents (title, category, file, sort_order) VALUES ($1, $2, $3, $4)',
    [title, category || null, req.file.filename, sort_order]);
  res.status(201).json({ success: true, id });
}));

app.put('/api/documents/:id', authMiddleware, adminMiddleware, upload.single('file'), asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  const { title, category } = req.body;
  const file = req.file ? req.file.filename : existing.file;
  const sort_order = req.body.sort_order !== undefined ? (parseInt(req.body.sort_order) || 0) : existing.sort_order;
  await runSQL('UPDATE documents SET title = $1, category = $2, file = $3, sort_order = $4 WHERE id = $5',
    [title || existing.title, category ?? existing.category, file, sort_order, req.params.id]);
  if (req.file && existing.file) removeUpload(existing.file);
  res.json({ success: true });
}));

app.delete('/api/documents/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  await runSQL('DELETE FROM documents WHERE id = $1', [req.params.id]);
  if (existing.file) removeUpload(existing.file);
  res.json({ success: true });
}));

// ===== Our Cows API =====
app.get('/api/cows', noCacheMiddleware, asyncHandler(async (req, res) => {
  res.json(await queryAll('SELECT * FROM cows ORDER BY sort_order ASC, id DESC'));
}));

app.post('/api/cows', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const { name, breed } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const image = req.file ? req.file.filename : null;
  const sort_order = parseInt(req.body.sort_order) || 0;
  const id = await runInsert('INSERT INTO cows (name, breed, image, sort_order) VALUES ($1, $2, $3, $4)',
    [name, breed || null, image, sort_order]);
  res.status(201).json({ success: true, id });
}));

app.put('/api/cows/:id', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM cows WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Cow not found' });
  const { name, breed } = req.body;
  const image = req.file ? req.file.filename : existing.image;
  const sort_order = req.body.sort_order !== undefined ? (parseInt(req.body.sort_order) || 0) : existing.sort_order;
  await runSQL('UPDATE cows SET name = $1, breed = $2, image = $3, sort_order = $4 WHERE id = $5',
    [name || existing.name, breed ?? existing.breed, image, sort_order, req.params.id]);
  if (req.file && existing.image) removeUpload(existing.image);
  res.json({ success: true });
}));

app.delete('/api/cows/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM cows WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Cow not found' });
  await runSQL('DELETE FROM cows WHERE id = $1', [req.params.id]);
  if (existing.image) removeUpload(existing.image);
  res.json({ success: true });
}));

// ===== President's Message (settings + optional photo upload) =====
async function upsertSetting(key, value) {
  const existing = await queryOne('SELECT id FROM settings WHERE key = $1', [key]);
  if (existing) await runSQL('UPDATE settings SET value = $1 WHERE key = $2', [value, key]);
  else await runSQL('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
}

app.post('/api/president', authMiddleware, adminMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  const { name, title, heading, message } = req.body;
  if (name !== undefined) await upsertSetting('president_name', name);
  if (title !== undefined) await upsertSetting('president_title', title);
  if (heading !== undefined) await upsertSetting('president_heading', heading);
  if (message !== undefined) await upsertSetting('president_message', message);
  if (req.file) {
    const old = await queryOne("SELECT value FROM settings WHERE key = 'president_image'");
    await upsertSetting('president_image', req.file.filename);
    if (old && old.value) removeUpload(old.value);
  }
  res.json({ success: true });
}));

// ===== Member Search (public) =====
app.get('/api/member/search', noCacheMiddleware, asyncHandler(async (req, res) => {
  const { member_id, phone, mobile } = req.query;
  const phoneVal = phone || mobile;
  let member;
  if (member_id) {
    member = await queryOne('SELECT * FROM members WHERE id_card_number = $1', [member_id]);
  } else if (phoneVal) {
    member = await queryOne('SELECT * FROM members WHERE phone = $1', [phoneVal]);
  } else {
    return res.status(400).json({ error: 'Provide member_id or phone' });
  }
  if (!member) return res.status(404).json({ error: 'Member not found' });
  res.json({
    status: member.status,
    name: member.name,
    memberId: member.id_card_number,
    mobile: member.phone,
    phone: member.phone,
    email: member.email,
    address: member.address,
    photo: member.photo,
    roles: member.roles || '',
    joinDate: member.valid_from,
    validTill: member.valid_till
  });
}));

// ===== Member Search by name/address (public) =====
app.get('/api/members/search', noCacheMiddleware, asyncHandler(async (req, res) => {
  const { name, address } = req.query;
  let sql = 'SELECT id_card_number, name, phone, email, address, photo, status, valid_from, valid_till FROM members WHERE 1=1';
  const params = [];
  if (address) {
    params.push('%' + address + '%');
    sql += ' AND address ILIKE $' + params.length;
  }
  if (name) {
    params.push('%' + name + '%');
    sql += ' AND name ILIKE $' + params.length;
  }
  sql += ' ORDER BY name ASC';
  const members = await queryAll(sql, params);
  res.json(members);
}));

// ===== Staff API =====
app.get('/api/staff', noCacheMiddleware, asyncHandler(async (req, res) => {
  const staff = await queryAll('SELECT id, name, phone, address, designation, photo FROM staff ORDER BY created_at DESC');
  res.json(staff);
}));

app.get('/api/staff/search', noCacheMiddleware, asyncHandler(async (req, res) => {
  const { address, name } = req.query;
  let sql = 'SELECT id, name, phone, address, designation, photo FROM staff WHERE 1=1';
  const params = [];
  if (address) {
    params.push('%' + address + '%');
    sql += ' AND address ILIKE $' + params.length;
  }
  if (name) {
    params.push('%' + name + '%');
    sql += ' AND name ILIKE $' + params.length;
  }
  sql += ' ORDER BY name';
  const staff = await queryAll(sql, params);
  res.json(staff);
}));

app.post('/api/staff', authMiddleware, adminMiddleware, upload.single('photo'), asyncHandler(async (req, res) => {
  const { name, phone, email, address, designation } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const photo = req.file ? req.file.filename : null;
  const id = await runInsert('INSERT INTO staff (name, phone, email, address, designation, photo) VALUES ($1, $2, $3, $4, $5, $6)', [
    name, phone || null, email || null, address || null, designation || null, photo
  ]);
  res.status(201).json({ success: true, id });
}));

app.put('/api/staff/:id', authMiddleware, adminMiddleware, upload.single('photo'), asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM staff WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  const { name, phone, email, address, designation } = req.body;
  const photo = req.file ? req.file.filename : existing.photo;
  await runSQL('UPDATE staff SET name = $1, phone = $2, email = $3, address = $4, designation = $5, photo = $6 WHERE id = $7', [
    name || existing.name, phone ?? existing.phone, email ?? existing.email,
    address ?? existing.address, designation ?? existing.designation, photo, req.params.id
  ]);
  if (req.file && existing.photo) {
    const oldPath = path.join(UPLOADS_DIR, existing.photo);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  res.json({ success: true });
}));

app.delete('/api/staff/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const existing = await queryOne('SELECT * FROM staff WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  await runSQL('DELETE FROM staff WHERE id = $1', [req.params.id]);
  if (existing.photo) {
    const imgPath = path.join(UPLOADS_DIR, existing.photo);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  res.json({ success: true });
}));

// ===== Member Roles API =====
app.get('/api/member-roles', authMiddleware, asyncHandler(async (req, res) => {
  const roles = await queryAll('SELECT * FROM member_roles ORDER BY name ASC');
  res.json(roles);
}));

app.get('/api/member-roles/all', noCacheMiddleware, asyncHandler(async (req, res) => {
  const roles = await queryAll('SELECT name FROM member_roles ORDER BY name ASC');
  res.json(roles.map(function(r){ return r.name; }));
}));

app.post('/api/member-roles', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Role name required' });
  }
  const trimmed = name.trim();
  const existing = await queryOne('SELECT id FROM member_roles WHERE name = $1', [trimmed]);
  if (existing) {
    return res.status(409).json({ error: 'Role already exists' });
  }
  await runInsert('INSERT INTO member_roles (name) VALUES ($1)', [trimmed]);
  res.status(201).json({ success: true, name: trimmed });
}));

app.put('/api/member-roles/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Role name required' });
  }
  const trimmed = name.trim();
  const role = await queryOne('SELECT * FROM member_roles WHERE id = $1', [req.params.id]);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const dup = await queryOne('SELECT id FROM member_roles WHERE name = $1 AND id != $2', [trimmed, req.params.id]);
  if (dup) return res.status(409).json({ error: 'Role name already exists' });
  await runSQL('UPDATE member_roles SET name = $1 WHERE id = $2', [trimmed, req.params.id]);
  const allMembers = await queryAll('SELECT id, roles FROM members WHERE roles LIKE $1', ['%' + role.name + '%']);
  for (const m of allMembers) {
    var updatedRoles = m.roles.split(',').map(function(r){ return r.trim() === role.name ? trimmed : r.trim(); }).join(', ');
    await runSQL('UPDATE members SET roles = $1 WHERE id = $2', [updatedRoles, m.id]);
  }
  res.json({ success: true });
}));

app.delete('/api/member-roles/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
  const role = await queryOne('SELECT * FROM member_roles WHERE id = $1', [req.params.id]);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  await runSQL('DELETE FROM member_roles WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

// ===== Stats =====
app.get('/api/stats', authMiddleware, asyncHandler(async (req, res) => {
  const memberCount = (await queryOne('SELECT COUNT(*)::int as count FROM members')).count;
  const donationCount = (await queryOne('SELECT COUNT(*)::int as count FROM donations')).count;
  const donationTotal = parseFloat((await queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM donations WHERE status = 'completed'")).total);
  const contactCount = (await queryOne('SELECT COUNT(*)::int as count FROM contacts')).count;
  const eventCount = (await queryOne('SELECT COUNT(*)::int as count FROM events')).count;
  const galleryCount = (await queryOne('SELECT COUNT(*)::int as count FROM gallery')).count;
  const staffCount = (await queryOne('SELECT COUNT(*)::int as count FROM staff')).count;
  const pendingMembers = (await queryOne("SELECT COUNT(*)::int as count FROM members WHERE status = 'pending'")).count;
  res.json({ memberCount, donationCount, donationTotal, contactCount, eventCount, galleryCount, staffCount, pendingMembers });
}));

// Block direct access to server source, config, secrets, dependencies and the DB.
// Without this, express.static(PUBLIC_DIR) would happily serve /server.js, /.env, etc.
const BLOCKED_FILES = new Set([
  '/server.js', '/backup.js', '/package.json', '/package-lock.json',
  '/.gitignore', '/.env', '/stdout.log',
]);
function isBlockedPath(reqPath) {
  const p = decodeURIComponent(reqPath).toLowerCase().replace(/\\/g, '/');
  if (p.includes('..')) return true;
  if (BLOCKED_FILES.has(p)) return true;
  if (p.startsWith('/data') || p.startsWith('/node_modules') || p.startsWith('/.git')) return true;
  if (p.startsWith('/.')) return true; // any dotfile
  if (/\.(db|db-wal|db-shm|env|log)$/.test(p)) return true;
  return false;
}
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (isBlockedPath(req.path)) return res.status(404).json({ error: 'Not found' });
  next();
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'index.html',
  dotfiles: 'ignore',
  setHeaders: function(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

app.get('*', (req, res) => {
  if (isBlockedPath(req.path)) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(PUBLIC_DIR, req.path);
  // Ensure the resolved path stays inside PUBLIC_DIR (defense-in-depth vs traversal).
  if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    return res.sendFile(filePath);
  }
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Global error handler — return clean JSON, never leak stack traces to clients.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal server error' });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving directory: ${PUBLIC_DIR}`);
    console.log(`Database: Supabase PostgreSQL`);
    console.log(`Uploads: ${UPLOADS_DIR}`);
    console.log(`Razorpay online payments: ${razorpayEnabled ? 'ENABLED' : 'DISABLED (no RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET in env)'}`);
    // Safe diagnostics for production troubleshooting — never prints the secret.
    console.log(`  dotenv: ${dotenvResult.error ? 'NO .env FILE LOADED (' + (dotenvResult.error.code || 'error') + ')' : 'loaded from ' + path.join(__dirname, '.env')}`);
    console.log(`  key_id: ${RAZORPAY_KEY_ID ? RAZORPAY_KEY_ID.slice(0, 8) + '...' : '(empty)'} | key_secret configured: ${Boolean(RAZORPAY_KEY_SECRET)}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
