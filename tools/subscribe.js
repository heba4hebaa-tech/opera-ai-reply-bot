'use strict';
const BASE = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'L!F82E44094364' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const sub = await fetch(`${BASE}/api/admin/subscribe-messenger`, { method: 'POST', headers: H, body: '{}' }).then(r => r.json()).catch(e => ({ err: e.message }));
  console.log('SUBSCRIBE', JSON.stringify(sub).slice(0, 500));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
