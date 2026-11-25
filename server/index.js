'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { all, get, run, now, getSettings, setSetting, hashPassword, verifyPassword } = require('./db');
const { handleIncoming, generateReply } = require('./services/chat');
const { credentials: waCredentials } = require('./services/platforms');
const { creds: fbCreds, sendPagePost, replyPost, replyComment, graph: fbGraph } = require('./services/facebook');

// ------------------------- helpers -------------------------
const str = v => String(v ?? '').trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

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

function verifyWebhookSignature(req, raw) {
  if (!config.META_APP_SECRET) return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
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
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
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
add('GET', '/api/health', () => ({ ok: true, time: now() }));

add('GET', '/api/store/info', () => {
  const s = getSettings();
  return {
    businessName: s.business_name, currency: s.currency, country: s.country, footerText: s.footer_text,
    whatsappNumber: s.whatsapp_number, messengerLink: s.messenger_link, messengerPageId: s.messenger_page_id,
    catalogUrl: s.catalog_url,
  };
});

add('GET', '/api/store/categories', () => ({
  items: all('SELECT id, name_ar, name_en, description, icon, has_options, colors_json, sizes_json FROM categories WHERE active = 1 ORDER BY sort_order, id'),
}));

add('GET', '/api/store/products', ({ query }) => {
  const cat = Number(query.get('category') || 0);
  const q = str(query.get('q') || '');
  const fields = 'id, category_id, name_ar, name_en, description, price, old_price, image_url, icon, stock, colors_json, sizes_json, images_json, color_images_json';
  const rows = cat
    ? all(`SELECT ${fields} FROM products WHERE active=1 AND category_id=? ORDER BY id DESC`, cat)
    : all(`SELECT ${fields} FROM products WHERE active=1 ORDER BY id DESC`);
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
  }));
  const total = clean.reduce((s, i) => s + i.price * i.qty, 0);
  const info = run(`INSERT INTO orders (customer_name, phone, address, notes, items_json, total, status, source, created_at, customer_id, latitude, longitude)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    name.slice(0, 120), phone.slice(0, 40), str(body.address).slice(0, 300), str(body.notes).slice(0, 500),
    JSON.stringify(clean), total, 'جديد', 'المتجر', now(), customer?.id || 0,
    num(customer?.latitude || body.latitude), num(customer?.longitude || body.longitude));
  return { ok: true, orderId: Number(info.lastInsertRowid), total };
});

add('POST', '/api/auth/login', ({ body, res }) => {
  const username = str(body.username);
  const password = String(body.password ?? '');
  const admin = get('SELECT * FROM admins WHERE username = ?', username);
  if (!admin || !verifyPassword(password, admin.password_hash)) return { status: 401, body: { error: 'بيانات الدخول غير صحيحة' } };
  setSessionCookie(res, sessionToken(admin.id));
  return { ok: true, username: admin.username };
});
add('POST', '/api/auth/logout', ({ res }) => {
  res.setHeader('Set-Cookie', 'op_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
});
add('GET', '/api/auth/me', ({ user }) => ({ user }));

// ------------------------- customer login (OTP) -------------------------
function normalizePhone(v) {
  let p = str(v).replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  else if (/^0\d{9}$/.test(p)) p = '+218' + p.slice(1);
  else if (!p.startsWith('+')) p = '+' + p;
  return p;
}
add('POST', '/api/customer/send-code', ({ body }) => {
  const phone = normalizePhone(body.phone);
  if (phone.replace(/\D/g, '').length < 8) return { status: 400, body: { error: 'رقم الجوال غير صالح' } };
  run('UPDATE otp_codes SET used=1 WHERE phone=? AND used=0', phone);
  const code = String(crypto.randomInt(100000, 999999));
  run('INSERT INTO otp_codes (phone, code, expires_at, used, created_at) VALUES (?,?,?,0,?)', phone, code, Date.now() + 10 * 60 * 1000, now());
  // لا يوجد مزوّد SMS مجاني: الرمز يظهر هنا للمطوّر وللأدمن في «طلبات التحقق»
  return { ok: true, demoCode: code, phone };
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
  return {
    stats: {
      orders: get('SELECT COUNT(*) n FROM orders').n,
      products: get('SELECT COUNT(*) n FROM products').n,
      categories: get('SELECT COUNT(*) n FROM categories').n,
      conversations: get('SELECT COUNT(*) n FROM conversations').n,
      messages: get('SELECT COUNT(*) n FROM messages').n,
      customers: get('SELECT COUNT(*) n FROM customers').n,
      newOrders: get("SELECT COUNT(*) n FROM orders WHERE status='جديد'").n,
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
  items: all(`SELECT p.*, c.name_ar AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC`),
}), { auth: true });
add('POST', '/api/admin/products', ({ body }) => {
  const name = str(body.name_ar);
  if (!name) return { status: 400, body: { error: 'اسم المنتج مطلوب' } };
  const info = run(`INSERT INTO products (category_id,name_ar,name_en,description,price,old_price,image_url,icon,stock,active,colors_json,sizes_json,images_json,color_images_json,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    num(body.category_id) || null, name, str(body.name_en), str(body.description), num(body.price), num(body.old_price),
    str(body.image_url), str(body.icon) || '🛍️', num(body.stock), body.active === false ? 0 : 1,
    str(body.colors_json), str(body.sizes_json), str(body.images_json), str(body.color_images_json), now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/products/:id', ({ params, body }) => {
  run(`UPDATE products SET category_id=?,name_ar=?,name_en=?,description=?,price=?,old_price=?,image_url=?,icon=?,stock=?,active=?,colors_json=?,sizes_json=?,images_json=?,color_images_json=? WHERE id=?`,
    num(body.category_id) || null, str(body.name_ar), str(body.name_en), str(body.description), num(body.price), num(body.old_price),
    str(body.image_url), str(body.icon) || '🛍️', num(body.stock), body.active === false ? 0 : 1,
    str(body.colors_json), str(body.sizes_json), str(body.images_json), str(body.color_images_json), num(params.id));
  return { ok: true };
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
add('PUT', '/api/admin/orders/:id', ({ params, body }) => {
  const allowed = ['جديد', 'قيد التحضير', 'تم الإرسال', 'تم الشحن', 'مكتمل', 'ملغي'];
  const status = str(body.status);
  if (!allowed.includes(status)) return { status: 400, body: { error: 'حالة غير صالحة' } };
  run('UPDATE orders SET status=? WHERE id=?', status, num(params.id));
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/orders/:id', ({ params }) => {
  run('DELETE FROM orders WHERE id=?', num(params.id));
  return { ok: true };
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

const SETTING_KEYS = ['business_name', 'currency', 'country', 'whatsapp_number', 'wa_phone_number_id', 'wa_access_token', 'messenger_link', 'messenger_page_token', 'messenger_page_id', 'facebook_page_id', 'facebook_page_token', 'catalog_url', 'ai_enabled', 'greeting', 'footer_text', 'bot_tone'];
add('GET', '/api/admin/settings', () => {
  const s = getSettings();
  const out = {}; SETTING_KEYS.forEach(k => out[k] = s[k] ?? '');
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
  const token = getSettings().messenger_page_token || config.MESSENGER_PAGE_TOKEN;
  if (!token) return { status: 400, body: { error: 'أضف Page Token أولاً' } };
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok || !data.data?.is_valid) return { status: 400, body: { error: data.error?.message || 'التوكن غير صالح' } };
    return { ok: true, type: data.data.type, pageId: data.data.profile_id || '' };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
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

const BACKUP_TABLES = ['categories', 'products', 'orders', 'conversations', 'messages', 'faqs', 'customers', 'otp_codes'];
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
function webhookVerify({ query, res }) {
  const mode = str(query.get('hub.mode'));
  const token = str(query.get('hub.verify_token'));
  const challenge = str(query.get('hub.challenge'));
  if (mode === 'subscribe' && token === config.VERIFY_TOKEN) return text(res, 200, challenge);
  return text(res, 403, 'Forbidden');
}

add('GET', '/webhooks/whatsapp', webhookVerify);
add('POST', '/webhooks/whatsapp', ({ req, raw, body, res }) => {
  if (!verifyWebhookSignature(req, raw)) return text(res, 401, 'Invalid signature');
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) {
        const contact = (value.contacts || []).find(c => c.wa_id === msg.from);
        const messageText = msg.text?.body || msg.button?.text ||
          msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
        jobs.push(handleIncoming({
          platform: 'whatsapp', psid: str(msg.from), name: str(contact?.profile?.name),
          text: messageText, externalId: str(msg.id),
        }));
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

add('POST', '/webhooks/messenger', ({ req, raw, body, res }) => {
  if (!verifyWebhookSignature(req, raw)) return text(res, 401, 'Invalid signature');
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      if (ev.message?.is_echo) continue;
      const messageText = ev.message?.text || ev.postback?.payload || ev.message?.quick_reply?.payload ||
        (ev.message?.attachments?.length ? '📎 مرفق' : '');
      jobs.push(handleIncoming({
        platform: 'messenger', psid: str(ev.sender?.id),
        text: messageText, externalId: str(ev.message?.mid || ev.postback?.mid),
      }));
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
});
