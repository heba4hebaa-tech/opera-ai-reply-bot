'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { all, get, run, now, getSettings, setSetting, hashPassword, verifyPassword } = require('./db');
const { handleIncoming, generateReply } = require('./services/chat');
const { credentials: waCredentials } = require('./services/platforms');

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
    businessName: s.business_name, currency: s.currency, footerText: s.footer_text,
    whatsappNumber: s.whatsapp_number, messengerLink: s.messenger_link, catalogUrl: s.catalog_url,
  };
});

add('GET', '/api/store/categories', () => ({
  items: all('SELECT id, name_ar, name_en, description, icon FROM categories WHERE active = 1 ORDER BY sort_order, id'),
}));

add('GET', '/api/store/products', ({ query }) => {
  const cat = Number(query.get('category') || 0);
  const q = str(query.get('q') || '');
  const rows = cat
    ? all('SELECT id, category_id, name_ar, name_en, description, price, old_price, image_url, icon, stock FROM products WHERE active=1 AND category_id=? ORDER BY id DESC', cat)
    : all('SELECT id, category_id, name_ar, name_en, description, price, old_price, image_url, icon, stock FROM products WHERE active=1 ORDER BY id DESC');
  return { items: q ? rows.filter(p => (p.name_ar + p.name_en + p.description).toLowerCase().includes(q.toLowerCase())) : rows };
});

add('POST', '/api/store/orders', ({ body }) => {
  const name = str(body.customer_name);
  const phone = str(body.phone);
  if (!name || !phone) return { status: 400, body: { error: 'الاسم ورقم الجوال مطلوبان' } };
  let items = [];
  try { items = JSON.parse(body.items_json || '[]'); } catch { items = []; }
  if (!Array.isArray(items) || !items.length) return { status: 400, body: { error: 'السلة فارغة' } };
  const clean = items.map(i => ({
    id: num(i.id), name: str(i.name).slice(0, 200), price: num(i.price), qty: Math.max(1, Math.min(99, num(i.qty))),
  }));
  const total = clean.reduce((s, i) => s + i.price * i.qty, 0);
  const info = run(`INSERT INTO orders (customer_name, phone, address, notes, items_json, total, status, source, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?)`,
    name.slice(0, 120), phone.slice(0, 40), str(body.address).slice(0, 300), str(body.notes).slice(0, 500),
    JSON.stringify(clean), total, 'جديد', 'المتجر', now());
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
      newOrders: get("SELECT COUNT(*) n FROM orders WHERE status='جديد'").n,
    },
    recentOrders: all('SELECT id, customer_name, phone, total, status, source, created_at FROM orders ORDER BY id DESC LIMIT 6'),
    recentConversations: all(`SELECT c.id, c.platform, c.name, c.psid, c.updated_at,
      (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM conversations c ORDER BY c.updated_at DESC LIMIT 6`),
    config: {
      gemini: !!config.GEMINI_API_KEY,
      whatsapp: !!(s.wa_phone_number_id || config.WA_PHONE_NUMBER_ID) && !!(s.wa_access_token || config.WA_ACCESS_TOKEN),
      messenger: !!config.MESSENGER_PAGE_TOKEN, webhookSecret: !!config.META_APP_SECRET,
    },
    businessName: s.business_name,
  };
}, { auth: true });

add('GET', '/api/admin/categories', () => ({ items: all('SELECT * FROM categories ORDER BY sort_order, id') }), { auth: true });
add('POST', '/api/admin/categories', ({ body }) => {
  const name = str(body.name_ar);
  if (!name) return { status: 400, body: { error: 'اسم الصنف مطلوب' } };
  const info = run('INSERT INTO categories (name_ar,name_en,description,icon,active,sort_order,created_at) VALUES (?,?,?,?,?,?,?)',
    name, str(body.name_en), str(body.description), str(body.icon) || '📦', body.active === false ? 0 : 1, num(body.sort_order), now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/categories/:id', ({ params, body }) => {
  const id = num(params.id);
  run('UPDATE categories SET name_ar=?,name_en=?,description=?,icon=?,active=?,sort_order=? WHERE id=?',
    str(body.name_ar), str(body.name_en), str(body.description), str(body.icon) || '📦', body.active === false ? 0 : 1, num(body.sort_order), id);
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
  const info = run(`INSERT INTO products (category_id,name_ar,name_en,description,price,old_price,image_url,icon,stock,active,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    num(body.category_id) || null, name, str(body.name_en), str(body.description), num(body.price), num(body.old_price),
    str(body.image_url), str(body.icon) || '🛍️', num(body.stock), body.active === false ? 0 : 1, now());
  return { ok: true, id: Number(info.lastInsertRowid) };
}, { auth: true });
add('PUT', '/api/admin/products/:id', ({ params, body }) => {
  run(`UPDATE products SET category_id=?,name_ar=?,name_en=?,description=?,price=?,old_price=?,image_url=?,icon=?,stock=?,active=? WHERE id=?`,
    num(body.category_id) || null, str(body.name_ar), str(body.name_en), str(body.description), num(body.price), num(body.old_price),
    str(body.image_url), str(body.icon) || '🛍️', num(body.stock), body.active === false ? 0 : 1, num(params.id));
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
  const allowed = ['جديد', 'قيد التحضير', 'تم الشحن', 'مكتمل', 'ملغي'];
  const status = str(body.status);
  if (!allowed.includes(status)) return { status: 400, body: { error: 'حالة غير صالحة' } };
  run('UPDATE orders SET status=? WHERE id=?', status, num(params.id));
  return { ok: true };
}, { auth: true });
add('DELETE', '/api/admin/orders/:id', ({ params }) => {
  run('DELETE FROM orders WHERE id=?', num(params.id));
  return { ok: true };
}, { auth: true });

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

const SETTING_KEYS = ['business_name', 'currency', 'whatsapp_number', 'wa_phone_number_id', 'wa_access_token', 'messenger_link', 'catalog_url', 'ai_enabled', 'greeting', 'footer_text', 'bot_tone'];
add('GET', '/api/admin/settings', () => {
  const s = getSettings();
  const out = {}; SETTING_KEYS.forEach(k => out[k] = s[k] ?? '');
  const wa = waCredentials();
  return { settings: out, runtime: { gemini: !!config.GEMINI_API_KEY, model: config.GEMINI_MODEL, whatsapp: !!(wa.token && wa.phoneId), whatsappFromSettings: !!s.wa_phone_number_id, messenger: !!config.MESSENGER_PAGE_TOKEN } };
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

const BACKUP_TABLES = ['categories', 'products', 'orders', 'conversations', 'messages', 'faqs'];
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
    if (raw.length) {
      try { body = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'JSON غير صالح' }); }
    }
    const m = matched.regex.exec(pathname);
    const params = {};
    matched.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const user = readSession(req);
    if (matched.opts.auth && !user) return json(res, 401, { error: 'يرجى تسجيل الدخول' });
    res.localsProto = String(req.headers['x-forwarded-proto'] || 'http');

    const result = await matched.handler({ req, res, params, query: url.searchParams, body, raw, user });
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
