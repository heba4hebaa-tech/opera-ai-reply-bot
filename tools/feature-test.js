'use strict';
const base = process.env.BASE || 'http://localhost:3000';
let adminCookie = '', customerCookie = '';

async function call(path, method = 'GET', body, cookie) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data = raw; try { data = JSON.parse(raw); } catch {}
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
function check(name, ok, detail = '') { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); return ok; }

(async () => {
  const results = [];
  let r = await call('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  adminCookie = r.cookie; results.push(check('admin login', r.status === 200));

  r = await call('/api/admin/categories', 'POST', {
    name_ar: 'ملابس تجريبية', has_options: true,
    colors_json: JSON.stringify(['أحمر', 'أزرق']), sizes_json: JSON.stringify(['S', 'M', 'L']), active: true,
  }, adminCookie);
  const catId = r.data.id; results.push(check('category with options', !!catId));

  r = await call('/api/admin/products', 'POST', {
    name_ar: 'قميص تجريبي', category_id: catId, price: 50, stock: 10,
    colors_json: JSON.stringify(['أحمر', 'أزرق']), sizes_json: JSON.stringify(['S', 'M']), active: true,
  }, adminCookie);
  results.push(check('product with options', !!r.data.id));

  r = await call('/api/store/products');
  const p = r.data.items.find(x => x.name_ar === 'قميص تجريبي');
  results.push(check('store returns options', !!p && p.colors_json.includes('أحمر') && p.sizes_json.includes('M')));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(base + '/api/admin/upload', {
    method: 'POST', headers: { 'Content-Type': 'image/png', 'X-File-Name': 'test.png', Cookie: adminCookie }, body: png,
  });
  const upData = await up.json();
  results.push(check('image upload', up.ok && upData.url && upData.url.startsWith('/uploads/'), upData.url));

  r = await call('/api/customer/send-code', 'POST', { phone: '+218945343522' });
  const code = r.data.demoCode; results.push(check('send OTP', r.status === 200 && !!code, code));

  r = await call('/api/customer/verify', 'POST', { phone: '+218945343522', code });
  customerCookie = r.cookie; results.push(check('verify OTP', r.status === 200 && !!r.data.customer));

  r = await call('/api/customer/profile', 'PUT', {
    name: 'زبون تجريبي', city: 'طرابلس', address: 'شارع التجربة', latitude: 32.89, longitude: 13.19,
  }, customerCookie);
  results.push(check('save customer profile', r.status === 200));

  r = await call('/api/customer/me', 'GET', undefined, customerCookie);
  results.push(check('customer me', r.data.customer?.name === 'زبون تجريبي'));

  r = await call('/api/store/orders', 'POST', {
    customer_name: 'زبون تجريبي', phone: '+218945343522', address: 'طرابلس',
    items_json: JSON.stringify([{ id: p.id, name: p.name_ar, price: 50, qty: 2, options: 'أحمر / M' }]),
  }, customerCookie);
  results.push(check('order with options and customer', r.status === 200 && !!r.data.orderId));

  r = await call('/api/admin/backup', 'GET', undefined, adminCookie);
  results.push(check('backup includes customers', Array.isArray(r.data.customers) && r.data.customers.length > 0));

  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} نجحت`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
