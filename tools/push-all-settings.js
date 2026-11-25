'use strict';
// يضبط كل الإعدادات المتاحة محلياً (من .env) على النسخة المنشورة
const config = require('../server/config');
const base = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';

(async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) { console.log('لا يمكن تسجيل الدخول كأدمن'); process.exit(1); }
  const payload = {
    currency: 'د.ل', country: 'ليبيا', business_name: 'متجر أوبيرا',
    whatsapp_number: '218945343522',
    wa_phone_number_id: config.WA_PHONE_NUMBER_ID || '1512173858641011',
    wa_access_token: config.WA_ACCESS_TOKEN,
    messenger_page_token: config.MESSENGER_PAGE_TOKEN,
    messenger_page_id: '1428737297000917',
    messenger_link: 'https://m.me/1428737297000917',
    facebook_page_id: '1428737297000917',
    facebook_page_token: config.FACEBOOK_PAGE_TOKEN || config.MESSENGER_PAGE_TOKEN,
    ai_enabled: '1', bot_tone: 'ودود ومختصر',
  };
  const r = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload),
  });
  console.log('status:', r.status, 'result:', await r.text());
})();
