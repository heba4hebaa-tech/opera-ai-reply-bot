'use strict';
const config = require('../config');
const { getSettings, setSetting } = require('../db');
const { refreshWAToken } = require('./wa');

function credentials() {
  const s = getSettings();
  return {
    token: s.wa_access_token || config.WA_ACCESS_TOKEN,
    phoneId: s.wa_phone_number_id || config.WA_PHONE_NUMBER_ID,
  };
}

async function sendWhatsApp(to, text) {
  const { token, phoneId } = credentials();
  if (!phoneId) {
    return { ok: false, skipped: true, error: 'واتساب غير مُعدّ — أضف Phone Number ID' };
  }
  let useToken = token;
  try { if (!useToken) useToken = await refreshWAToken(); } catch {}
  if (!useToken) {
    return { ok: false, error: 'توكن واتساب مفقود أو منتهي — استخدم API Explorer أو قدم System User Token في الإعدادات' };
  }
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${phoneId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${useToken}`, 'Content-Type': 'application/json' },
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
  const s = getSettings();
  const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token;
  if (!token) {
    return { ok: false, skipped: true, error: 'المسنجر غير مُعدّ — أضف Page Token من الإعدادات' };
  }
  try {
    const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(token)}`;
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

module.exports = { sendWhatsApp, sendMessenger, send, credentials };
