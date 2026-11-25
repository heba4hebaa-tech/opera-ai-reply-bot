'use strict';
const config = require('../server/config');
const { getSettings } = require('../server/db');
(async () => {
  const s = getSettings();
  const token = s.wa_access_token || config.WA_ACCESS_TOKEN;
  const phoneId = s.wa_phone_number_id || config.WA_PHONE_NUMBER_ID;
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: '218945343522', type: 'text', text: { body: 'اختبار رد تلقائي من المتجر' } }),
  });
  console.log(res.status, (await res.text()).slice(0, 500).split(token).join('***'));
})();
