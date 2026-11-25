'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const cookie = (l.headers.get('set-cookie') || '').split(';')[0];
  const d = await (await fetch(`${base}/api/admin/settings`, { headers: { Cookie: cookie } })).json();
  console.log('hasFb:', Object.prototype.hasOwnProperty.call(d.settings, 'facebook_page_id'));
  console.log('keys:', Object.keys(d.settings).join(','));
  console.log('runtime:', d.runtime);
})();
