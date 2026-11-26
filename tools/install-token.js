'use strict';
// يثبّت توكن الصفحة الجديد في إعدادات الإنتاج ويتحقق منه
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', 'data', '.page-token'), 'utf8').trim();
(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'L!F82E44094364' }),
  });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const put = await fetch(`${BASE}/api/admin/settings`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ messenger_page_token: TOKEN, messenger_page_id: '1428737297000917', facebook_page_id: '1428737297000917', messenger_link: 'https://m.me/1428737297000917' }),
  }).then(x => x.json());
  console.log('PUT', JSON.stringify(put));
  const t = await fetch(`${BASE}/api/admin/test-messenger`, { method: 'POST', headers: H, body: '{}' }).then(x => x.json());
  console.log('TEST', JSON.stringify(t).slice(0, 500));
  const th = await fetch(`${BASE}/api/admin/messenger/threads`, { headers: H }).then(x => x.json());
  console.log('THREADS', JSON.stringify(th).slice(0, 400));
  const ps = await fetch(`${BASE}/api/admin/poller/start`, { method: 'POST', headers: H, body: '{}' }).then(x => x.json());
  console.log('POLLER', JSON.stringify(ps));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
