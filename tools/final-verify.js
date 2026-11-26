'use strict';
const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const results = [];
const check = (name, ok, d = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${d ? ' — ' + d : ''}`); };
(async () => {
  const h = await fetch(`${BASE}/api/health`).then(r => r.json());
  check('health/live', h.ok === true, 'build ' + h.build);
  const cats = await fetch(`${BASE}/api/store/categories`).then(r => r.json());
  const prods = await fetch(`${BASE}/api/store/products`).then(r => r.json());
  check('store data', (prods.items || []).length >= 5 && (cats.items || []).length >= 3,
    `${(cats.items||[]).length} cats / ${(prods.items||[]).length} products`);
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: ck, 'Content-Type': 'application/json' };
  check('admin login', l.status === 200);
  const dash = await fetch(`${BASE}/api/admin/dashboard`, { headers: H }).then(r => r.json());
  check('dashboard', !!dash.stats, JSON.stringify(dash.stats || {}).slice(0, 120));
  const s = await fetch(`${BASE}/api/admin/settings`, { headers: H }).then(r => r.json());
  check('settings currency/page', s.settings.currency === 'د.ل' && s.settings.messenger_page_id === '1428737297000917');
  check('runtime adapters', s.runtime.messenger === true && s.runtime.whatsapp === true, JSON.stringify(s.runtime));
  const t = await fetch(`${BASE}/api/admin/test-messenger`, { method: 'POST', headers: H, body: '{}' }).then(r => r.json());
  check('messenger token', t.ok === true && t.type === 'PAGE', String(t.pageId || t.error || ''));
  const th = await fetch(`${BASE}/api/admin/messenger/threads`, { headers: H }).then(r => r.json());
  check('messenger threads read', th.ok === true && (th.threads || []).length >= 1, `${(th.threads||[]).length} threads`);
  const ws = await fetch(`${BASE}/api/admin/webhook-status`, { headers: H }).then(r => r.json());
  check('webhook messages arrived', !!ws.lastMessage, ws.lastMessage ? ws.lastMessage.text : 'no events');
  const ps = await fetch(`${BASE}/api/admin/poller/status`, { headers: H }).then(r => r.json());
  check('poller running', ps.enabled === true && ps.errors === 0, `runs=${ps.runs} errors=${ps.errors}`);
  const b = await fetch(`${BASE}/api/admin/backup`, { headers: H }).then(r => r.json());
  check('backup endpoint', Array.isArray(b.categories) && Array.isArray(b.products), Object.keys(b).slice(0, 6).join(','));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
