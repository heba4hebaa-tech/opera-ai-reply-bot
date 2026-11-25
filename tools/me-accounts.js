'use strict';
const token = process.argv[2];
(async () => {
  const r = await fetch('https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=' + encodeURIComponent(token), { signal: AbortSignal.timeout(15000) });
  const d = await r.json();
  console.log(r.status, JSON.stringify(d).split(token).join('***').slice(0, 1500));
})();
