'use strict';
const base = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const res = await fetch(`${base}/api/admin/settings`, { headers: { Cookie: cookie } });
  const d = await res.json();
  console.log(res.status, 'keys:', Object.keys(d.settings).join(','));
  console.log('whatsapp display:', d.settings.whatsapp_number, '| runtime:', JSON.stringify(d.runtime));
})();
