'use strict';
// اختبار الرد الذكي على السيرفر المحدد بـ BASE
const base = process.env.BASE || 'http://localhost:3000';
(async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'L!F82E44094364' }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const res = await fetch(`${base}/api/admin/test-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ message: 'كم سعر القميص؟' }),
  });
  const d = await res.json();
  console.log('status:', res.status);
  console.log('reply:', d.reply || d.error);
})();
