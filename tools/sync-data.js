'use strict';
// يجلب نسخة احتياطية من الإنتاج ويحفظها في المستودع (seed/production-backup.json)
// حتى تُستعاد تلقائياً عند الإقلاع بعد كل عملية نشر (قاعدة بيانات Render مؤقتة).
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const OUT = path.join(__dirname, '..', 'data', 'production-backup.json');

(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'L!F82E44094364' }),
  });
  if (!l.ok) throw new Error('login failed: ' + l.status);
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck };
  const backup = await fetch(`${BASE}/api/admin/backup`, { headers: H }).then(r => r.json());
  const settingsResp = await fetch(`${BASE}/api/admin/settings`, { headers: H }).then(r => r.json());
  if (!backup || !backup.categories) throw new Error('backup failed: ' + JSON.stringify(backup).slice(0, 200));
  const tables = {};
  for (const k of ['categories', 'products', 'orders', 'conversations', 'messages', 'faqs', 'customers', 'otp_codes', 'ads', 'replies', 'post_rules', 'notifications']) {
    tables[k] = Array.isArray(backup[k]) ? backup[k] : [];
  }
  // إزالة الأسرار حتى لا تُرفع إلى المستودع (تعتمد على متغيرات بيئة Render)
  const SECRET_KEYS = ['wa_access_token', 'messenger_page_token', 'facebook_page_token'];
  const settings = { ...(settingsResp.settings || {}) };
  // حفظ الأسرار في ملف محلي مُتجاهَل من Git (data/) ليُعاد حقنها بعد النشر ولا تُفقد
  const secrets = {};
  for (const k of SECRET_KEYS) if (settings[k]) secrets[k] = settings[k];
  // معرّفات الصفحة والأرقام ليست أسراراً لكنها أساسية — نحفظها في ملف الأسرار أيضاً كاحتياط
  for (const k of ['messenger_page_id', 'facebook_page_id', 'messenger_link', 'wa_phone_number_id', 'whatsapp_number'])
    if (settings[k]) secrets[k] = settings[k];
  const secretsFile = path.join(path.dirname(OUT), '.secrets.json');
  // دمج مع الأسرار المحفوظة سابقاً حتى لا نفقد أي شيء إن كانت الإنتاج فارغة حالياً
  let prev = {};
  try { if (fs.existsSync(secretsFile)) prev = JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch {}
  const mergedSecrets = { ...prev, ...secrets };
  fs.writeFileSync(secretsFile, JSON.stringify(mergedSecrets, null, 1), 'utf8');
  for (const k of SECRET_KEYS) delete settings[k];
  const out = {
    version: 1,
    exported_at: new Date().toISOString(),
    source: BASE,
    settings,
    tables,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  console.log('saved ->', OUT);
  console.log('counts:', JSON.stringify(counts));
  console.log('settings keys:', Object.keys(out.settings).length);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
