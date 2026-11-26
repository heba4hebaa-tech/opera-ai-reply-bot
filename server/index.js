'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { all, get, run, now, getSettings, setSetting, hashPassword, verifyPassword } = require('./db');
const { handleIncoming, generateReply } = require('./services/chat');
const { credentials: waCredentials, sendWhatsApp } = require('./services/platforms');
const { creds: fbCreds, sendPagePost, replyPost, replyComment, graph: fbGraph } = require('./services/facebook');
const poller = require('./services/poller');

// ------------------------- Web Push (إشعارات الهاتف) -------------------------
let webPush = null;
try { webPush = require('../vendor/node_modules/web-push'); }
catch (e) { try { webPush = require('web-push'); } catch (e2) { console.error('[push] web-push غير متاح:', e.message); } }
function ensureVapid() {
  const s = getSettings();
  if (!webPush) return false;
  if (s.vapid_public_key && s.vapid_private_key) {
    try { webPush.setVapidDetails('mailto:admin@opera.local', s.vapid_public_key, s.vapid_private_key); return true; }
    catch { /* regenerate below */ }
  }
  try {
    const keys = webPush.generateVAPIDKeys();
    setSetting('vapid_public_key', keys.publicKey);
    setSetting('vapid_private_key', keys.privateKey);
    webPush.setVapidDetails('mailto:admin@opera.local', keys.publicKey, keys.privateKey);
    console.log('[push] تم توليد مفاتيح VAPID');
    return true;
  } catch (e) { console.error('[push] فشل توليد المفاتيح:', e.message); return false; }
}
ensureVapid();
async function pushToAll(title, message, url) {
  if (!ensureVapid()) return 0;
  const subs = all('SELECT endpoint, p256dh, auth FROM push_subscriptions');
  let sent = 0;
  for (const s of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: String(title || ''), body: String(message || ''), url: url || '/', icon: '/icon-192.png' }),
        { TTL: 86400 }
      );
      sent++;
    } catch (e) {
      const code = e && (e.statusCode || e.status);
      if (code === 404 || code === 410) { try { run('DELETE FROM push_subscriptions WHERE endpoint=?', s.endpoint); } catch {} }
    }
  }
  return sent;
}

// ------------------------- helpers -------------------------
const str = v => String(v ?? '').trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = iso => iso ? new Date(iso).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function json(res, code, data, headers = {}) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(data));
}
function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionToken(id) {
  const payload = Buffer.from(JSON.stringify({ u: id, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readSession(req) {
  const token = parseCookies(req).op_session;
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    const admin = get('SELECT id, username FROM admins WHERE id = ?', data.u);
    return admin || null;
  } catch { return null; }
}
function setSessionCookie(res, token) {
  const secure = res.localsProto === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `op_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}

function customerToken(id) {
  const payload = Buffer.from(JSON.stringify({ c: id, exp: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readCustomer(req) {
  const token = parseCookies(req).op_customer;
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return get('SELECT * FROM customers WHERE id = ?', data.c) || null;
  } catch { return null; }
}
function setCustomerCookie(res, token) {
  const secure = res.localsProto === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `op_customer=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

async function fetchImage(url, token) {
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    return { base64: buf.toString('base64'), mime: res.headers.get('content-type') || 'image/jpeg' };
  } catch { return null; }
}

function verifyWebhookSignature(req, raw) {
  if (!config.META_APP_SECRET) return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ------------------------- security -------------------------
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (res.localsProto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
const loginAttempts = new Map(); // key -> { count, first, lockedUntil }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}
function attemptGuard(key) {
  const t = Date.now();
  let e = loginAttempts.get(key);
  if (!e || t - e.first > LOGIN_WINDOW_MS) { e = { count: 0, first: t, lockedUntil: 0 }; loginAttempts.set(key, e); }
  if (e.lockedUntil > t) return { locked: true, retryAfter: Math.ceil((e.lockedUntil - t) / 1000) };
  return { locked: false, entry: e };
}
function recordFailure(key) {
  const g = attemptGuard(key);
  if (g.locked) return g;
  g.entry.count++;
  if (g.entry.count >= LOGIN_MAX_FAILS) g.entry.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  return { locked: false };
}

// ------------------------- router -------------------------
const routes = [];
function compile(pattern) {
  const keys = [];
  const rx = pattern.replace(/:[A-Za-z_]\w*/g, m => { keys.push(m.slice(1)); return '__PARAM__'; })
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/__PARAM__/g, '([^/]+)');
  return { regex: new RegExp('^' + rx + '$'), keys };
}
function add(method, pattern, handler, opts = {}) {
  const c = compile(pattern);
  routes.push({ method, ...c, handler, opts });
}

// ------------------------- static -------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '') rel = '/index.html';
  else if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  else if (rel === '/login') rel = '/login.html';
  const abs = path.resolve(config.PUBLIC_DIR, '.' + rel);
  if (!abs.startsWith(path.resolve(config.PUBLIC_DIR))) return text(res, 403, 'Forbidden');
  fs.readFile(abs, (err, buf) => {
    if (err) {
      if (path.extname(abs) === '.html') return fs.readFile(path.join(config.PUBLIC_DIR, 'index.html'), (e2, b2) => e2 ? text(res, 404, 'Not found') : text(res, 200, b2, MIME['.html']));
      return text(res, 404, 'Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ------------------------- public API -------------------------
add('GET', '/api/health', () => {
  const s = getSettings();
  const checks = { db: true, messenger: false, whatsapp: false, gemini: false, poller: false };
  try { all('SELECT 1 AS x LIMIT 1'); } catch { checks.db = false; }
  checks.messenger = !!(s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token);
  checks.whatsapp = !!(s.wa_access_token || config.WA_ACCESS_TOKEN);
  checks.gemini = !!config.GEMINI_API_KEY;
  try { checks.poller = !!poller.status().enabled; } catch {}
  return {
    ok: checks.db, time: now(), build: (() => { try { return require('./build'); } catch { return 'unknown'; } })(),
    uptimeSec: Math.round(process.uptime()), checks,
  };
});

add('GET', '/api/store/info', () => {
  const s = getSettings();
  return {
    businessName: s.business_name, currency: s.currency, country: s.country, footerText: s.footer_text,
    whatsappNumber: s.whatsapp_number, messengerLink: s.messenger_link, messengerPageId: s.messenger_page_id,
    catalogUrl: s.catalog_url, logoUrl: s.logo_url,
    deliveryFee: num(s.delivery_fee), deliveryFreeThreshold: num(s.delivery_free_threshold),
    deliveryNote: s.delivery_note, deliveryMethods: String(s.delivery_methods || '').split('،').map(x => x.trim()).filter(Boolean),
    businessHours: s.business_hours, returnPolicy: s.return_policy, paymentMethods: s.payment_methods, bankInfo: s.bank_info,
  };
});

add('GET', '/api/store/categories', () => ({
  items: all('SELECT id, name_ar, name_en, description, icon, has_options, colors_json, sizes_json FROM categories WHERE active = 1 ORDER BY sort_order, id'),
}));

// تحويل المتغيرات (لون/مقاس/كمية) إلى صيغة موحّدة
function normalizeVariants(raw) {
  let list = [];
  try { const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; if (Array.isArray(parsed)) list = parsed; } catch {}
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const color = str(v.color).slice(0, 80), size = str(v.size).slice(0, 80);
    if (!color && !size && !num(v.stock)) continue;
    out.push({ color, size, stock: Math.max(0, Math.floor(num(v.stock))), price: Math.max(0, num(v.price)) });
  }
  return out;
}
function variantTotal(vars, fallback) { return vars.length ? vars.reduce((s, v) => s + v.stock, 0) : Math.max(0, Math.floor(num(fallback))); }

add('GET', '/api/store/products', ({ query }) => {
  const cat = Number(query.get('category') || 0);
  const q = str(query.get('q') || '');
  const fields = 'id, category_id, name_ar, name_en, description, price, old_price, image_url, icon, stock, colors_json, sizes_json, images_json, color_images_json, variants_json, (SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id) AS avg_rating, (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS rating_count';
  const rows = cat
    ? all(`SELECT ${fields} FROM products p WHERE active=1 AND category_id=? ORDER BY p.id DESC`, cat)
    : all(`SELECT ${fields} FROM products p WHERE active=1 ORDER BY p.id DESC`);
  return { items: q ? rows.filter(p => (p.name_ar + p.name_en + p.description).toLowerCase().includes(q.toLowerCase())) : rows };
});

add('POST', '/api/store/orders', ({ body, customer }) => {
  const name = str(body.customer_name);
  const phone = str(body.phone);
  if (!name || !phone) return { status: 400, body: { error: 'الاسم ورقم الجوال مطلوبان' } };
  let items = [];
  try { items = JSON.parse(body.items_json || '[]'); } catch { items = []; }
  if (!Array.isArray(items) || !items.length) return { status: 400, body: { error: 'السلة فارغة' } };
  const clean = items.map(i => ({
    id: num(i.id), name: str(i.name).slice(0, 200), price: num(i.price),
    qty: Math.max(1, Math.min(99, num(i.qty))),
    options: str(i.options).slice(0, 200),
    color: str(i.color).slice(0, 80), size: str(i.size).slice(0, 80),
    category: i.category ? num(i.category) : (get('SELECT category_id FROM products WHERE id=?', num(i.id))?.category_id || 0),
  }));
  // التحقق من توفر الكمية لكل لون/مقاس قبل تأكيد الطلب
  for (const i of clean) {
    if (i.id <= 0) continue;
    const p = get('SELECT name_ar, variants_json FROM products WHERE id=?', i.id);
    if (!p) continue;
    let vars = []; try { vars = JSON.parse(p.variants_json || '[]'); } catch {}
    const v = vars.find(x => (x.color || '') === i.color && (x.size || '') === i.size);
    if (v && Number(v.stock) < i.qty) {
      return { status: 400, body: { error: `الكمية المتوفرة من ${p.name_ar}${i.color ? ' (' + i.color + ')' : ''}${i.size ? ' (' + i.size + ')' : ''} هي ${v.stock} فقط` } };
    }
  }
  const subtotal = clean.reduce((s, i) => s + i.price * i.qty, 0);
  const s2 = getSettings();
  const method = str(body.delivery_method) || 'توصيل للمنزل';
  const fee = method === 'توصيل للمنزل' && subtotal < num(s2.delivery_free_threshold) ? num(s2.delivery_fee) : 0;
  const total = subtotal + fee;
  const info = run(`INSERT INTO orders (customer_name, phone, address, notes, items_json, total, status, source, created_at, customer_id, latitude, longitude, delivery_fee, delivery_method, paid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    name.slice(0, 120), normalizePhone(phone).slice(0, 40) || phone.slice(0, 40), str(body.address).slice(0, 300), str(body.notes).slice(0, 500),
    JSON.stringify(clean), total, 'جديد', 'المتجر', now(), customer?.id || 0,
    num(customer?.latitude || body.latitude), num(customer?.longitude || body.longitude), fee, method, 0);
  for (const i of clean) {
    if (i.id <= 0) continue;
    const p = get('SELECT variants_json FROM products WHERE id=?', i.id);
    let vars = []; try { vars = JSON.parse(p?.variants_json || '[]'); } catch {}
    const v = vars.find(x => (x.color || '') === i.color && (x.size || '') === i.size);
    if (v) {
      v.stock = Math.max(0, Number(v.stock) - i.qty);
      run('UPDATE products SET variants_json=?, stock=MAX(0,stock-?) WHERE id=?', JSON.stringify(vars), i.qty, i.id);
    } else {
      run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', i.qty, i.id);
    }
  }
  return { ok: true, orderId: Number(info.lastInsertRowid), total };
});

add('POST', '/api/auth/login', ({ body, res, req }) => {
  const username = str(body.username);
  const password = String(body.password ?? '');
  const key = `${clientIp(req)}|${username.toLowerCase()}`;
  const guard = attemptGuard(key);
  if (guard.locked) return { status: 429, body: { error: `محاولات كثيرة — أعد المحاولة بعد ${guard.retryAfter} ثانية` } };
  const admin = get('SELECT * FROM admins WHERE username = ?', username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    recordFailure(key);
    return { status: 401, body: { error: 'بيانات الدخول غير صحيحة' } };
  }
  loginAttempts.delete(key);
  setSessionCookie(res, sessionToken(admin.id));
  return { ok: true, username: admin.username };
});
add('POST', '/api/auth/logout', ({ res }) => {
  res.setHeader('Set-Cookie', 'op_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
});
add('GET', '/api/auth/me', ({ user }) => ({ user }));

// ------------------------- customer login (OTP) -------------------------
// تطبيع الجوال — ليبيا افتراضياً: يقبل 09xxxxxxxxx, 9xxxxxxxx, 2189xxxxxxxxx, 00218..., +218...
function normalizePhone(v) {
  let d = str(v).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  d = d.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00218')) d = d.slice(3);       // 00218xxxxxxxxx → 218xxxxxxxxx
  if (d.startsWith('218')) { /* رقم مع مفتاح ليبيا */ }
  else if (d.startsWith('0')) d = '218' + d.slice(1); // 09xxxxxxxxx → 2189xxxxxxxxx
  else if (d.length <= 9) d = '218' + d;               // 9xxxxxxxx → 2189xxxxxxxxx
  // إزالة تكرار 218
  if (d.startsWith('218218')) d = d.slice(3);
  return '+' + d;
}
add('POST', '/api/customer/send-code', async ({ body }) => {
  const phone = normalizePhone(body.phone);
  if (phone.replace(/\D/g, '').length < 8) return { status: 400, body: { error: 'رقم الجوال غير صالح' } };
  run('UPDATE otp_codes SET used=1 WHERE phone=? AND used=0', phone);
  const code = String(crypto.randomInt(100000, 999999));
  run('INSERT INTO otp_codes (phone, code, expires_at, used, created_at) VALUES (?,?,?,0,?)', phone, code, Date.now() + 10 * 60 * 1000, now());
  // إرسال رمز التحقق عبر واتساب (صيغة E.164 الصحيحة: +218945343522)
  let waSent = { ok: false };
  try {
    const { token, phoneId } = waCredentials();
    if (token && phoneId) {
      const to = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;
      waSent = await sendWhatsApp(to, `رمز التحقق الخاص بك في ${getSettings().business_name || 'التطبيق'}: ${code}\nصالح لمدة 10 دقائق.`);
    }
  } catch (e) { console.error('[OTP WhatsApp]', e.message); }
  return { ok: true, phone, sentWhatsApp: !!waSent.ok, ...(waSent.ok ? {} : { demoCode: code, note: 'واتساب غير مُعدّ أو التوكن منتهي — الرمز معروض هنا للتحقق' }) };
});
add('POST', '/api/customer/verify', ({ body, res }) => {
  const phone = normalizePhone(body.phone);
  const code = str(body.code);
  const row = get('SELECT * FROM otp_codes WHERE phone=? AND code=? AND used=0 ORDER BY id DESC LIMIT 1', phone, code);
  if (!row) return { status: 400, body: { error: 'الرمز غير صحيح' } };
  if (row.expires_at < Date.now()) return { status: 400, body: { error: 'انتهت صلاحية الرمز، اطلب رمزاً جديداً' } };
  run('UPDATE otp_codes SET used=1 WHERE id=?', row.id);
  let customer = get('SELECT * FROM customers WHERE phone=?', phone);
  if (!customer) {
    run('INSERT INTO customers (phone, name, created_at) VALUES (?,?,?)', phone, '', now());
    customer = get('SELECT * FROM customers WHERE phone=?', phone);
  }
  setCustomerCookie(res, customerToken(customer.id));
  return { ok: true, customer };
});
add('POST', '/api/customer/logout', ({ res }) => {
  res.setHeader('Set-Cookie', 'op_customer=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
});
add('GET', '/api/customer/me', ({ customer }) => ({ customer: customer || null }));
add('PUT', '/api/customer/profile', ({ customer, body }) => {
  if (!customer) return { status: 401, body: { error: 'يرجى تسجيل الدخول أولاً' } };
  run('UPDATE customers SET name=?, city=?, address=?, latitude=?, longitude=? WHERE id=?',
    str(body.name).slice(0, 120), str(body.city).slice(0, 120), str(body.address).slice(0, 300),
    num(body.latitude), num(body.longitude), customer.id);
  return { ok: true, customer: get('SELECT * FROM customers WHERE id=?', customer.id) };
});

// رفع صور/أيقونات من جهاز المستخدم (يُحفظ تحت public/uploads)
add('POST', '/api/admin/upload', ({ req, raw }) => {
  if (!raw.length) return { status: 400, body: { error: 'لم يُرفع أي ملف' } };
  if (raw.length > 8 * 1024 * 1024) return { status: 400, body: { error: 'الحد الأقصى 8 ميجابايت' } };
  const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim();
  let ext = types[ctype] || path.extname(str(req.headers['x-file-name'])).replace('.', '').toLowerCase();
  ext = String(ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const dir = path.join(config.PUBLIC_DIR, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), raw);
  return { ok: true, url: `/uploads/${name}` };
}, { auth: true });

// ------------------------- admin API -------------------------
add('GET', '/api/admin/dashboard', () => {
  const s = getSettings();
  const allOrders = all('SELECT id, items_json, total, status, paid FROM orders ORDER BY id DESC LIMIT 200');
  let revenue = 0, delivered = 0, paidOrders = 0; const topMap = {};
  for (const o of allOrders) {
    if (o.status && o.status !== 'ملغي') revenue += Number(o.total) || 0;
    if (o.paid) paidOrders++;
    if (['تم الشحن', 'مكتمل'].includes(o.status)) delivered++;
    try { JSON.parse(o.items_json || '[]').forEach(i => { const k = String(i.name || ''); topMap[k] = (topMap[k] || 0) + (Number(i.qty) || 0); }); } catch {}
  }
  const topProducts = Object.entries(topMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
  const validOrders = allOrders.filter(o => o.status && o.status !== 'ملغي');
  const avgOrder = validOrders.length ? Math.round((revenue / validOrders.length) * 100) / 100 : 0;
  const catNames = {}; all('SELECT id, name_ar FROM categories').forEach(c => { catNames[c.id] = c.name_ar; });
  const byCategory = {};
  for (const o of allOrders) {
    const items = (() => { try { return JSON.parse(o.items_json || '[]'); } catch { return []; } })();
    const touched = [...new Set(items.map(i => Number(i.category || i.category_id || 0)).filter(Boolean))];
    if (o.status && o.status !== 'ملغي') {
      for (const cid of touched) {
        const cn = catNames[cid] || 'عام';
        const st = byCategory[cn] || (byCategory[cn] = { revenue: 0, orders: 0, items: 0 });
        const mine = items.filter(i => Number(i.category || i.category_id || 0) === cid);
        st.revenue += mine.reduce((s, i) => s + Number(i.price || 0) * (Number(i.qty) || 0), 0);
        st.items += mine.reduce((s, i) => s + (Number(i.qty) || 0), 0);
        st.orders += 1;
      }
    }
  }
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1].revenue - a[1].revenue)[0] || null;
  const custAgg = {};
  for (const o of allOrders) {
    const k = String(o.customer_name || '') + '::' + String(o.phone || '');
    if (!custAgg[k]) custAgg[k] = { name: String(o.customer_name || ''), phone: String(o.phone || ''), orders: 0 };
    custAgg[k].orders++;
  }
  const repeatCustomers = Object.values(custAgg).filter(c => c.orders > 1).sort((a, b) => b.orders - a.orders).slice(0, 10);
  const ratings = all('SELECT product_id, AVG(rating) avg, COUNT(*) n FROM reviews GROUP BY product_id');
  return {
    stats: {
      orders: get('SELECT COUNT(*) n FROM orders').n,
      products: get('SELECT COUNT(*) n FROM products').n,
      categories: get('SELECT COUNT(*) n FROM categories').n,
      conversations: get('SELECT COUNT(*) n FROM conversations').n,
      messages: get('SELECT COUNT(*) n FROM messages').n,
      customers: get('SELECT COUNT(*) n FROM customers').n,
      newOrders: get("SELECT COUNT(*) n FROM orders WHERE status='جديد'").n,
      revenue, delivered, paidOrders, avgOrder, topProducts, byCategory, topCategory,
      avgRating: ratings.length ? Math.round((ratings.reduce((a, r) => a + Number(r.avg || 0), 0) / ratings.length) * 10) / 10 : 0,
      ratingsCount: ratings.reduce((a, r) => a + Number(r.n || 0), 0),
      repeatCustomersCount: repeatCustomers.length,
    },
    recentOrders: all('SELECT id, customer_name, phone, total, status, source, created_at FROM orders ORDER BY id DESC LIMIT 6'),
    recentConversations: all(`SELECT c.id, c.platform, c.name, c.psid, c.updated_at,
      (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM conversations c ORDER BY c.updated_at DESC LIMIT 6`),
    config: {
      gemini: !!config.GEMINI_API_KEY,
      whatsapp: !!(s.wa_phone_number_id || config.WA_PHONE_NUMBER_ID) && !!(s.wa_access_token || config.WA_ACCESS_TOKEN),
      messenger: !!(s.messenger_page_token || config.MESSENGER_PAGE_TOKEN),
      facebook: !!(s.facebook_page_id || config.FACEBOOK_PAGE_ID), webhookSecret: !!config.META_APP_SECRET,
    },
    businessName: s.business_name,
  };
}, { auth: true });

add('GET', '/api/admin/categories', () => ({ items: all('SELECT * FROM categories ORDER BY sort_order, id') }), { auth: true });
add('POST', '/api/admin/categories', ({ body }) => {
  const name = str(body.name_ar);
  if (!name) return { status: 400, body: { error: 'اسم الصنف مطلوب' } };
  const info = run('INSERT INTO categories (name_ar,name_en,description,icon,active,sort_order,has_options,colors_json,sizes_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    name, str(body.name_en), str(body.description), str(body.icon) || '📦', body.active === false ? 0 : 1,
    num(body.sort_order), body.has_options ? 1 : 0, str(body.colors_json), str(body.sizes_json), now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/categories/:id', ({ params, body }) => {
  const id = num(params.id);
  run('UPDATE categories SET name_ar=?,name_en=?,description=?,icon=?,active=?,sort_order=?,has_options=?,colors_json=?,sizes_json=? WHERE id=?',
    str(body.name_ar), str(body.name_en), str(body.description), str(body.icon) || '📦', body.active === false ? 0 : 1,
    num(body.sort_order), body.has_options ? 1 : 0, str(body.colors_json), str(body.sizes_json), id);
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/categories/:id', ({ params }) => {
  run('DELETE FROM categories WHERE id=?', num(params.id));
  run('UPDATE products SET category_id=NULL WHERE category_id=?', num(params.id));
  return { ok: true };
}, { auth: true });

add('GET', '/api/admin/products', () => ({
  items: all(`SELECT p.*, c.name_ar AS category_name,
      (SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id) AS avg_rating,
      (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS rating_count
    FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC`),
}), { auth: true });
add('POST', '/api/admin/products', ({ body }) => {
  const name = str(body.name_ar);
  if (!name) return { status: 400, body: { error: 'اسم المنتج مطلوب' } };
  const vars = normalizeVariants(body.variants_json);
  const stock = variantTotal(vars, body.stock);
  const info = run(`INSERT INTO products (category_id,name_ar,name_en,description,price,old_price,image_url,icon,stock,active,colors_json,sizes_json,images_json,color_images_json,variants_json,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    num(body.category_id) || null, name, str(body.name_en), str(body.description), num(body.price), num(body.old_price),
    str(body.image_url), str(body.icon) || '🛍️', stock, body.active === false ? 0 : 1,
    str(body.colors_json), str(body.sizes_json), str(body.images_json), str(body.color_images_json), JSON.stringify(vars), now());
  return { ok: true, id: Number(info.lastInsertRowid), stock, variants: vars.length };
}, { auth: true });
add('PUT', '/api/admin/products/:id', ({ params, body }) => {
  const vars = normalizeVariants(body.variants_json);
  const stock = variantTotal(vars, body.stock);
  run(`UPDATE products SET category_id=?,name_ar=?,name_en=?,description=?,price=?,old_price=?,image_url=?,icon=?,stock=?,active=?,colors_json=?,sizes_json=?,images_json=?,color_images_json=?,variants_json=? WHERE id=?`,
    num(body.category_id) || null, str(body.name_ar), str(body.name_en), str(body.description), num(body.price), num(body.old_price),
    str(body.image_url), str(body.icon) || '🛍️', stock, body.active === false ? 0 : 1,
    str(body.colors_json), str(body.sizes_json), str(body.images_json), str(body.color_images_json), JSON.stringify(vars), num(params.id));
  return { ok: true, stock, variants: vars.length };
}, { auth: true });
add('DELETE', '/api/admin/products/:id', ({ params }) => {
  run('DELETE FROM products WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

add('GET', '/api/admin/orders', ({ query }) => {
  const status = str(query.get('status') || '');
  const rows = status
    ? all('SELECT * FROM orders WHERE status=? ORDER BY id DESC', status)
    : all('SELECT * FROM orders ORDER BY id DESC');
  return { items: rows.map(o => ({ ...o, items: JSON.parse(o.items_json || '[]') })) };
}, { auth: true });
add('PUT', '/api/admin/orders/:id', async ({ params, body }) => {
  const id = num(params.id);
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) return { status: 404, body: { error: 'الطلب غير موجود' } };
  const allowed = ['جديد', 'قيد التحضير', 'تم الإرسال', 'تم الشحن', 'مكتمل', 'ملغي'];
  const status = str(body.status);
  if (!allowed.includes(status)) return { status: 400, body: { error: 'حالة غير صالحة' } };
  const changed = status !== o.status;
  const paidVal = body.paid === undefined ? Number(o.paid || 0) : (Number(body.paid) ? 1 : 0);
  run('UPDATE orders SET status=?, paid=? WHERE id=?', status, paidVal, id);
  if (paidVal && !o.paid) run('UPDATE orders SET paid=1 WHERE id=?', id);
  if (changed) {
    let itemsLine = '';
    try { itemsLine = JSON.parse(o.items_json || '[]').map(i => `${i.name} ×${i.qty}`).join('، '); } catch {}
    const msg = `🔔 تحديث طلبك رقم #${id}\nالحالة الجديدة: ${status}\n${itemsLine ? 'المنتجات: ' + itemsLine + '\n' : ''}شكراً لثقتك 🤍`;
    const { platforms } = { platforms: require('./services/platforms') };
    const w = await platforms.sendWhatsApp(o.phone, msg);
    const m = o.psid ? await platforms.sendMessenger(o.psid, msg) : { ok: false };
    if (w.ok) run(`UPDATE orders SET notified_whatsapp=1 WHERE id=?`, id);
    if (m.ok) run(`UPDATE orders SET notified_messenger=1 WHERE id=?`, id);
  }
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/orders/:id', ({ params }) => {
  run('DELETE FROM orders WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

add('GET', '/api/admin/webhook-events', () => ({ items: all('SELECT id, platform, payload, created_at FROM webhook_events ORDER BY id DESC LIMIT 20') }), { auth: true });
add('GET', '/api/admin/orders/:id/invoice', ({ params, res }) => {
  const o = get('SELECT * FROM orders WHERE id=?', num(params.id));
  if (!o) return text(res, 404, 'طلب غير موجود');
  const s = getSettings();
  const items = JSON.parse(o.items_json || '[]');
  const money = n => `${Number(n).toLocaleString('ar-SA')} ${s.currency || ''}`.trim();
  const rows = items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.name)}</td><td>${esc(i.options || '—')}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.price * i.qty)}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة #${o.id} - ${esc(s.business_name)}</title>
  <style>@page{size:${s.invoice_size === '50mm' ? '50mm' : '80mm'} auto;margin:3mm}body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#222;margin:0;direction:rtl;width:${s.invoice_size === '50mm' ? '50mm' : '80mm'};font-size:${s.invoice_size === '50mm' ? '10px' : '12px'};padding:2mm}h1,h2{margin:0;font-size:15px}header{display:flex;justify-content:space-between;border-bottom:2px solid #b76e59;padding-bottom:8px;margin-bottom:10px}
  header img{height:${s.invoice_size === '50mm' ? '32px' : '45px'}} .brand{font-size:${s.invoice_size === '50mm' ? '16px' : '22px'}} th,td{padding:4px !important} .box{padding:7px !important;margin-top:8px !important} .total{font-size:15px !important}
  .brand{color:#b76e59;font-weight:800;letter-spacing:1px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #ddd;padding:5px;text-align:right}th{background:#fbefec;color:#8b4d3c}.box{border:1px solid #ddd;border-radius:6px;padding:8px;margin-top:10px}.total{font-weight:800;color:#8b4d3c}.no-print{margin-bottom:10px}@media print{.no-print{display:none}body{padding:0}}</style></head><body>
  <div class="no-print"><button onclick="window.print()">🖨️ طباعة الفاتورة</button></div>
  <header><div><img src="${esc(s.logo_url || '/logo.svg')}" style="height:60px"><div class="brand">${esc(s.business_name)}</div></div>
  <div><h2>فاتورة طلب</h2><div>رقم الطلب: <b>#${o.id}</b></div><div>التاريخ: ${fmtDate(o.created_at)}</div><div>الحالة: ${esc(o.status)}</div></div></header>
  <div class="box"><b>الزبون:</b> ${esc(o.customer_name)} · <b>الجوال:</b> <span dir="ltr">${esc(o.phone)}</span><br><b>العنوان:</b> ${esc(o.address || '—')}<br><b>التوصيل:</b> ${esc(o.delivery_method || 'توصيل للمنزل')} ${o.latitude ? `· ${Number(o.latitude).toFixed(4)}, ${Number(o.longitude).toFixed(4)}` : ''}</div>
  <table><thead><tr><th>#</th><th>المنتج</th><th>التخصيص</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="box"><div>المجموع الفرعي: ${money(items.reduce((x,i)=>x+i.price*i.qty,0))}</div><div>رسوم التوصيل: ${money(o.delivery_fee || 0)}</div><div class="total">الإجمالي: ${money(o.total)}</div></div>
  <p style="margin-top:24px;color:#777;text-align:center">شكراً لتسوقكم من ${esc(s.business_name)} 🤍</p></body></html>`;
  return text(res, 200, html, 'text/html; charset=utf-8');
}, { auth: true });

add('GET', '/api/admin/otps', () => ({
  items: all('SELECT phone, code, expires_at, used, created_at FROM otp_codes ORDER BY id DESC LIMIT 20'),
}), { auth: true });
add('GET', '/api/admin/customers', () => ({ items: all('SELECT * FROM customers ORDER BY id DESC LIMIT 100') }), { auth: true });

add('GET', '/api/admin/conversations', () => ({
  items: all(`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS msg_count,
    (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message
    FROM conversations c ORDER BY c.updated_at DESC`),
}), { auth: true });
add('GET', '/api/admin/conversations/:id/messages', ({ params }) => ({
  items: all('SELECT id, direction, text, created_at FROM messages WHERE conversation_id=? ORDER BY id', num(params.id)),
}), { auth: true });

add('GET', '/api/admin/faqs', () => ({ items: all('SELECT * FROM faqs ORDER BY id') }), { auth: true });
add('POST', '/api/admin/faqs', ({ body }) => {
  if (!str(body.question) || !str(body.answer)) return { status: 400, body: { error: 'السؤال والجواب مطلوبان' } };
  const info = run('INSERT INTO faqs (question,answer,active,created_at) VALUES (?,?,?,?)', str(body.question), str(body.answer), body.active === false ? 0 : 1, now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/faqs/:id', ({ params, body }) => {
  run('UPDATE faqs SET question=?,answer=?,active=? WHERE id=?', str(body.question), str(body.answer), body.active === false ? 0 : 1, num(params.id));
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/faqs/:id', ({ params }) => {
  run('DELETE FROM faqs WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

// ------------------------- custom replies -------------------------
add('GET', '/api/admin/replies', () => ({ items: all('SELECT * FROM replies ORDER BY priority DESC, id DESC') }), { auth: true });
add('POST', '/api/admin/replies', ({ body }) => {
  if (!str(body.keyword) || !str(body.answer)) return { status: 400, body: { error: 'الكلمة المفتاحية والرد مطلوبان' } };
  const info = run('INSERT INTO replies (keyword,answer,match_type,channel,priority,active,created_at) VALUES (?,?,?,?,?,?,?)',
    str(body.keyword), str(body.answer), str(body.match_type || 'contains'), str(body.channel || 'all'), num(body.priority), body.active === false ? 0 : 1, now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/replies/:id', ({ params, body }) => {
  run('UPDATE replies SET keyword=?,answer=?,match_type=?,channel=?,priority=?,active=? WHERE id=?',
    str(body.keyword), str(body.answer), str(body.match_type || 'contains'), str(body.channel || 'all'), num(body.priority), body.active === false ? 0 : 1, num(params.id));
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/replies/:id', ({ params }) => { run('DELETE FROM replies WHERE id=?', num(params.id)); return { ok: true }; }, { auth: true });

// ------------------------- post rules (ردود لكل منشور) -------------------------
add('GET', '/api/admin/post-rules', () => ({ items: all('SELECT * FROM post_rules ORDER BY id DESC') }), { auth: true });
add('POST', '/api/admin/post-rules', ({ body }) => {
  if (!str(body.post_id) || !str(body.answer)) return { status: 400, body: { error: 'معرّف المنشور والرد مطلوبان' } };
  const info = run('INSERT INTO post_rules (post_id,keyword,answer,reply_comment,notify_admin,active,created_at) VALUES (?,?,?,?,?,?,?)',
    str(body.post_id), str(body.keyword), str(body.answer), body.reply_comment === false ? 0 : 1, body.notify_admin === false ? 0 : 1, body.active === false ? 0 : 1, now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/post-rules/:id', ({ params, body }) => {
  run('UPDATE post_rules SET post_id=?,keyword=?,answer=?,reply_comment=?,notify_admin=?,active=? WHERE id=?',
    str(body.post_id), str(body.keyword), str(body.answer), body.reply_comment === false ? 0 : 1, body.notify_admin === false ? 0 : 1, body.active === false ? 0 : 1, num(params.id));
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/post-rules/:id', ({ params }) => { run('DELETE FROM post_rules WHERE id=?', num(params.id)); return { ok: true }; }, { auth: true });

// ------------------------- ads -------------------------
function activeAds(placement) {
  const s = getSettings();
  if (String(s.ads_enabled || '1') !== '1') return [];
  const t = now();
  const placements = placement ? [placement, 'all'] : null;
  const rows = all('SELECT * FROM ads WHERE active = 1 ORDER BY priority DESC, id DESC');
  return rows.filter(a => {
    if (a.start_at && a.start_at > t) return false;
    if (a.end_at && a.end_at < t) return false;
    if (placements && !placements.includes(a.placement)) return false;
    return true;
  });
}
add('GET', '/api/ads', ({ query }) => ({ items: activeAds(query.get('placement') || '') }));

// ------------------------- public app APIs (تطبيق الزبون التفاعلي) -------------------------
const rlBuckets = new Map(); // key -> { count, first }
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let b = rlBuckets.get(key);
  if (!b || t - b.first > windowMs) { b = { count: 0, first: t }; rlBuckets.set(key, b); }
  b.count++;
  if (rlBuckets.size > 5000) rlBuckets.clear();
  return b.count <= max;
}

// دردشة داخلية عامة مع المساعد الذكي (مثل تطبيقات العالم)
add('POST', '/api/chat', async ({ body, req }) => {
  const message = str(body.message).slice(0, 2000);
  if (!message) return { status: 400, body: { error: 'اكتب رسالتك' } };
  if (!rateLimit(`chat:${clientIp(req)}`, 20, 60000)) return { status: 429, body: { error: 'رسائل كثيرة — انتظر دقيقة ثم أعد المحاولة' } };
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const reply = await generateReply(message, history);
  return { ok: true, reply: String(reply || '').slice(0, 4000) };
});

// تقييمات المنتجات — عامة
add('GET', '/api/reviews', ({ query }) => {
  const pid = num(query.get('product_id') || 0);
  const items = pid
    ? all('SELECT id, product_id, customer_name, rating, text, created_at FROM reviews WHERE product_id=? ORDER BY id DESC LIMIT 30', pid)
    : all('SELECT id, product_id, customer_name, rating, text, created_at FROM reviews ORDER BY id DESC LIMIT 50');
  return { items };
});
add('POST', '/api/reviews', ({ body, req }) => {
  const pid = num(body.product_id);
  if (!pid) return { status: 400, body: { error: 'المنتج غير محدد' } };
  if (!rateLimit(`rev:${clientIp(req)}`, 10, 600000)) return { status: 429, body: { error: 'يمكنك إرسال مراجعة كل 10 دقائق' } };
  const name = str(body.customer_name).slice(0, 120);
  const text = str(body.text).slice(0, 1000);
  if (!name || !text) return { status: 400, body: { error: 'الاسم والمراجعة مطلوبان' } };
  const rating = Math.max(1, Math.min(5, num(body.rating) || 5));
  const info = run('INSERT INTO reviews (product_id, order_id, customer_name, phone, rating, text, created_at) VALUES (?,?,?,?,?,?,?)',
    pid, num(body.order_id), name, str(body.phone).slice(0, 40), rating, text, now());
  return { ok: true, id: Number(info.lastInsertRowid) };
});

// الأسئلة الشائعة — عامة
add('GET', '/api/faqs', () => ({ items: all('SELECT id, question, answer FROM faqs WHERE active=1 ORDER BY id') }));

// ------------------------- إشعارات التطبيق + الاشتراك بالدفع -------------------------
add('GET', '/api/notifications', ({ query }) => {
  const limit = Math.min(60, Math.max(1, num(query.get('limit') || 40)));
  const items = all(`SELECT id, title, message, created_at FROM notifications
    WHERE platform IN ('app','all') ORDER BY id DESC LIMIT ${limit}`);
  return { items };
});
add('GET', '/api/push/vapid-public-key', () => {
  ensureVapid();
  return { publicKey: getSettings().vapid_public_key || '' };
});
add('POST', '/api/push/subscribe', ({ body }) => {
  const sub = body && body.subscription ? body.subscription : body;
  const endpoint = str(sub && sub.endpoint);
  const p256dh = str(sub && sub.keys && sub.keys.p256dh);
  const auth = str(sub && sub.keys && sub.keys.auth);
  if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return { status: 400, body: { error: 'بيانات الاشتراك غير صحيحة' } };
  }
  run(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, created_at=excluded.created_at`,
    endpoint, p256dh.slice(0, 500), auth.slice(0, 500), str(body && body.user_agent).slice(0, 300), now());
  return { ok: true, subscribers: get('SELECT COUNT(*) AS n FROM push_subscriptions').n };
});
add('POST', '/api/push/unsubscribe', ({ body }) => {
  const endpoint = str(body && body.endpoint);
  if (endpoint) run('DELETE FROM push_subscriptions WHERE endpoint=?', endpoint);
  return { ok: true };
});
add('GET', '/api/push/status', () => ({ ok: true, subscribers: get('SELECT COUNT(*) AS n FROM push_subscriptions').n, enabled: !!webPush }));

// تتبع الطلب — عامة (بمطابقة رقم الجوال)
add('GET', '/api/orders/track', ({ query }) => {
  const id = num(query.get('id'));
  const phone = normalizePhone(query.get('phone') || '');
  const o = get('SELECT id, status, total, created_at, delivery_method, items_json FROM orders WHERE id=?', id);
  if (!o) return { status: 404, body: { error: 'لم نجد طلباً بهذا الرقم' } };
  const op = normalizePhone(o.phone || '');
  if (!phone || phone !== op) return { status: 403, body: { error: 'رقم الجوال غير مطابق لهذا الطلب' } };
  let items = [];
  try { items = JSON.parse(o.items_json || '[]'); } catch { items = []; }
  return { ok: true, order: {
    id: o.id, status: o.status, total: o.total, created_at: o.created_at, delivery_method: o.delivery_method,
    items: Array.isArray(items) ? items.map(i => ({ name: i.name, qty: i.qty, price: i.price })) : [],
  } };
});

add('GET', '/api/admin/ads', () => ({ items: all('SELECT * FROM ads ORDER BY priority DESC, id DESC') }), { auth: true });
add('POST', '/api/admin/ads', ({ body }) => {
  const info = run(`INSERT INTO ads (title,body,image_url,link_url,cta,kind,placement,active,priority,start_at,end_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    str(body.title), str(body.body), str(body.image_url), str(body.link_url), str(body.cta),
    str(body.kind || 'banner'), str(body.placement || 'store'), body.active === false ? 0 : 1, num(body.priority),
    str(body.start_at), str(body.end_at), now(), now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/ads/:id', ({ params, body }) => {
  run(`UPDATE ads SET title=?,body=?,image_url=?,link_url=?,cta=?,kind=?,placement=?,active=?,priority=?,start_at=?,end_at=?,updated_at=? WHERE id=?`,
    str(body.title), str(body.body), str(body.image_url), str(body.link_url), str(body.cta),
    str(body.kind || 'banner'), str(body.placement || 'store'), body.active === false ? 0 : 1, num(body.priority),
    str(body.start_at), str(body.end_at), now(), num(params.id));
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/ads/:id', ({ params }) => {
  run('DELETE FROM ads WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

// ------------------------- notifications / broadcast -------------------------
const { send: platformSend } = require('./services/platforms');
add('GET', '/api/admin/notifications', () => ({ items: all('SELECT * FROM notifications ORDER BY id DESC LIMIT 50') }), { auth: true });
add('POST', '/api/admin/notify', async ({ body }) => {
  const message = str(body.message);
  if (!message) return { status: 400, body: { error: 'نص التنبيه مطلوب' } };
  const platform = str(body.platform || 'all');
  const title = str(body.title || '');
  const full = title ? `${title}\n\n${message}` : message;
  let targets;
  if (str(body.psid)) targets = [{ platform: str(body.platform === 'whatsapp' ? 'whatsapp' : 'messenger'), psid: str(body.psid) }];
  else {
    const rows = all(`SELECT platform, psid FROM conversations WHERE psid != ''`);
    targets = rows.filter(r => r.platform === 'messenger' || r.platform === 'whatsapp')
      .filter(r => platform === 'all' || r.platform === platform);
  }
  let sent = 0, failed = 0;
  for (const t of targets) {
    try { const r = await platformSend(t.platform, t.psid, full); if (r && r.ok) sent++; else failed++; }
    catch { failed++; }
  }
  // إشعار التطبيق + إشعار الهاتف (Web Push) — يصل حتى إن كان التطبيق مغلقاً
  let pushSent = 0;
  if (platform === 'app' || platform === 'all') {
    try { pushSent = await pushToAll(title || 'تنبيه جديد', message, '/'); }
    catch (e) { console.error('[push] فشل:', e.message); }
    sent += pushSent;
  }
  const info = run('INSERT INTO notifications (title,message,platform,target,sent,failed,created_at) VALUES (?,?,?,?,?,?,?)',
    title, message, platform, str(body.psid) || 'all', sent, failed, now());
  return { ok: true, id: Number(info.lastInsertRowid), targets: targets.length, sent, failed, pushSent };
}, { auth: true });

add('GET', '/api/admin/push/subscribers', () => ({ items: all('SELECT id, endpoint, user_agent, created_at FROM push_subscriptions ORDER BY id DESC'), count: get('SELECT COUNT(*) AS n FROM push_subscriptions').n }), { auth: true });
add('DELETE', '/api/admin/push/subscribers/:id', ({ params }) => {
  run('DELETE FROM push_subscriptions WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

add('GET', '/api/admin/reviews', () => ({ items: all('SELECT * FROM reviews ORDER BY id DESC LIMIT 200') }), { auth: true });
add('POST', '/api/admin/reviews', ({ body }) => {
  const pid = Number(body.product_id);
  if (!pid) return { status: 400, body: { error: 'product_id مطلوب' } };
  const info = run('INSERT INTO reviews (product_id, order_id, customer_name, phone, rating, text, created_at) VALUES (?,?,?,?,?,?,?)', pid, Number(body.order_id) || 0, str(body.customer_name).slice(0, 120), str(body.phone).slice(0, 40), Math.max(1, Math.min(5, Number(body.rating) || 5)), str(body.text).slice(0, 1000), now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('DELETE', '/api/admin/reviews/:id', ({ params }) => {
  run('DELETE FROM reviews WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

const SETTING_KEYS = ['business_name', 'currency', 'country', 'logo_url', 'invoice_size', 'delivery_fee', 'delivery_free_threshold', 'delivery_note', 'delivery_methods', 'business_hours', 'return_policy', 'payment_methods', 'bank_info', 'whatsapp_number', 'wa_phone_number_id', 'wa_access_token', 'messenger_link', 'messenger_page_token', 'messenger_page_id', 'facebook_page_id', 'facebook_page_token', 'catalog_url', 'ai_enabled', 'greeting', 'welcome', 'welcome_messenger', 'welcome_whatsapp', 'custom_instructions', 'reply_language', 'ai_temperature', 'ai_max_tokens', 'footer_text', 'bot_tone', 'ads_in_chat', 'ads_enabled', 'app_link', 'vapid_public_key', 'vapid_private_key'];
add('GET', '/api/admin/settings', () => {
  const s = getSettings();
  const out = {}; SETTING_KEYS.forEach(k => { if (k !== 'vapid_private_key') out[k] = s[k] ?? ''; });
  const wa = waCredentials();
  return { settings: out, runtime: {
    gemini: !!config.GEMINI_API_KEY, model: config.GEMINI_MODEL,
    whatsapp: !!(wa.token && wa.phoneId), whatsappFromSettings: !!s.wa_phone_number_id,
    messenger: !!(s.messenger_page_token || config.MESSENGER_PAGE_TOKEN),
    facebook: !!(s.facebook_page_id || config.FACEBOOK_PAGE_ID),
  } };
}, { auth: true });
add('PUT', '/api/admin/settings', ({ body }) => {
  for (const k of SETTING_KEYS) if (Object.prototype.hasOwnProperty.call(body, k)) setSetting(k, body[k]);
  return { ok: true };
}, { auth: true });

add('POST', '/api/admin/password', ({ body }) => {
  const username = str(body.username) || 'admin';
  const oldPass = String(body.old_password ?? '');
  const newPass = String(body.new_password ?? '');
  if (newPass.length < 6) return { status: 400, body: { error: 'كلمة المرور الجديدة يجب أن تكون ٦ أحرف على الأقل' } };
  const admin = get('SELECT * FROM admins WHERE username = ?', username);
  if (!admin || !verifyPassword(oldPass, admin.password_hash)) return { status: 401, body: { error: 'كلمة المرور الحالية غير صحيحة' } };
  run('UPDATE admins SET password_hash=? WHERE id=?', hashPassword(newPass), admin.id);
  setSetting('admin_password_changed', now());
  return { ok: true };
}, { auth: true });

add('POST', '/api/admin/test-reply', async ({ body }) => {
  const message = str(body.message);
  if (!message) return { status: 400, body: { error: 'اكتب رسالة للاختبار' } };
  const reply = await generateReply(message, []);
  return { ok: true, reply };
}, { auth: true });

add('POST', '/api/admin/test-whatsapp', async () => {
  const { token, phoneId } = waCredentials();
  if (!token || !phoneId) return { status: 400, body: { error: 'أضف Phone Number ID والتوكن أولاً' } };
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${encodeURIComponent(phoneId)}?fields=verified_name,display_phone_number&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) return { status: 400, body: { error: data?.error?.message || `HTTP ${res.status}` } };
    return { ok: true, verifiedName: data.verified_name || '', displayPhone: data.display_phone_number || '', phoneId };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
}, { auth: true });

add('POST', '/api/admin/test-messenger', async () => {
  const s = getSettings();
  const source = s.messenger_page_token ? 'settings' : (config.MESSENGER_PAGE_TOKEN ? 'env' : (s.facebook_page_token ? 'settings-facebook' : 'none'));
  const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token;
  if (!token) return { status: 400, body: { error: 'أضف Page Token أولاً من إعدادات المسنجر', source } };
  try {
    // تحقق من التوكن
    const dbg = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json());
    if (!dbg.data?.is_valid) return { status: 400, body: { error: dbg.error?.message || dbg.data?.error?.message || 'التوكن غير صالح أو منتهي', source, preview: token.slice(0, 8), debug: dbg } };
    const pageId = dbg.data.profile_id || s.messenger_page_id || s.facebook_page_id || '';
    // جلب معلومات الصفحة
    let page = {};
    if (pageId) {
      page = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${pageId}?fields=id,name,link&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => ({}));
    } else {
      page = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/me?fields=id,name,link&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => ({}));
    }
    const resolvedId = page.id || pageId;
    if (resolvedId) {
      setSetting('messenger_page_id', resolvedId);
      if (!s.facebook_page_id) setSetting('facebook_page_id', resolvedId);
    }
    // فحص الاشتراكات
    let subs = null;
    if (resolvedId) {
      subs = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${resolvedId}/subscribed_apps?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => null);
    }
    return { ok: true, type: dbg.data.type, pageId: resolvedId, name: page.name || '', link: page.link || '', scopes: dbg.data.scopes || [], subscribed: subs?.data || null };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}, { auth: true });

add('POST', '/api/admin/subscribe-messenger', async () => {
  const s = getSettings();
  const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token;
  if (!token) return { status: 400, body: { error: 'أضف Page Token أولاً' } };
  const pageId = s.messenger_page_id || s.facebook_page_id || config.FACEBOOK_PAGE_ID;
  if (!pageId) return { status: 400, body: { error: 'معرف الصفحة غير معروف — اضغط "تحقق من توكن مسنجر" أولاً' } };
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${pageId}/subscribed_apps`;
    const baseFields = 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads';
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token, subscribed_fields: baseFields }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 400, body: { error: data?.error?.message || `HTTP ${res.status}`, raw: data } };
    setSetting('messenger_subscribed_at', now());
    // جرّب اشتراك feed بشكل منفصل (يتطلب pages_manage_metadata) — لا تفشل العملية إن لم تتوفر الصلاحية
    let feed = null;
    try {
      const fr = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token, subscribed_fields: baseFields + ',feed' }),
        signal: AbortSignal.timeout(15000),
      });
      feed = await fr.json().catch(() => ({}));
    if (fr.ok) { return { ok: true, result: feed, feed: true, subscribedAt: getSettings().messenger_subscribed_at }; }
    } catch {}
    return { ok: true, result: data, feed: false, subscribedAt: getSettings().messenger_subscribed_at, feedWarning: feed?.error?.message || 'اشتراك feed لم يُفعّل (يتطلب pages_manage_metadata) — رسائل المسنجر مفعّلة.' };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}, { auth: true });

add('POST', '/api/admin/change-page', async ({ body }) => {
  const token = str(body.token);
  if (!token) return { status: 400, body: { error: 'التوكن مطلوب' } };
  try {
    const page = await fbGraph(`${str(body.page_id) || config.FACEBOOK_PAGE_ID || ''}`, {}, 'GET', token)
      .catch(async () => {
        const t = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`).then(r => r.json());
        const exp = t.data?.exp;
        if (!exp) return { id: str(body.page_id), name: '' };
        return fbGraph(str(body.page_id), {}, 'GET', token);
      });
    if (str(body.page_id) || config.FACEBOOK_PAGE_ID) setSetting('facebook_page_id', str(body.page_id) || config.FACEBOOK_PAGE_ID || '');
    setSetting('facebook_page_token', token);
    setSetting('messenger_page_token', token); // واجهة واحدة للأطراف
    setSetting('messenger_page_id', str(body.page_id) || page?.id || '');
    return { ok: true, pageId: str(body.page_id) || page?.id || '', name: page?.name || '' };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
}, { auth: true });

add('POST', '/api/admin/test-facebook', async () => {
  try {
    const { pageId } = fbCreds();
    if (!pageId) return { status: 400, body: { error: 'أضف ID الصفحة' } };
    const data = await fbGraph(pageId, { fields: 'id,name,is_webhooks_subscribed', access_token: fbCreds().token }, 'GET', fbCreds().token);
    return { ok: true, pageId, name: data.name || '' };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
}, { auth: true });

add('POST', '/api/admin/page/post', async ({ body }) => {
  const message = str(body.message);
  if (!message.trim()) return { status: 400, body: { error: 'اكتب محتوى للنشر' } };
  try {
    const post = await sendPagePost(message.trim().slice(0, 6000));
    return { ok: true, id: post.id };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
}, { auth: true });

add('POST', '/api/admin/orders/:id/notify', async ({ params, body }) => {
  const o = get('SELECT * FROM orders WHERE id=?', num(params.id));
  if (!o) return { status: 404, body: { error: 'طلب غير موجود' } };
  if (o.notified_messenger || o.notified_whatsapp) return { ok: true, skipped: true };
  const platform = body.platform || 'messenger';
  const to = o.customer_name;
  const msg = `⚠️ للمعلومة: طلبك #${o.id} جديد/تحضير: ${o.status}\n${o.notes ? 'ملاحظات الزبون: ' + o.notes : ''}`;
  const { platforms } = { platforms: require('./services/platforms') };
  const r = platform === 'whatsapp' ? await platforms.sendWhatsApp(o.phone, msg) : await platforms.sendMessenger(o.psid || o.phone, msg);
  if (r.ok) run(`UPDATE orders SET ${platform === 'whatsapp' ? 'notified_whatsapp' : 'notified_messenger'}=1 WHERE id=?`, o.id);
  return { ok: !!r.ok, sent: r.ok === true, skipped: !!r.skipped, error: r.error };
}, { auth: true });

// ------------------------- messenger diagnostics -------------------------
function msCreds() {
  const s = getSettings();
  const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token || '';
  const pageId = s.messenger_page_id || s.facebook_page_id || config.FACEBOOK_PAGE_ID || '';
  return { token, pageId };
}
add('GET', '/api/admin/messenger/threads', async () => {
  const { token, pageId } = msCreds();
  if (!token || !pageId) return { status: 400, body: { error: 'أضف Page Token و معرف الصفحة أولاً' } };
  try {
    const r = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${pageId}/conversations?fields=id,updated_time,participants&limit=20&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20000) }).then(x => x.json());
    if (r.error) return { status: 400, body: { error: r.error.message } };
    return { ok: true, threads: (r.data || []).map(t => ({
      id: t.id, updated: t.updated_time || '',
      users: (t.participants?.data || []).map(p => ({ id: p.id, name: p.name || '' })),
    })) };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}, { auth: true });
add('POST', '/api/admin/messenger/send', async ({ body }) => {
  const psid = str(body.psid).trim();
  const message = str(body.text).trim();
  if (!psid || !message) return { status: 400, body: { error: 'psid و text مطلوبان' } };
  const { sendMessenger } = require('./services/platforms');
  const r = await sendMessenger(psid, message);
  return { ok: !!r.ok, id: r.id || '', error: r.error || '', full: r.fullError || null };
}, { auth: true });

add('GET', '/api/admin/webhook-status', () => {
  const events = all('SELECT platform, payload, created_at FROM webhook_events ORDER BY id DESC LIMIT 30');
  const classify = e => {
    if (e.platform === 'verify') return { type: 'verify_ok', label: '✅ تحقق Meta ناجح' };
    if (e.platform === 'verify_failed') return { type: 'verify_fail', label: '❌ تحقق Meta مرفوض (توكن خاطئ)' };
    let sender = '', text = '', obj = '';
    try {
      const p = JSON.parse(e.payload || '{}');
      obj = p.object || '';
      const ms = (p.entry || []).flatMap(x => x.messaging || []);
      sender = ms[0]?.sender?.id || '';
      text = (ms[0]?.message?.text || ms[0]?.postback?.payload || '').slice(0, 60);
    } catch {}
    return { type: 'message', label: '📨 رسالة واردة', obj, sender, text };
  };
  const items = events.map(e => ({ ...classify(e), at: e.created_at }));
  const lastVerify = items.find(i => i.type === 'verify_ok') || null;
  const lastMessage = items.find(i => i.type === 'message') || null;
  const s = getSettings();
  return {
    endpoint: '/webhooks/messenger',
    verifyToken: config.VERIFY_TOKEN,
    pageId: msCreds().pageId,
    hasToken: !!msCreds().token,
    subscribedAt: s.messenger_subscribed_at || '',
    lastVerify, lastMessage,
    events: items.slice(0, 15),
    hint: 'افتح Meta Developers > التطبيق > Messenger/Webhooks، أدخل الرابط والرمز ثم اضغط Verify and Save — سيظهر حدث تحقق هنا فوراً.',
  };
}, { auth: true });

add('GET', '/api/admin/system-status', () => {
  const s = getSettings();
  const events = all('SELECT platform, payload, created_at FROM webhook_events ORDER BY id DESC LIMIT 20');
  let lastInbound = null, lastVerify = null;
  for (const e of events) {
    if (e.platform === 'verify' && !lastVerify) lastVerify = e.created_at;
    if (lastInbound) continue;
    try {
      const p = JSON.parse(e.payload || '{}');
      const ms = (p.entry || []).flatMap(x => x.messaging || []);
      const m = ms[0];
      if (m && (m.message?.text || m.postback?.payload)) lastInbound = { at: e.created_at, text: String(m.message?.text || m.postback?.payload).slice(0, 80), source: e.platform };
    } catch {}
  }
  const ps = (() => { try { return poller.status(); } catch { return { enabled: false }; } })();
  const st = (() => { try { return all('SELECT COUNT(*) AS n FROM products')[0]?.n ?? -1; } catch { return -1; } })();
  return {
    build: (() => { try { return require('./build'); } catch { return 'unknown'; } })(),
    uptimeSec: Math.round(process.uptime()),
    now: now(),
    services: {
      database: st >= 0,
      messengerToken: !!(s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token),
      tokenSource: s.messenger_page_token ? 'settings' : (config.MESSENGER_PAGE_TOKEN ? 'env' : (s.facebook_page_token ? 'settings-facebook' : 'none')),
      tokenPreview: String(s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token || '').slice(0, 8),
      pageId: s.messenger_page_id || s.facebook_page_id || '',
      whatsapp: !!(s.wa_access_token || config.WA_ACCESS_TOKEN),
      whatsappNumber: s.whatsapp_number || '',
      gemini: !!config.GEMINI_API_KEY,
      poller: !!ps.enabled,
      pollerStats: ps,
      webhookLastInbound: lastInbound,
      webhookLastVerify: lastVerify,
    },
    security: {
      passwordChanged: !!s.admin_password_changed,
      defaultPasswordActive: !s.admin_password_changed,
      sessionCookie: 'HttpOnly + SameSite=Lax',
      loginLock: '8 محاولات خاطئة / 15 دقيقة = قفل 10 دقائق',
      signatureCheck: !!config.META_APP_SECRET,
    },
    data: {
      categories: (() => { try { return all('SELECT COUNT(*) AS n FROM categories')[0]?.n ?? -1; } catch { return -1; } })(),
      products: st,
      orders: (() => { try { return all('SELECT COUNT(*) AS n FROM orders')[0]?.n ?? -1; } catch { return -1; } })(),
      conversations: (() => { try { return all('SELECT COUNT(*) AS n FROM conversations')[0]?.n ?? -1; } catch { return -1; } })(),
      messages: (() => { try { return all('SELECT COUNT(*) AS n FROM messages')[0]?.n ?? -1; } catch { return -1; } })(),
      faqs: (() => { try { return all('SELECT COUNT(*) AS n FROM faqs')[0]?.n ?? -1; } catch { return -1; } })(),
    },
    currency: s.currency || '',
    hint: ps.enabled
      ? 'النظام يعمل بوضعين معاً: Webhook Meta + استطلاع احتياطي كل 20 ثانية.'
      : 'الاستطلاع الاحتياطي متوقف — اضغط زر تشغيل الاستطلاع في إعدادات المسنجر.',
  };
}, { auth: true });

const BACKUP_TABLES = ['categories', 'products', 'orders', 'conversations', 'messages', 'faqs', 'customers', 'otp_codes', 'ads', 'replies', 'post_rules', 'notifications', 'push_subscriptions'];
add('GET', '/api/admin/backup', () => {
  const out = { version: 1, exported_at: now() };
  for (const t of BACKUP_TABLES) out[t] = all(`SELECT * FROM ${t}`);
  return out;
}, { auth: true });
add('POST', '/api/admin/restore', ({ body }) => {
  const data = body.data || body;
  if (!data || typeof data !== 'object') return { status: 400, body: { error: 'ملف النسخة غير صالح' } };
  const { db } = require('./db');
  try {
    db.exec('BEGIN');
    for (const t of [...BACKUP_TABLES].reverse()) run(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES) {
      const rows = Array.isArray(data[t]) ? data[t] : [];
      for (const row of rows) {
        const cols = Object.keys(row).filter(k => !k.startsWith('_'));
        if (!cols.length) continue;
        run(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(k => row[k]));
      }
    }
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[Restore]', e);
    return { status: 400, body: { error: 'تعذر استيراد النسخة' } };
  }
}, { auth: true });

// ------------------------- webhooks -------------------------
// اختيار رد لتعليق منشور: قاعدة لكل منشور (post_rules) → كلمة مفتاحية → رد ذكي عام
async function pickPostReply(postId, messageText, pageId) {
  const msg = String(messageText || '').toLowerCase();
  let rules = [];
  try { rules = all('SELECT * FROM post_rules WHERE active = 1 AND post_id = ? ORDER BY id DESC', String(postId)); } catch {}
  // قواعد عامة لكل المنشورات
  let globalRules = [];
  try { globalRules = all("SELECT * FROM post_rules WHERE active = 1 AND post_id IN ('*','all','') ORDER BY id DESC"); } catch {}
  for (const r of [...rules, ...globalRules]) {
    const kw = String(r.keyword || '').toLowerCase().trim();
    if (!kw || msg.includes(kw)) {
      return { text: String(r.answer || '').replace(/\{business\}/g, getSettings().business_name || 'متجرنا'), replyComment: r.reply_comment !== 0, notifyAdmin: r.notify_admin !== 0 };
    }
  }
  // رد ذكي عام على التعليق
  let ai = '';
  try { ai = await generateReply(messageText || 'تعليق على المنشور', [], null, 'messenger'); } catch {}
  const fallback = `أهلاً بك 👋 سنردّ عليك هنا أو راسلنا في المسنجر، وتجد كل شيء في تطبيقنا.`;
  return { text: ai || fallback, replyComment: true, notifyAdmin: true };
}
function notifyAdminFbComment(postId, fromId, messageText, commentId) {
  try {
    run('INSERT INTO notifications (title,message,platform,target,sent,failed,created_at) VALUES (?,?,?,?,?,?,?)',
      'تعليق جديد على منشور', `المنشور: ${postId}\nالمعلّق: ${fromId}\nالنص: ${String(messageText || '').slice(0, 300)}\ncomment_id: ${commentId}`,
      'messenger', postId, 0, 0, now());
  } catch {}
}
function webhookVerify({ query, res }) {
  const mode = str(query.get('hub.mode'));
  const token = str(query.get('hub.verify_token'));
  const challenge = str(query.get('hub.challenge'));
  if (mode === 'subscribe' && token === config.VERIFY_TOKEN) {
    try { run('INSERT INTO webhook_events (platform, payload, created_at) VALUES (?,?,?)', 'verify', JSON.stringify({ challenge: String(challenge).slice(0, 80) }), now()); } catch {}
    return text(res, 200, challenge);
  }
  try { run('INSERT INTO webhook_events (platform, payload, created_at) VALUES (?,?,?)', 'verify_failed', JSON.stringify({ mode: String(mode).slice(0, 40) }), now()); } catch {}
  return text(res, 403, 'Forbidden');
}

add('GET', '/webhooks/whatsapp', webhookVerify);
add('POST', '/webhooks/whatsapp', async ({ req, raw, body, res }) => {
  if (!verifyWebhookSignature(req, raw)) return text(res, 401, 'Invalid signature');
  run('INSERT INTO webhook_events (platform, payload, created_at) VALUES (?,?,?)', 'meta', JSON.stringify(body).slice(0, 20000), now());
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) {
        const contact = (value.contacts || []).find(c => c.wa_id === msg.from);
        const messageText = msg.text?.body || msg.button?.text ||
          msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
        jobs.push((async () => {
          let image = null;
          if (msg.image?.id) {
            const token = waCredentials().token;
            const meta = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${msg.image.id}?fields=url&access_token=${encodeURIComponent(token)}`).then(r => r.json()).catch(() => ({}));
            if (meta.url) image = await fetchImage(meta.url, token);
          }
          if (msg.voice?.id) {
            await handleIncoming({
              platform: 'whatsapp', psid: str(msg.from), name: str(contact?.profile?.name),
              text: '🎤 استلمنا صوتك — اكتب سؤالك بالكتابة أو أرسل صورة المنتج وسأساعدك فوراً 🤍',
            });
            return;
          }
          await handleIncoming({
            platform: 'whatsapp', psid: str(msg.from), name: str(contact?.profile?.name),
            text: messageText, externalId: str(msg.id), image,
          });
        })());
      }
    }
  }
  Promise.allSettled(jobs).then(results => {
    results.forEach(r => { if (r.status === 'rejected') console.error('[WhatsApp handler]', r.reason); });
  });
  return text(res, 200, 'OK');
});

add('GET', '/webhooks/messenger', webhookVerify);
add('GET', '/webhooks/facebook', webhookVerify);
add('POST', '/webhooks/facebook', async ({ req, raw, body, res }) => {
  if (!verifyWebhookSignature(req, raw)) return text(res, 401, 'Invalid signature');
  run('INSERT INTO webhook_events (platform, payload, created_at) VALUES (?,?,?)', 'meta', JSON.stringify(body).slice(0, 20000), now());
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const msg = v.message;
      const pageId = fbCreds().pageId;
      if (msg?.text && v.from && v.from.id && v.from.id !== pageId) {
        let conv = get('SELECT * FROM conversations WHERE platform = ? AND psid = ?', 'facebook', v.from.id);
        if (!conv) {
          run('INSERT INTO conversations (platform, psid, name, created_at, updated_at) VALUES (?,?,?,?,?)', 'facebook', v.from.id, v.from.name || '', now(), now());
          conv = get('SELECT * FROM conversations WHERE platform = ? AND psid = ?', 'facebook', v.from.id);
        }
        const externalId = v.id || v.post_id || '';
        const seen = externalId ? get('SELECT 1 FROM messages WHERE external_id = ? LIMIT 1', externalId) : null;
        if (!seen) {
          run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)', conv.id, 'in', msg.text, externalId, now());
          jobs.push((async () => {
            const reply = await generateReply(msg.text, []);
            try { await fbGraph(`${v.post_id}/comments`, { message: reply }); } catch (e) { console.error('[FB post comments]', e.message); }
          })());
        }
      }
      // ردود تلقائية على التعليقات (object comments)
      for (const t of v.to?.data || []) {
        if (msg?.text && t?.name === 'Comments') {
          const commentId = v.id || t.id;
          if (commentId && !get('SELECT 1 FROM messages WHERE external_id = ? LIMIT 1', `fbcomment:${commentId}`)) {
            run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)',
              (get('SELECT id FROM conversations WHERE platform = ?', 'facebook') || { id: 0 }).id,
              'in', msg.text, `fbcomment:${commentId}`, now());
            jobs.push((async () => {
              const reply = await generateReply(msg.text, []);
              try { await replyComment(commentId, reply); } catch (e) { console.error('[FB comment]', e.message); }
            })());
          }
        }
      }
    }
  }
  Promise.allSettled(jobs).then(rs => rs.forEach(r => r.status === 'rejected' && console.error('[FB webhook]', r.reason)));
  return text(res, 200, 'OK');
});

// اختبار بدون توقيع/زيارة في الأدمن (لجذب تحقق وجود الرد)
add('POST', '/api/admin/simulate/whatsapp', async ({ body }) => {
  const r = await handleIncoming({ platform: 'whatsapp', psid: str(body.psid || body.phone), name: str(body.name), text: str(body.message) });
  return { ok: true, reply: r?.reply || null, sent: r?.sent || null };
}, { auth: true });
add('POST', '/api/admin/simulate/messenger', async ({ body }) => {
  const r = await handleIncoming({ platform: 'messenger', psid: str(body.psid || body.user_id), name: str(body.name), text: str(body.message) });
  return { ok: true, reply: r?.reply || null, sent: r?.sent || null };
}, { auth: true });
add('POST', '/api/admin/simulate/facebook', async ({ body }) => {
  const text = str(body.message);
  const r = await generateReply(text, []);
  return { ok: true, reply: r || null };
}, { auth: true });

add('POST', '/webhooks/messenger', async ({ req, raw, body, res }) => {
  if (!verifyWebhookSignature(req, raw)) return text(res, 401, 'Invalid signature');
  run('INSERT INTO webhook_events (platform, payload, created_at) VALUES (?,?,?)', 'meta', JSON.stringify(body).slice(0, 20000), now());
  const jobs = [];
  for (const entry of body.entry || []) {
    const pageId = fbCreds().pageId;
    // ردود على المنشورات (feed): تعليقات الزبائن على الصفحة + ردود لكل منشور
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const isFeed = change.field === 'feed' || v.item === 'comment' || v.verb === 'add';
      const commentId = str(v.comment_id || v.id || v.feedback_id);
      const postId = str(v.post_id || v.parent_id || (v.post && v.post.id) || v.object_id);
      const fromId = str(v.from?.id || v.sender_id);
      const messageText = str(v.message || v.text || v.comment || v.story);
      if (!isFeed || !commentId) continue;
      if (fromId && fromId === String(pageId)) continue; // تجاهل تعليقات الصفحة نفسها
      if (v.verb && v.verb !== 'add' && v.verb !== 'edited') continue;
      if (get('SELECT 1 FROM messages WHERE external_id = ? LIMIT 1', `fbcomment:${commentId}`)) continue;
      jobs.push((async () => {
        try { run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)', 0, 'in', messageText, `fbcomment:${commentId}`, now()); } catch {}
        const reply = await pickPostReply(postId, messageText, pageId);
        if (reply.replyComment) { try { await replyComment(commentId, reply.text); } catch (e) { console.error('[FB comment reply]', e.message); } }
        if (reply.notifyAdmin) notifyAdminFbComment(postId, fromId, messageText, commentId);
      })());
    }
    for (const ev of entry.messaging || []) {
      if (ev.message?.is_echo) continue;
      const messageText = ev.message?.text || ev.postback?.payload || ev.message?.quick_reply?.payload ||
        (ev.message?.attachments?.length ? '📎 مرفق' : '');
      jobs.push((async () => {
        let image = null;
        const url = ev.message?.attachments?.find(a => a.type === 'image')?.payload?.url;
        if (url) image = await fetchImage(url, getSettings().messenger_page_token || config.MESSENGER_PAGE_TOKEN);
        await handleIncoming({
          platform: 'messenger', psid: str(ev.sender?.id),
          text: messageText, externalId: str(ev.message?.mid || ev.postback?.mid), image,
        });
      })());
    }
  }
  Promise.allSettled(jobs).then(results => {
    results.forEach(r => { if (r.status === 'rejected') console.error('[Messenger handler]', r.reason); });
  });
  return text(res, 200, 'OK');
});

// ------------------------- dispatcher -------------------------
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return text(res, 400, 'Bad request'); }
  const pathname = decodeURIComponent(url.pathname);

  res.localsProto = String(req.headers['x-forwarded-proto'] || 'http');
  securityHeaders(res);

  if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/webhooks/')) {
    return serveStatic(req, res, pathname);
  }

  const matched = routes.find(r => r.method === req.method && r.regex.test(pathname));
  if (!matched) return json(res, 404, { error: 'الصفحة غير موجودة' });

  try {
    const raw = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
    let body = {};
    if (raw.length && pathname !== '/api/admin/upload') {
      try { body = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'JSON غير صالح' }); }
    }
    const m = matched.regex.exec(pathname);
    const params = {};
    matched.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const user = readSession(req);
    if (matched.opts.auth && !user) return json(res, 401, { error: 'يرجى تسجيل الدخول' });
    res.localsProto = String(req.headers['x-forwarded-proto'] || 'http');

    const result = await matched.handler({ req, res, params, query: url.searchParams, body, raw, user, customer: readCustomer(req) });
    if (res.writableEnded) return;
    if (result && typeof result === 'object' && 'status' in result) return json(res, result.status, result.body);
    if (result === undefined) return;
    return json(res, 200, result);
  } catch (e) {
    console.error('[Server error]', e);
    if (!res.writableEnded) return json(res, 500, { error: 'خطأ في السيرفر' });
  }
});

add('GET', '/api/admin/poller/status', () => poller.status(), { auth: true });
add('POST', '/api/admin/poller/start', () => { poller.start(); return { ok: true, ...poller.status() }; }, { auth: true });
add('POST', '/api/admin/poller/stop', () => { poller.stop(); return { ok: true, ...poller.status() }; }, { auth: true });
add('POST', '/api/admin/poller/run', async () => { await poller.poll(); return { ok: true, ...poller.status() }; }, { auth: true });

server.listen(config.PORT, config.HOST, () => {
  console.log('');
  console.log('  🤖 تطبيق الرد الذكي جاهز');
  console.log(`  المتجر:   http://localhost:${config.PORT}/`);
  console.log(`  الأدمن:   http://localhost:${config.PORT}/admin`);
  console.log(`  Webhooks: /webhooks/whatsapp  |  /webhooks/messenger`);
  console.log('  ----------------------------------------');
  console.log(`  Gemini:    ${config.GEMINI_API_KEY ? 'مفعّل (' + config.GEMINI_MODEL + ')' : 'غير مُعدّ - سيُستخدم الرد الأساسي'}`);
  console.log(`  WhatsApp:  ${config.WA_ACCESS_TOKEN ? 'مفعّل' : 'غير مُعدّ'}`);
  console.log(`  Messenger: ${config.MESSENGER_PAGE_TOKEN ? 'مفعّل' : 'غير مُعدّ'}`);
  console.log(`  كلمة أدمن افتراضية: admin / admin123  👈 غيّرها من لوحة الأدمن`);
  console.log('');
  try { poller.start(); } catch (e) { console.error('[poller] start failed:', e.message); }
});
