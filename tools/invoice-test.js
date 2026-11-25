'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ck = (l.headers.get('set-cookie') || '').split(';')[0];
  const o = await fetch(`${base}/api/store/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'اختبار فاتورة', phone: '218945343522', address: 'طرابلس', delivery_method: 'توصيل للمنزل', items_json: JSON.stringify([{ id: 1, name: 'قميص تجريبي', price: 50, qty: 2 }]) }) });
  const d = await o.json();
  const inv = await fetch(`${base}/api/admin/orders/${d.orderId}/invoice`, { headers: { Cookie: ck } });
  const html = await inv.text();
  console.log('order:', d.orderId, 'invoice:', inv.status, 'hasBrand:', html.includes('LUNZERA'), 'hasPrint:', html.includes('window.print'), 'hasDelivery:', html.includes('توصيل للمنزل'));
})();
