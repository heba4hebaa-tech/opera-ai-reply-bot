'use strict';
// اختبار سريع: شغّل السيرفر ثم: node tools/smoke-test.js
const base = process.env.BASE || 'http://localhost:3000';
let cookie = '';

async function request(path, method = 'GET', body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.startsWith('op_session=')) cookie = setCookie.split(';')[0];
  let data = raw;
  try { data = JSON.parse(raw); } catch {}
  return { status: res.status, data };
}

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  let r = await request('/api/health');
  check('health', r.status === 200 && r.data.ok);

  r = await request('/api/store/info');
  check('store info', r.status === 200 && !!r.data.businessName, r.data.businessName);

  r = await request('/api/store/categories');
  check('categories', Array.isArray(r.data.items) && r.data.items.length > 0, `${r.data.items?.length} أصناف`);

  r = await request('/api/store/products');
  check('products', Array.isArray(r.data.items) && r.data.items.length > 0, `${r.data.items?.length} منتجات`);

  r = await request('/api/admin/dashboard');
  check('admin requires auth', r.status === 401);

  r = await request('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  check('login', r.status === 200 && r.data.ok);
  check('session cookie', !!cookie);

  r = await request('/api/admin/dashboard');
  check('dashboard', r.status === 200 && r.data.stats, JSON.stringify(r.data.stats));

  r = await request('/api/store/orders', 'POST', {
    customer_name: 'زبون تجريبي', phone: '0500000000', address: 'الرياض', notes: 'اختبار',
    items_json: JSON.stringify([{ id: 1, name: 'منتج تجريبي', price: 99, qty: 1 }]),
  });
  check('create order', r.status === 200 && !!r.data.orderId, '#' + r.data.orderId);

  r = await request('/api/admin/test-reply', 'POST', { message: 'المنتجات' });
  check('AI/test reply', r.status === 200 && !!r.data.reply, (r.data.reply || '').slice(0, 40).replace(/\n/g, ' '));

  r = await request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=opera-ai-verify-token&hub.challenge=SOME_CHALLENGE');
  check('whatsapp webhook verify', r.status === 200 && r.data === 'SOME_CHALLENGE');

  r = await request('/webhooks/messenger', 'POST', {
    object: 'page', entry: [{ id: '1', time: 1, messaging: [{ sender: { id: 'TEST_PSID' }, recipient: { id: 'PAGE' }, timestamp: 1, message: { mid: 'smoke.' + Date.now(), text: 'مرحباً' } }] }],
  });
  check('messenger webhook', r.status === 200 && r.data === 'OK');

  await new Promise(resolve => setTimeout(resolve, 600));
  r = await request('/api/admin/conversations');
  check('webhook stored conversation', Array.isArray(r.data.items) && r.data.items.some(c => c.platform === 'messenger'), `${r.data.items?.length} محادثة`);

  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} نجحت`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
