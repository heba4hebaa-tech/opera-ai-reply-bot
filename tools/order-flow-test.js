'use strict';
const base = process.env.BASE || 'http://localhost:3000';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const psid = 'flowtest' + Date.now();
  for (const msg of ['أريد الطلب', 'قميص تجريبي', '2', 'أحمد', '218945343522', 'طرابلس']) {
    const r = await fetch(`${base}/api/admin/simulate/messenger`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ psid, message: msg }) });
    const d = await r.json();
    console.log(`👤 ${msg}\n🤖 ${d.reply}\n`);
  }
})();
