'use strict';
// اختبار إرسال حقيقي عبر مسار مسنجر في السيرفر
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const psid = process.argv[2] || '29627563696867106';
const text = process.argv[3] || 'مرحباً عمّار 👋 رسالة اختبار من متجر Lunzera — البوت يستقبلك الآن ✅';

(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const th = await fetch(`${BASE}/api/admin/messenger/threads`, { headers: H }).then(r => r.json());
  console.log('THREADS', JSON.stringify(th).slice(0, 800));
  const r = await fetch(`${BASE}/api/admin/messenger/send`, {
    method: 'POST', headers: H, body: JSON.stringify({ psid, text }),
  }).then(x => x.json());
  console.log('SEND', JSON.stringify(r));
})().catch(e => console.error('ERR', e.message));
