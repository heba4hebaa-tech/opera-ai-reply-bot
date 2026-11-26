'use strict';
const BASE = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck };
  for (let i = 0; i < 8; i++) {
    const s = await fetch(`${BASE}/api/admin/poller/status`, { headers: H }).then(r => r.json());
    if (s.messages > 0) break;
    await new Promise(r => setTimeout(r, 5000));
  }
  const ws = await fetch(`${BASE}/api/admin/webhook-status`, { headers: H }).then(r => r.json());
  console.log('STATUS', JSON.stringify({ lastMessage: ws.lastMessage, events: (ws.events || []).length }));
  const ev = await fetch(`${BASE}/api/admin/webhook-events`, { headers: H }).then(r => r.json());
  for (const e of (ev.items || []).slice(0, 4)) {
    const txt = (e.payload || '').match(/"text":"([^"]+)"/);
    console.log('-', e.platform, e.created_at, txt ? txt[1] : (e.payload || '').slice(0, 80));
  }
})().catch(e => console.error('ERR', e.message));
