'use strict';
const BASE = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const mid = 'm_SYNTHETIC_' + Date.now();
  const sender = process.argv[2] || '29627563696867106';
  const text = process.argv[3] || 'اختبار webhook حقيقي بعد النشر — رد واحد فقط';
  const payload = {
    object: 'page',
    entry: [{
      id: '1428737297000917', time: Date.now(),
      messaging: [{ sender: { id: sender }, recipient: { id: '1428737297000917' }, timestamp: Date.now(), message: { mid, text } }],
    }],
  };
  const r = await fetch(`${BASE}/webhooks/messenger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  console.log('webhook POST status', r.status, await r.text());
  await new Promise(r => setTimeout(r, 6000));
  const l = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck };
  const ws = await fetch(`${BASE}/api/admin/webhook-status`, { headers: H }).then(r => r.json());
  console.log('lastMessage', JSON.stringify(ws.lastMessage));
  const dash = await fetch(`${BASE}/api/admin/dashboard`, { headers: H }).then(r => r.json());
  console.log('stats', JSON.stringify(dash.stats));
  const ps = await fetch(`${BASE}/api/admin/poller/status`, { headers: H }).then(r => r.json());
  console.log('poller', JSON.stringify(ps));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
