'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
const db = new DatabaseSync(config.DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  description TEXT DEFAULT '',
  icon TEXT DEFAULT '📦',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  name_ar TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  description TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  old_price REAL NOT NULL DEFAULT 0,
  image_url TEXT DEFAULT '',
  icon TEXT DEFAULT '🛍️',
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  items_json TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'جديد',
  source TEXT NOT NULL DEFAULT 'المتجر',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  psid TEXT NOT NULL,
  name TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, psid)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  text TEXT NOT NULL,
  external_id TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL DEFAULT '' UNIQUE,
  name TEXT DEFAULT '',
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  latitude REAL DEFAULT 0,
  longitude REAL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);
`);

// إضافة الأعمدة الجديدة دون فقدان البيانات الموجودة
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('products', 'colors_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'sizes_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'images_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'color_images_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('categories', 'has_options', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('categories', 'colors_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('categories', 'sizes_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'customer_id', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'latitude', 'REAL NOT NULL DEFAULT 0');
ensureColumn('orders', 'longitude', 'REAL NOT NULL DEFAULT 0');
ensureColumn('orders', 'notified_messenger', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'notified_whatsapp', 'INTEGER NOT NULL DEFAULT 0');
CREATE TABLE IF NOT EXISTS webhook_events (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, payload TEXT, created_at TEXT NOT NULL);
ensureColumn('customers', 'email', 'TEXT');
ensureColumn('customers', 'verified', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);');
// تحويل عمود phone إلى قيم مكررة (لإمكانية تسجيل زبائن ببريد بدون هاتف)
try {
  const cols = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  if (cols.includes('phone') && db.prepare('PRAGMA index_list(customers)').all().some(ix => ix.name === 'sqlite_autoindex_customers_1')) {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN;');
    const cur = db.prepare('SELECT * FROM customers').all();
    db.exec('DROP TABLE customers');
    db.exec(`CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL DEFAULT '',
      name TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      latitude REAL DEFAULT 0,
      longitude REAL DEFAULT 0,
      email TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
    for (const r of cur) db.prepare('INSERT INTO customers (phone, name, address, city, latitude, longitude, email, verified, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(r.phone || '', r.name || '', r.address || '', r.city || '', r.latitude || 0, r.longitude || 0, r.email || null, r.verified || 0, r.created_at || '');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);');
    db.exec('COMMIT; PRAGMA foreign_keys=ON;');
  }
} catch (e) { console.warn('[db] customers migration skipped:', e.message); }
ensureColumn('otp_codes', 'created_at', "TEXT NOT NULL DEFAULT ''");

function now() { return new Date().toISOString(); }

const defaults = {
  business_name: 'متجر أوبيرا',
  currency: 'د.ل',
  country: 'ليبيا',
  whatsapp_number: '218945343522',
  wa_phone_number_id: '',
  wa_access_token: '',
  messenger_link: '',
  messenger_page_token: '',
  messenger_page_id: '',
  facebook_page_id: '',
  facebook_page_token: '',
  catalog_url: '',
  ai_enabled: '1',
  ai_model: config.GEMINI_MODEL,
  greeting: 'أهلاً بك 👋 أنا مساعد {business}. كيف أقدر أساعدك اليوم؟',
  footer_text: 'نرحب بطلباتكم على مدار الساعة 🤍',
  bot_tone: 'ودود ومختصر',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n === 0) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
  db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run('admin', `${salt}:${hash}`, now());
}

if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
  const insCat = db.prepare('INSERT INTO categories (name_ar, name_en, description, icon, sort_order, created_at) VALUES (?,?,?,?,?,?)');
  insCat.run('المنتجات المميزة', 'Featured', 'أكثر المنتجات طلباً', '⭐', 1, now());
  insCat.run('العروض', 'Offers', 'عروض لفترة محدودة', '🔥', 2, now());
  insCat.run('خدمات', 'Services', 'خدماتنا للعملاء', '🛠️', 3, now());
}

if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const insProd = db.prepare('INSERT INTO products (category_id, name_ar, name_en, description, price, old_price, icon, stock, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  insProd.run(1, 'منتج تجريبي ١', 'Sample 1', 'وصف المنتج التجريدي - استبدله من لوحة الأدمن', 99, 149, '🎁', 50, now());
  insProd.run(1, 'منتج تجريبي ٢', 'Sample 2', 'وصف المنتج التجريدي - استبدله من لوحة الأدمن', 149, 0, '🎀', 30, now());
  insProd.run(2, 'عرض تجريبي', 'Sample offer', 'خصم لفترة محدودة', 59, 99, '🏷️', 20, now());
  insProd.run(3, 'خدمة تجريبية', 'Sample service', 'اشرح خدمتك هنا', 199, 0, '🧩', 100, now());
}

if (db.prepare('SELECT COUNT(*) AS n FROM faqs').get().n === 0) {
  const insFaq = db.prepare('INSERT INTO faqs (question, answer, created_at) VALUES (?,?,?)');
  insFaq.run('ما طرق الدفع؟', 'يمكن الدفع عند الاستلام أو تحويل بنكي، وسيتم إرسال التفاصيل بعد تأكيد الطلب.', now());
  insFaq.run('كم مدة التوصيل؟', 'التوصيل خلال ٢٤ إلى ٧٢ ساعة حسب المدينة.', now());
  insFaq.run('كيف أطلب؟', 'اختر المنتج من المتجر أو اكتب "أريد الطلب" وسأساعدك فوراً.', now());
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

function getSettings() {
  const out = {};
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value ?? ''));
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hex] = String(stored).split(':');
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

module.exports = { db, all, get, run, now, getSettings, setSetting, hashPassword, verifyPassword };
