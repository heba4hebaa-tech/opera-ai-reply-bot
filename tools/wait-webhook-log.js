'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${base}/api/admin/webhook-events`);
    const t = await r.text();
    if (!t.includes('الصفحة غير موجودة')) { console.log('live:', t.slice(0, 120)); process.exit(0); }
    await new Promise(r => setTimeout(r, 4000));
  }
  console.log('not live'); process.exit(1);
})();
