'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const d = await (await fetch(`${base}/api/admin/webhook-events`, { headers: { Cookie: ck } })).json();
  console.log('count:', d.items?.length);
  console.log((d.items || []).slice(0, 3).map(x => `${x.id} ${x.created_at} ${x.payload.slice(0, 180)}`).join('\n'));
})();
