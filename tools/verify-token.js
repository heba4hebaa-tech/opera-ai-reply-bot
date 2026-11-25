'use strict';
// يتحقق من توكن مسنجر المضبوط في .env دون إظهاره في الإخراج
const config = require('../server/config');
const token = config.MESSENGER_PAGE_TOKEN;
if (!token) { console.log('messenger token غير مضبوط في .env'); process.exit(1); }

(async () => {
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    const info = data.data || {};
    if (!res.ok || data.error || !info.is_valid) {
      console.log('التوكن غير صالح:', JSON.stringify(data.error || data).split(token).join('***').slice(0, 400));
      process.exit(1);
    }
    console.log('التوكن صالح ✅');
    console.log('   النوع:', info.type);
    console.log('   معرف الصفحة:', info.profile_id);
    console.log('   الصلاحيات:', (info.scopes || []).join(', '));
    console.log('   ينتهي في:', info.expires_at ? new Date(info.expires_at * 1000).toLocaleDateString('ar-SA') : 'لا ينتهي');
    if (!(info.scopes || []).includes('pages_messaging')) {
      console.log('تحذير: صلاحية pages_messaging غير موجودة — الرد لن يعمل');
      process.exit(1);
    }
  } catch (e) {
    console.log('تعذر التحقق:', e.message);
    process.exit(1);
  }
})();
