'use strict';
const fs = require('node:fs');
const path = require('node:path');
const TOKEN = process.argv[2] || fs.readFileSync(path.join(__dirname, '..', 'data', '.page-token'), 'utf8').trim();
const PAGE = '1428737297000917';
(async () => {
  const dbg = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`).then(r => r.json());
  console.log('DEBUG', JSON.stringify(dbg).slice(0, 600));
  const me = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,link&access_token=${encodeURIComponent(TOKEN)}`).then(r => r.json());
  console.log('ME', JSON.stringify(me));
  const convs = await fetch(`https://graph.facebook.com/v21.0/${PAGE}/conversations?fields=id&limit=3&access_token=${encodeURIComponent(TOKEN)}`).then(r => r.json());
  console.log('CONVS', JSON.stringify(convs).slice(0, 300));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
