'use strict';
const config = require('../server/config');
(async () => {
  if (!config.GEMINI_API_KEY) { console.log('GEMINI_API_KEY غير مضبوط'); process.exit(1); }
  const models = [...new Set([config.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'])];
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_API_KEY}`;
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'قل: تم بنجاح' }] }] }),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      if (!res.ok) { console.log(model, '→', res.status, text.slice(0, 180).split(config.GEMINI_API_KEY).join('***')); continue; }
      const d = JSON.parse(text);
      const out = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      console.log('Gemini يعمل ✅ | النموذج:', model, '| الرد:', out.slice(0, 80));
      process.exit(0);
    } catch (e) { console.log(model, '→ خطأ', e.message); }
  }
  console.log('فشل كل النماذج');
  process.exit(1);
})();
