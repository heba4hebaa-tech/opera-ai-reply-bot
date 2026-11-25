'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const r = await fetch(`${base}/api/customer/signin-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dbg@example.com' }) });
  console.log(r.status, (await r.text()).slice(0, 300));
  const me = await fetch(`${base}/api/customer/me`, { headers: { Cookie: (r.headers.get('set-cookie') || '').split(';')[0] } });
  console.log('me:', me.status, (await me.text()).slice(0, 200));
})();
