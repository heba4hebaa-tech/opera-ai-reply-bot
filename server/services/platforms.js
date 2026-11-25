'use strict';
const config = require('../config');

async function sendWhatsApp(to, text) {
  if (!config.WA_ACCESS_TOKEN || !config.WA_PHONE_NUMBER_ID) {
    return { ok: false, skipped: true, error: 'واتساب غير مُعدّ (WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID)' };
  }
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${config.WA_PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: String(text).slice(0, 4000), preview_url: false },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[WhatsApp] send failed:', res.status, JSON.stringify(data).slice(0, 400));
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.messages?.[0]?.id };
  } catch (e) {
    console.error('[WhatsApp]', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendMessenger(psid, text) {
  if (!config.MESSENGER_PAGE_TOKEN) {
    return { ok: false, skipped: true, error: 'المسنجر غير مُعدّ (MESSENGER_PAGE_TOKEN)' };
  }
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(config.MESSENGER_PAGE_TOKEN)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text: String(text).slice(0, 1900) },
        messaging_type: 'RESPONSE',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[Messenger] send failed:', res.status, JSON.stringify(data).slice(0, 400));
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.message_id };
  } catch (e) {
    console.error('[Messenger]', e.message);
    return { ok: false, error: e.message };
  }
}

async function send(platform, psid, text) {
  if (platform === 'whatsapp') return sendWhatsApp(psid, text);
  if (platform === 'messenger') return sendMessenger(psid, text);
  return { ok: false, error: 'منصة غير معروفة' };
}

module.exports = { sendWhatsApp, sendMessenger, send };
