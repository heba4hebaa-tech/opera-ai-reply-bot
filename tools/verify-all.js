'use strict';
// يتحقق من توكنات Meta المضبوطة في .env دون إظهارها
const config = require('../server/config');

async function debug(token, label) {
  if (!token) { console.log(`${label}: غير مضبوط`); return false; }
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    const info = data.data || {};
    if (!res.ok || data.error || !info.is_valid) {
      console.log(`${label}: غير صالح — ${JSON.stringify(data.error || data).split(token).join('***').slice(0, 250)}`);
      return false;
    }
    console.log(`${label}: صالح ✅ | النوع: ${info.type} | الصفحة/الحساب: ${info.profile_id || '—'} | الصلاحيات: ${(info.scopes || []).join(', ')}`);
    return true;
  } catch (e) { console.log(`${label}: تعذر التحقق — ${e.message}`); return false; }
}

(async () => {
  await debug(config.MESSENGER_PAGE_TOKEN, 'مسنجر   ');
  await debug(config.WA_ACCESS_TOKEN, 'واتساب ');
})();
