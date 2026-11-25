'use strict';
const { sendOptions } = require('../server/services/platforms');
(async () => {
  const psid = process.argv[2] || '29798628459774666';
  for (const p of ['messenger', 'whatsapp']) {
    const r = await sendOptions(p, psid, 'اختر من الخيارات:', ['قميص تجريبي', 'عرض تجريبي', 'خدمة تجريبية']);
    console.log(p, JSON.stringify(r));
  }
})();
