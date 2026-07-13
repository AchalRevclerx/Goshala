const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'premanand-goshala-secret-key-2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PUBLIC_DIR = __dirname;
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'goshala.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk || mimeOk);
  }
});

let db;

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

function runSQL(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDB();
}

function runInsert(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  stmt.step();
  stmt.free();
  const result = db.exec("SELECT last_insert_rowid() as id");
  saveDB();
  return result[0]?.values[0]?.[0];
}

function execSQL(sql) {
  db.exec(sql);
  saveDB();
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  try { db.run("ALTER TABLE members ADD COLUMN roles TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE members ADD COLUMN working_valid_till TEXT"); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    pan TEXT,
    address TEXT,
    amount REAL NOT NULL,
    purpose TEXT,
    payment_method TEXT DEFAULT 'offline',
    transaction_id TEXT,
    photo TEXT,
    status TEXT DEFAULT 'pending',
    created_by TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  try { db.run("ALTER TABLE donations ADD COLUMN purpose TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE donations ADD COLUMN created_by TEXT DEFAULT 'user'"); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    date TEXT,
    time TEXT,
    location TEXT,
    organizer TEXT,
    organizer_phone TEXT,
    organizer_email TEXT,
    image TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  try { db.run("ALTER TABLE events ADD COLUMN organizer TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE events ADD COLUMN organizer_phone TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE events ADD COLUMN organizer_email TEXT"); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    topic TEXT,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    image TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    image TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    designation TEXT,
    photo TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS member_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  const rolesExist = queryOne('SELECT COUNT(*) as count FROM member_roles');
  if (rolesExist.count === 0) {
    ['Coordinator','Manager','Seva Pramukh','Event Incharge','Donation Incharge','Accounts','Volunteer','Other'].forEach(function(r){
      runSQL('INSERT INTO member_roles (name) VALUES (?)', [r]);
    });
    console.log('Default member roles created');
  }

  const existing = queryOne('SELECT COUNT(*) as count FROM users');
  if (existing.count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    runSQL('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
      'Super Admin', 'admin@goshala.org', hash, 'admin'
    ]);
    console.log('Default admin created: admin@goshala.org / admin123');
  }

  const settingsExist = queryOne('SELECT COUNT(*) as count FROM settings');
  if (settingsExist.count === 0) {
    const defaultSettings = [
      ['site_name', 'Shri Premand Gaushala'],
      ['site_name_hi', 'श्री प्रेमानंद गोशाला'],
      ['tagline', 'गौ सेवा ही मानव सेवा'],
      ['address', 'Gaushala Road, Vrindavan, District Mathura, Uttar Pradesh - 281121'],
      ['phone', '+91-7000000000'],
      ['phone2', '+91-7000000001'],
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
      ['working_hours', 'Mon - Sun: 6:00 AM - 8:00 PM']
    ];
    defaultSettings.forEach(([key, value]) => {
      runSQL('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    });
    console.log('Default settings created');
  }

  saveDB();
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

// ===== Settings API =====
app.get('/api/settings', (req, res) => {
  const settings = queryAll('SELECT key, value FROM settings');
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
});

app.get('/api/settings/all', authMiddleware, (req, res) => {
  const settings = queryAll('SELECT * FROM settings ORDER BY id');
  res.json(settings);
});

app.put('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const { settings } = req.body;
  if (!settings || !Array.isArray(settings)) {
    return res.status(400).json({ error: 'Settings array required' });
  }
  settings.forEach(({ key, value }) => {
    const existing = queryOne('SELECT id FROM settings WHERE key = ?', [key]);
    if (existing) {
      runSQL('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
    } else {
      runSQL('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  });
  res.json({ success: true });
});

// ===== Auth API =====
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const user = queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/register', authMiddleware, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password required' });
  }
  const existing = queryOne('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const id = runInsert('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
    name, email, hash, role || 'staff'
  ]);
  res.status(201).json({ id, name, email, role: role || 'staff' });
});

// ===== Users Management (Admin) =====
app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = queryAll('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

app.put('/api/users/:id/role', authMiddleware, adminMiddleware, (req, res) => {
  const { role } = req.body;
  if (!role || !role.trim()) {
    return res.status(400).json({ error: 'Role required' });
  }
  runSQL('UPDATE users SET role = ? WHERE id = ?', [role.trim(), req.params.id]);
  res.json({ success: true });
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  runSQL('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ===== Contact API =====
app.post('/api/contact', (req, res) => {
  const { name, phone, email, topic, message } = req.body;
  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Name, phone, and message required' });
  }
  runSQL('INSERT INTO contacts (name, phone, email, topic, message) VALUES (?, ?, ?, ?, ?)', [
    name, phone, email || null, topic || null, message
  ]);
  res.status(201).json({ success: true, message: 'Message sent successfully' });
});

// ===== Donate API =====
app.post('/api/donate', upload.fields([
  { name: 'photo', maxCount: 5 }
]), (req, res) => {
  const { donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id } = req.body;
  if (!donor_name || !phone || !amount) {
    return res.status(400).json({ error: 'Name, phone, and amount required' });
  }
  const photoPaths = req.files?.photo ? req.files.photo.map(f => f.filename) : [];
  runSQL(
    'INSERT INTO donations (donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [donor_name, phone, email || null, pan || null, address || null,
    parseFloat(amount), purpose || null, payment_method || 'offline', transaction_id || null,
    photoPaths.join(',')]
  );
  res.status(201).json({ success: true, message: 'Donation recorded successfully' });
});

app.get('/api/donations/public', (req, res) => {
  const donations = queryAll('SELECT donor_name, address, amount, created_at FROM donations ORDER BY created_at DESC');
  res.json(donations);
});

app.get('/api/donations/my', authMiddleware, (req, res) => {
  const donations = queryAll('SELECT * FROM donations ORDER BY created_at DESC');
  res.json(donations);
});

// ===== Public Donation Search by Phone =====
app.get('/api/donations/search', (req, res) => {
  const { phone } = req.query;
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  const cleanPhone = phone.trim();
  const results = db.exec("SELECT * FROM donations WHERE phone = '" + cleanPhone.replace(/'/g, "''") + "' ORDER BY created_at DESC");
  if (results.length === 0 || results[0].values.length === 0) {
    return res.status(404).json({ error: 'No donations found for this phone number.' });
  }
  const cols = results[0].columns;
  const donations = results[0].values.map(function(row) {
    var obj = {};
    cols.forEach(function(c, i) { obj[c] = row[i]; });
    return obj;
  });
  res.json(donations);
});

// ===== Member API =====
app.post('/api/member/apply', upload.single('photo'), (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone required' });
  }
  const cleanPhone = phone.trim();
  const cleanEmail = email ? email.trim() : null;
  const phoneResults = db.exec("SELECT id FROM members WHERE phone = '" + cleanPhone.replace(/'/g, "''") + "'");
  if (phoneResults.length > 0 && phoneResults[0].values.length > 0) {
    return res.status(400).json({ error: 'This phone number is already registered.' });
  }
  if (cleanEmail) {
    const emailResults = db.exec("SELECT id FROM members WHERE email = '" + cleanEmail.replace(/'/g, "''") + "'");
    if (emailResults.length > 0 && emailResults[0].values.length > 0) {
      return res.status(400).json({ error: 'This email address is already registered.' });
    }
  }
  const idCard = 'GOS' + Date.now().toString().slice(-8);
  const photoPath = req.file ? req.file.filename : null;
  const validFrom = new Date().toISOString();
  const validTill = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  runSQL('INSERT INTO members (name, phone, email, address, photo, id_card_number, status, valid_from, valid_till) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    name, phone, email || null, address || null, photoPath, idCard, 'pending', validFrom, validTill
  ]);
  res.status(201).json({ success: true, id_card_number: idCard, message: 'Application submitted. Your ID: ' + idCard });
});

// ===== Events API =====
app.get('/api/events', (req, res) => {
  const events = queryAll('SELECT * FROM events ORDER BY date DESC');
  res.json(events);
});

app.post('/api/events', authMiddleware, upload.single('image'), (req, res) => {
  const { title, description, date, time, location, organizer, organizer_phone, organizer_email } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const image = req.file ? req.file.filename : null;
  runSQL('INSERT INTO events (title, description, date, time, location, organizer, organizer_phone, organizer_email, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    title, description || null, date || null, time || null, location || null, organizer || null, organizer_phone || null, organizer_email || null, image
  ]);
  res.status(201).json({ success: true });
});

app.put('/api/events/:id', authMiddleware, upload.single('image'), (req, res) => {
  const existing = queryOne('SELECT * FROM events WHERE id = ?', [req.params.id]);
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
  runSQL('UPDATE events SET title = ?, description = ?, date = ?, time = ?, location = ?, organizer = ?, organizer_phone = ?, organizer_email = ?, image = ? WHERE id = ?', [
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
});

app.delete('/api/events/:id', authMiddleware, (req, res) => {
  const existing = queryOne('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  runSQL('DELETE FROM events WHERE id = ?', [req.params.id]);
  if (existing.image) {
    const imgPath = path.join(UPLOADS_DIR, existing.image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  res.json({ success: true });
});

// ===== Gallery API =====
app.get('/api/gallery', (req, res) => {
  const images = queryAll('SELECT * FROM gallery ORDER BY created_at DESC');
  res.json(images);
});

app.post('/api/gallery', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const title = req.body.title || null;
  runSQL('INSERT INTO gallery (title, image) VALUES (?, ?)', [title, req.file.filename]);
  res.status(201).json({ success: true, filename: req.file.filename });
});

app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
  const existing = queryOne('SELECT * FROM gallery WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Image not found' });
  runSQL('DELETE FROM gallery WHERE id = ?', [req.params.id]);
  const imgPath = path.join(UPLOADS_DIR, existing.image);
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  res.json({ success: true });
});

// ===== Donations API (admin) =====
app.get('/api/donations', authMiddleware, (req, res) => {
  const donations = queryAll('SELECT * FROM donations ORDER BY created_at DESC');
  res.json(donations);
});

app.post('/api/donations', authMiddleware, adminMiddleware, upload.fields([
  { name: 'photo', maxCount: 5 }
]), (req, res) => {
  const { donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, status } = req.body;
  if (!donor_name || !phone || !amount) {
    return res.status(400).json({ error: 'Name, phone, and amount required' });
  }
  const photoPaths = req.files?.photo ? req.files.photo.map(f => f.filename) : [];
  runSQL(
    'INSERT INTO donations (donor_name, phone, email, pan, address, amount, purpose, payment_method, transaction_id, photo, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [donor_name, phone, email || null, pan || null, address || null,
    parseFloat(amount), purpose || null, payment_method || 'offline', transaction_id || null,
    photoPaths.join(','), status || 'completed', 'admin']
  );
  res.status(201).json({ success: true, message: 'Donation recorded successfully' });
});

app.get('/api/donations/:id', authMiddleware, (req, res) => {
  const donation = queryOne('SELECT * FROM donations WHERE id = ?', [req.params.id]);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  res.json(donation);
});

app.delete('/api/donations/:id', authMiddleware, adminMiddleware, (req, res) => {
  const existing = queryOne('SELECT * FROM donations WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Donation not found' });
  if (existing.photo) {
    existing.photo.split(',').forEach(function(f) {
      const imgPath = path.join(UPLOADS_DIR, f.trim());
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    });
  }
  runSQL('DELETE FROM donations WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.put('/api/donations/:id/status', authMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'completed', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  runSQL('UPDATE donations SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

// ===== Members API (admin) =====
app.get('/api/members', authMiddleware, (req, res) => {
  const members = queryAll('SELECT * FROM members ORDER BY created_at DESC');
  res.json(members);
});

app.put('/api/members/:id/status', authMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  runSQL('UPDATE members SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

app.put('/api/members/:id', authMiddleware, (req, res) => {
  const { status, roles, working_valid_till } = req.body;
  const member = queryOne('SELECT * FROM members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const newStatus = status || member.status;
  const newRoles = roles !== undefined ? roles : (member.roles || '');
  const newValidTill = working_valid_till !== undefined ? working_valid_till : (member.working_valid_till || '');
  runSQL('UPDATE members SET status = ?, roles = ?, working_valid_till = ? WHERE id = ?', [newStatus, newRoles, newValidTill, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/members/:id', authMiddleware, (req, res) => {
  const member = queryOne('SELECT * FROM members WHERE id = ?', [req.params.id]);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  runSQL('DELETE FROM members WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ===== Contacts API (admin) =====
app.get('/api/contacts', authMiddleware, (req, res) => {
  const contacts = queryAll('SELECT * FROM contacts ORDER BY created_at DESC');
  res.json(contacts);
});

// ===== Activities API =====
app.get('/api/activities', (req, res) => {
  const activities = queryAll('SELECT * FROM activities ORDER BY created_at DESC LIMIT 10');
  res.json(activities);
});

// ===== Member Search (public) =====
app.get('/api/member/search', (req, res) => {
  const { member_id, phone, mobile } = req.query;
  const phoneVal = phone || mobile;
  let member;
  if (member_id) {
    member = queryOne('SELECT * FROM members WHERE id_card_number = ?', [member_id]);
  } else if (phoneVal) {
    member = queryOne('SELECT * FROM members WHERE phone = ?', [phoneVal]);
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
    joinDate: member.valid_from,
    validTill: member.valid_till
  });
});

// ===== Member Search by name/address (public) =====
app.get('/api/members/search', (req, res) => {
  const { name, address } = req.query;
  let sql = 'SELECT id_card_number, name, phone, email, address, photo, status, valid_from, valid_till FROM members WHERE 1=1';
  const params = [];
  if (address) {
    sql += ' AND address LIKE ?';
    params.push('%' + address + '%');
  }
  if (name) {
    sql += ' AND name LIKE ?';
    params.push('%' + name + '%');
  }
  sql += ' ORDER BY name ASC';
  const members = queryAll(sql, params);
  res.json(members);
});

// ===== Staff API =====
app.get('/api/staff', (req, res) => {
  const staff = queryAll('SELECT id, name, phone, address, designation, photo FROM staff ORDER BY created_at DESC');
  res.json(staff);
});

app.get('/api/staff/search', (req, res) => {
  const { address, name } = req.query;
  let sql = 'SELECT id, name, phone, address, designation, photo FROM staff WHERE 1=1';
  const params = [];
  if (address) {
    sql += ' AND address LIKE ?';
    params.push('%' + address + '%');
  }
  if (name) {
    sql += ' AND name LIKE ?';
    params.push('%' + name + '%');
  }
  sql += ' ORDER BY name';
  const staff = queryAll(sql, params);
  res.json(staff);
});

app.post('/api/staff', authMiddleware, adminMiddleware, upload.single('photo'), (req, res) => {
  const { name, phone, email, address, designation } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const photo = req.file ? req.file.filename : null;
  const id = runInsert('INSERT INTO staff (name, phone, email, address, designation, photo) VALUES (?, ?, ?, ?, ?, ?)', [
    name, phone || null, email || null, address || null, designation || null, photo
  ]);
  res.status(201).json({ success: true, id });
});

app.put('/api/staff/:id', authMiddleware, adminMiddleware, upload.single('photo'), (req, res) => {
  const existing = queryOne('SELECT * FROM staff WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  const { name, phone, email, address, designation } = req.body;
  const photo = req.file ? req.file.filename : existing.photo;
  runSQL('UPDATE staff SET name = ?, phone = ?, email = ?, address = ?, designation = ?, photo = ? WHERE id = ?', [
    name || existing.name, phone ?? existing.phone, email ?? existing.email,
    address ?? existing.address, designation ?? existing.designation, photo, req.params.id
  ]);
  if (req.file && existing.photo) {
    const oldPath = path.join(UPLOADS_DIR, existing.photo);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  res.json({ success: true });
});

app.delete('/api/staff/:id', authMiddleware, adminMiddleware, (req, res) => {
  const existing = queryOne('SELECT * FROM staff WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Staff not found' });
  runSQL('DELETE FROM staff WHERE id = ?', [req.params.id]);
  if (existing.photo) {
    const imgPath = path.join(UPLOADS_DIR, existing.photo);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  res.json({ success: true });
});

// ===== Member Roles API =====
app.get('/api/member-roles', authMiddleware, (req, res) => {
  const roles = queryAll('SELECT * FROM member_roles ORDER BY name ASC');
  res.json(roles);
});

app.get('/api/member-roles/all', (req, res) => {
  const roles = queryAll('SELECT name FROM member_roles ORDER BY name ASC');
  res.json(roles.map(function(r){ return r.name; }));
});

app.post('/api/member-roles', authMiddleware, adminMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Role name required' });
  }
  const trimmed = name.trim();
  const existing = queryOne('SELECT id FROM member_roles WHERE name = ?', [trimmed]);
  if (existing) {
    return res.status(409).json({ error: 'Role already exists' });
  }
  runInsert('INSERT INTO member_roles (name) VALUES (?)', [trimmed]);
  res.status(201).json({ success: true, name: trimmed });
});

app.put('/api/member-roles/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Role name required' });
  }
  const trimmed = name.trim();
  const role = queryOne('SELECT * FROM member_roles WHERE id = ?', [req.params.id]);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const dup = queryOne('SELECT id FROM member_roles WHERE name = ? AND id != ?', [trimmed, req.params.id]);
  if (dup) return res.status(409).json({ error: 'Role name already exists' });
  runSQL('UPDATE member_roles SET name = ? WHERE id = ?', [trimmed, req.params.id]);
  const allMembers = queryAll('SELECT id, roles FROM members WHERE roles LIKE ?', ['%' + role.name + '%']);
  allMembers.forEach(function(m) {
    var updatedRoles = m.roles.split(',').map(function(r){ return r.trim() === role.name ? trimmed : r.trim(); }).join(', ');
    runSQL('UPDATE members SET roles = ? WHERE id = ?', [updatedRoles, m.id]);
  });
  res.json({ success: true });
});

app.delete('/api/member-roles/:id', authMiddleware, adminMiddleware, (req, res) => {
  const role = queryOne('SELECT * FROM member_roles WHERE id = ?', [req.params.id]);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  runSQL('DELETE FROM member_roles WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ===== Stats =====
app.get('/api/stats', authMiddleware, (req, res) => {
  const memberCount = queryOne('SELECT COUNT(*) as count FROM members').count;
  const donationCount = queryOne('SELECT COUNT(*) as count FROM donations').count;
  const donationTotal = parseFloat(queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM donations WHERE status = 'completed'").total);
  const contactCount = queryOne('SELECT COUNT(*) as count FROM contacts').count;
  const eventCount = queryOne('SELECT COUNT(*) as count FROM events').count;
  const galleryCount = queryOne('SELECT COUNT(*) as count FROM gallery').count;
  const staffCount = queryOne('SELECT COUNT(*) as count FROM staff').count;
  const pendingMembers = queryOne("SELECT COUNT(*) as count FROM members WHERE status = 'pending'").count;
  res.json({ memberCount, donationCount, donationTotal, contactCount, eventCount, galleryCount, staffCount, pendingMembers });
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'index.html',
  setHeaders: function(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

app.get('*', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, req.path);
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    return res.sendFile(filePath);
  }
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving directory: ${PUBLIC_DIR}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`Uploads: ${UPLOADS_DIR}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
