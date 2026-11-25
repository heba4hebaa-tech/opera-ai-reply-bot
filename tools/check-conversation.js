'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const c = await (await fetch(`${base}/api/admin/conversations`, { headers: { Cookie: ck } })).json();
  console.log('conversations:', JSON.stringify(c.items?.slice(0, 3)));
  const id = c.items?.[0]?.id;
  if (id) {
    const m = await (await fetch(`${base}/api/admin/conversations/${id}/messages`, { headers: { Cookie: ck } })).json();
    console.log('messages:', JSON.stringify(m.items));
  }
})();
