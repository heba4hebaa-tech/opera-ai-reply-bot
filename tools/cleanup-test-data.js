'use strict';
// يمسح بيانات المحادثات/الرسائل التجريبية مع الحفاظ على المنتجات والأصناف وباقي البيانات
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const b = await fetch(`${BASE}/api/admin/backup`, { headers: H }).then(r => r.json());
  const payload = { version: b.version || 1, exported_at: b.exported_at };
  for (const t of ['categories', 'products', 'orders', 'conversations', 'messages', 'faqs', 'customers', 'otp_codes']) {
    payload[t] = Array.isArray(b[t]) ? b[t] : [];
  }
  payload.conversations = [];
  payload.messages = [];
  const r = await fetch(`${BASE}/api/admin/restore`, { method: 'POST', headers: H, body: JSON.stringify({ data: payload }) }).then(x => x.json());
  console.log('cleanup restore', JSON.stringify(r));
  const d = await fetch(`${BASE}/api/admin/dashboard`, { headers: H }).then(x => x.json());
  console.log('stats', JSON.stringify(d.stats));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
