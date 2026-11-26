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

async function sendMessenger(psid, text, messagingType = 'RESPONSE') {
  const s = getSettings();
  const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token;
  if (!token) {
    return { ok: false, skipped: true, error: 'المسنجر غير مُعدّ — أضف Page Token من الإعدادات' };
  }
  const psidStr = String(psid || '');
  if (!psidStr) return { ok: false, error: 'PSID ناقص — لا يمكن إرسال الرسالة' };
  // إرسال عبر مسار الصفحة المحدد (page-scoped) إن وُجد، وإلا عبر /me (صفحة token)
  const pageId = s.messenger_page_id || s.facebook_page_id || '';
  const endpoint = pageId ? `${pageId}/messages` : 'me/messages';
  const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${endpoint}?access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psidStr },
        messaging_type: messagingType,
        message: { text: String(text).slice(0, 1900) },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      console.error('[Messenger] send failed:', res.status, JSON.stringify(data).slice(0, 600));
      return { ok: false, error: errMsg, fullError: data };
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

async function sendOptions(platform, to, text, buttons = ['عرض المنتجات', 'أريد الطلب', 'مساعدة']) {
  if (platform === 'whatsapp') {
    const { token, phoneId } = credentials();
    if (!token || !phoneId) return { ok: false };
    try {
      const res = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'interactive', interactive: {
          type: 'button', body: { text: String(text).slice(0, 180) },
          action: { buttons: buttons.slice(0, 3).map((b, i) => ({ type: 'reply', reply: { id: `OPT_${i}`, title: b.slice(0, 18) } })) },
        } }),
        signal: AbortSignal.timeout(15000),
      });
      return { ok: res.ok };
    } catch { return { ok: false }; }
  }
  if (platform === 'messenger') {
    const s = getSettings();
    const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token;
    if (!token) return { ok: false, error: 'المسنجر غير مُعدّ' };
    const pageId = s.messenger_page_id || s.facebook_page_id || '';
    const endpoint = pageId ? `${pageId}/messages` : 'me/messages';
    try {
      const res = await fetch(`https://graph.facebook.com/${config.GRAPH_API_VERSION}/${endpoint}?access_token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: String(to) }, messaging_type: 'RESPONSE', message: {
          text: String(text).slice(0, 180),
          quick_replies: buttons.slice(0, 3).map(b => ({ content_type: 'text', title: b.slice(0, 20), payload: String(b).slice(0, 24) })),
        } }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      return { ok: true, id: data.message_id };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: false };
}

module.exports = { sendWhatsApp, sendMessenger, send, sendOptions, credentials };
