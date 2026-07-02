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
    role TEXT DEFAULT 'admin',
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
    created_at DATETIME DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    pan TEXT,
    address TEXT,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'offline',
    transaction_id TEXT,
    photo TEXT,
    receipt TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    date TEXT,
    time TEXT,
    location TEXT,
    image TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);
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

  const existing = queryOne('SELECT COUNT(*) as count FROM users');
  if (existing.count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    runSQL('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
      'Super Admin', 'admin@goshala.org', hash, 'admin'
    ]);
    console.log('Default admin created: admin@goshala.org / admin123');
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

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'index.html'
}));

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

app.post('/api/donate', upload.fields([
  { name: 'photo', maxCount: 5 },
  { name: 'receipt', maxCount: 5 }
]), (req, res) => {
  const { donor_name, phone, email, pan, address, amount, payment_method, transaction_id } = req.body;
  if (!donor_name || !phone || !amount) {
    return res.status(400).json({ error: 'Name, phone, and amount required' });
  }
  const photoPaths = req.files?.photo ? req.files.photo.map(f => f.filename) : [];
  const receiptPaths = req.files?.receipt ? req.files.receipt.map(f => f.filename) : [];
  runSQL(
    'INSERT INTO donations (donor_name, phone, email, pan, address, amount, payment_method, transaction_id, photo, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [donor_name, phone, email || null, pan || null, address || null,
    parseFloat(amount), payment_method || 'offline', transaction_id || null,
    photoPaths.join(','), receiptPaths.join(',')]
  );
  res.status(201).json({ success: true, message: 'Donation recorded successfully' });
});

app.post('/api/member/apply', (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone required' });
  }
  const idCard = 'GOS' + Date.now().toString().slice(-8);
  runSQL('INSERT INTO members (name, phone, email, address, id_card_number) VALUES (?, ?, ?, ?, ?)', [
    name, phone, email || null, address || null, idCard
  ]);
  res.status(201).json({ success: true, id_card_number: idCard, message: 'Application submitted. Your ID: ' + idCard });
});

app.get('/api/events', (req, res) => {
  const events = queryAll('SELECT * FROM events ORDER BY date DESC');
  res.json(events);
});

app.post('/api/events', authMiddleware, upload.single('image'), (req, res) => {
  const { title, description, date, time, location } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const image = req.file ? req.file.filename : null;
  runSQL('INSERT INTO events (title, description, date, time, location, image) VALUES (?, ?, ?, ?, ?, ?)', [
    title, description || null, date || null, time || null, location || null, image
  ]);
  res.status(201).json({ success: true });
});

app.put('/api/events/:id', authMiddleware, upload.single('image'), (req, res) => {
  const existing = queryOne('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { title, description, date, time, location } = req.body;
  const image = req.file ? req.file.filename : existing.image;
  runSQL('UPDATE events SET title = ?, description = ?, date = ?, time = ?, location = ?, image = ? WHERE id = ?', [
    title || existing.title, description ?? existing.description, date ?? existing.date,
    time ?? existing.time, location ?? existing.location, image, req.params.id
  ]);
  if (req.file && existing.image) {
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

app.get('/api/donations', authMiddleware, (req, res) => {
  const donations = queryAll('SELECT * FROM donations ORDER BY created_at DESC');
  res.json(donations);
});

app.put('/api/donations/:id/status', authMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'completed', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  runSQL('UPDATE donations SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

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

app.get('/api/contacts', authMiddleware, (req, res) => {
  const contacts = queryAll('SELECT * FROM contacts ORDER BY created_at DESC');
  res.json(contacts);
});

app.get('/api/activities', (req, res) => {
  const activities = queryAll('SELECT * FROM activities ORDER BY created_at DESC LIMIT 10');
  res.json(activities);
});

app.get('/api/stats', authMiddleware, (req, res) => {
  const memberCount = queryOne('SELECT COUNT(*) as count FROM members').count;
  const donationCount = queryOne('SELECT COUNT(*) as count FROM donations').count;
  const donationTotal = parseFloat(queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM donations WHERE status = 'completed'").total);
  const contactCount = queryOne('SELECT COUNT(*) as count FROM contacts').count;
  const eventCount = queryOne('SELECT COUNT(*) as count FROM events').count;
  const galleryCount = queryOne('SELECT COUNT(*) as count FROM gallery').count;
  res.json({ memberCount, donationCount, donationTotal, contactCount, eventCount, galleryCount });
});

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
