'use strict';
// يعيد بيانات الإنتاج الحالية إلى السيرفر بعد النشر (القاعدة على Render تُمسح عند كل نشر)
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const FILE = path.join(__dirname, '..', 'data', 'production-backup.json');

(async () => {
  if (!fs.existsSync(FILE)) { console.error('no backup file:', FILE); process.exit(1); }
  const bak = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!l.ok) throw new Error('login failed: ' + l.status);
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const tables = bak.tables || {};
  const payload = { version: bak.version || 1, exported_at: bak.exported_at, ...tables };
  const r = await fetch(`${BASE}/api/admin/restore`, { method: 'POST', headers: H, body: JSON.stringify({ data: payload }) }).then(x => x.json());
  console.log('restore tables:', JSON.stringify(r));
  if (bak.settings && Object.keys(bak.settings).length) {
    const s = await fetch(`${BASE}/api/admin/settings`, { method: 'PUT', headers: H, body: JSON.stringify(bak.settings) }).then(x => x.json());
    console.log('restore settings:', JSON.stringify(s));
  }
  const d = await fetch(`${BASE}/api/admin/dashboard`, { headers: H }).then(x => x.json());
  const st = d.stats || {};
  console.log('verify:', JSON.stringify({ categories: st.categories, products: st.products, orders: st.orders, customers: st.customers, revenue: st.revenue }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
