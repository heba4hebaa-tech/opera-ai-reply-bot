'use strict';
const config = require('../server/config');
const { getSettings } = require('../server/db');
const token = getSettings().wa_access_token || config.WA_ACCESS_TOKEN;
(async () => {
  for (const path of ['me/accounts', '2122365468403075/accounts']) {
    const r = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${path}?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    console.log(path, r.status, JSON.stringify(d).split(token).join('***').slice(0, 900));
  }
})();
