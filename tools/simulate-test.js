'use strict';
const base = process.env.BASE || 'http://localhost:3000';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  for (const platform of ['whatsapp', 'messenger']) {
    const r = await fetch(`${base}/api/admin/simulate/${platform}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ psid: '12345', name: 'اختبار', message: 'أريد أن أعرف ما هو سعر القميص؟' }) });
    console.log(platform, r.status, (await r.text()).slice(0, 300));
  }
})();
