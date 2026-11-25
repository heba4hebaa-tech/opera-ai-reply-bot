'use strict';
const config = require('../server/config');
const { getSettings } = require('../server/db');
const s = getSettings();
const tokens = [
  ['messenger', s.messenger_page_token || config.MESSENGER_PAGE_TOKEN],
  ['whatsapp', s.wa_access_token || config.WA_ACCESS_TOKEN],
];
(async () => {
  for (const [name, token] of tokens) {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/61596640424015?fields=id,name,link&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    console.log(name, r.status, JSON.stringify(d).split(token).join('***').slice(0, 500));
  }
})();
