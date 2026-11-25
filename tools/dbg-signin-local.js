'use strict';
fetch('http://localhost:3000/api/customer/signin-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dbg2@example.com' }) })
  .then(async r => {
    console.log('status', r.status);
    console.log(await r.text());
  }).catch(e => console.error(e));
