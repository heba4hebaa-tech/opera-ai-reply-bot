'use strict';
const BASE = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const h = await fetch(`${BASE}/api/health`).then(r => r.json());
  console.log('HEALTH', JSON.stringify(h));
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'L!F82E44094364' }),
  });
  console.log('LOGIN', l.status);
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const s = await fetch(`${BASE}/api/admin/settings`, { headers: H }).then(r => r.json());
  console.log('SETTINGS', JSON.stringify({ cur: s.settings?.currency, mpid: s.settings?.messenger_page_id, fpid: s.settings?.facebook_page_id, link: s.settings?.messenger_link, wa: s.settings?.whatsapp_number, mpt: !!(s.settings?.messenger_page_token), fpt: !!(s.settings?.facebook_page_token), keys: Object.keys(s.settings || {}).length }));
  const d = await fetch(`${BASE}/api/admin/dashboard`, { headers: H }).then(r => r.json());
  console.log('DASH', JSON.stringify(d.stats));
  const b = await fetch(`${BASE}/api/admin/backup`, { headers: H }).then(r => r.json());
  console.log('BACKUP', JSON.stringify(Object.fromEntries(['categories', 'products', 'orders', 'conversations', 'messages', 'faqs', 'customers'].map(k => [k, Array.isArray(b[k]) ? b[k].length : 'missing']))));
  const ps = await fetch(`${BASE}/api/admin/poller/status`, { headers: H }).then(r => r.json());
  console.log('POLLER', JSON.stringify(ps));
})().catch(e => console.error('ERR', e.message));
