'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const l = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      const cookie = (l.headers.get('set-cookie') || '').split(';')[0];
      const r = await fetch(`${base}/api/admin/settings`, { headers: { Cookie: cookie } });
      const d = await r.json();
      if (d.settings && Object.prototype.hasOwnProperty.call(d.settings, 'country')) {
        console.log('new version live');
        const s = await fetch(`${base}/api/admin/settings`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ currency: 'د.ل', country: 'ليبيا', whatsapp_number: '218945343522' }),
        });
        console.log('settings updated:', (await s.json()).ok);
        process.exit(0);
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('not live yet');
})();
