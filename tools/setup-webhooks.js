'use strict';
// إعداد اشتراكات Webhook في Meta عبر Graph API
const config = require('../server/config');
const BASE = 'https://opera-ai-reply-bot.onrender.com';
const WABA_ID = '1436722615117487';
const PAGE_ID = '1428737297000917';

async function post(path, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(20000),
  });
  const d = await res.json();
  console.log(path, '->', res.status, JSON.stringify(d).split(token).join('***').slice(0, 300));
  return res.ok && d.success !== false;
}

(async () => {
  await post(`${WABA_ID}/subscriptions`, {
    callback_url: `${BASE}/webhooks/whatsapp`,
    verify_token: config.VERIFY_TOKEN,
    fields: 'messages',
  }, config.WA_ACCESS_TOKEN);
  await post(`${PAGE_ID}/subscriptions`, {
    callback_url: `${BASE}/webhooks/messenger`,
    verify_token: config.VERIFY_TOKEN,
    fields: 'messages,messaging_postbacks',
  }, config.MESSENGER_PAGE_TOKEN);
})();
