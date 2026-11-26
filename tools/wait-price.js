'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  for (let i = 0; i < 50; i++) {
    const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'L!F82E44094364' }) });
    const ck = (l.headers.get('set-cookie') || '').split(';')[0];
    const r = await fetch(`${base}/api/admin/test-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ message: 'كم السعر' }) });
    const d = await r.json();
    if (d.reply && !d.reply.includes('ما المنتج الذي تريد')) {
      console.log('live:', d.reply); process.exit(0);
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  console.log('not live'); process.exit(1);
})();
