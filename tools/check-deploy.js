'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'L!F82E44094364' }),
      });
      const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
      const r = await fetch(`${base}/api/admin/backup`, { headers: { Cookie: cookie } });
      if (r.ok) {
        const d = await r.json();
        console.log('deployed OK | backup tables:', Object.keys(d).join(','));
        process.exit(0);
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('not deployed yet');
})();
