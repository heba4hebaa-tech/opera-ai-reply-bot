'use strict';
const base = process.env.BASE || 'http://localhost:3000';
const number = process.argv[2] || '218945343522';
(async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const res = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ whatsapp_number: number }),
  });
  const d = await res.json();
  console.log(res.status, d);
})();
