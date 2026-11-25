'use strict';
const config = require('../server/config');
(async () => {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${config.GEMINI_API_KEY}&pageSize=100`, { signal: AbortSignal.timeout(20000) });
  const d = await res.json();
  if (!res.ok) { console.log('خطأ:', JSON.stringify(d).slice(0, 400)); process.exit(1); }
  console.log((d.models || []).map(m => m.name.replace('models/', '')).join('\n'));
})();
