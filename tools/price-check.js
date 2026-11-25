'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  for (const msg of ['كم السعر', 'السعر', 'أريد الطلب']) {
    const r = await fetch(`${base}/api/admin/test-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ message: msg }) });
    const d = await r.json();
    console.log(`${msg} => ${d.reply}`);
  }
})();
