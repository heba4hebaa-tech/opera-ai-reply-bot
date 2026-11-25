'use strict';
const t = process.argv[2];
(async () => {
  const r = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`);
  const d = await r.json();
  console.log(r.status, JSON.stringify({ valid: d.data?.is_valid, type: d.data?.type, scopes: d.data?.scopes, err: d.error?.message }));
})();
