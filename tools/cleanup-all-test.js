'use strict';
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const TABLES = ['categories', 'products', 'orders', 'conversations', 'messages', 'faqs', 'customers', 'otp_codes', 'ads', 'replies', 'post_rules', 'notifications'];
(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const b = await fetch(`${BASE}/api/admin/backup`, { headers: H }).then(r => r.json());
  const payload = { version: 1 };
  for (const t of TABLES) payload[t] = Array.isArray(b[t]) ? b[t] : [];
  // امسح بيانات الاختبار
  for (const t of ['conversations', 'messages', 'replies', 'post_rules', 'notifications', 'otp_codes']) payload[t] = [];
  const r = await fetch(`${BASE}/api/admin/restore`, { method: 'POST', headers: H, body: JSON.stringify({ data: payload }) }).then(x => x.json());
  console.log('cleanup', JSON.stringify(r));
  const d = await fetch(`${BASE}/api/admin/dashboard`, { headers: H }).then(x => x.json());
  console.log('stats', JSON.stringify({ c: d.stats?.conversations, m: d.stats?.messages, cats: d.stats?.categories, prods: d.stats?.products }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
