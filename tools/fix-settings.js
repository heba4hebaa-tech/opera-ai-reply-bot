'use strict';
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  const payload = {
    messenger_page_id: '1428737297000917',
    facebook_page_id: '1428737297000917',
    messenger_link: 'https://m.me/1428737297000917',
    currency: 'د.ل',
    country: 'ليبيا',
    whatsapp_number: '218945343522',
  };
  const r = await fetch(`${BASE}/api/admin/settings`, { method: 'PUT', headers: H, body: JSON.stringify(payload) }).then(x => x.json());
  console.log('PUT', JSON.stringify(r));
  const s = await fetch(`${BASE}/api/admin/settings`, { headers: H }).then(x => x.json());
  console.log('mpid', s.settings.messenger_page_id, '| link', s.settings.messenger_link, '| cur', s.settings.currency);
  const t = await fetch(`${BASE}/api/admin/test-messenger`, { method: 'POST', headers: H, body: '{}' }).then(x => x.json());
  console.log('TEST-MESSENGER', JSON.stringify(t).slice(0, 1200));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
