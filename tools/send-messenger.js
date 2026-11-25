'use strict';
const config = require('../server/config');
const { getSettings } = require('../server/db');
const s = getSettings();
const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN;
const psid = process.argv[2] || '61596640424015';
const text = process.argv[3] || 'اختبار رد تلقائي من متجر أوبيرا 👋';
(async () => {
  const res = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: psid }, message: { text }, messaging_type: 'RESPONSE' }),
    signal: AbortSignal.timeout(15000),
  });
  console.log(res.status, (await res.text()).slice(0, 500).split(token).join('***'));
})();
