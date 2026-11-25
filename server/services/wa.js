'use strict';
const config = require('../config');
const { getSettings } = require('../db');
const { graph } = require('./facebook');

function creds() {
  const s = getSettings();
  return { token: s.wa_access_token || config.WA_ACCESS_TOKEN, phoneId: s.wa_phone_number_id || config.WA_PHONE_NUMBER_ID };
}

async function refreshWAToken() {
  const s = getSettings();
  const token = s.wa_access_token || config.WA_ACCESS_TOKEN;
  const appSecret = config.FACEBOOK_APP_SECRET || config.META_APP_SECRET || '';
  const appId = config.FACEBOOK_APP_ID || '';
  if (!token || !appSecret || !appId) return null;
  try {
    const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const d = await res.json();
    if (d?.access_token) {
      require('../db').setSetting('wa_access_token', d.access_token);
      return d.access_token;
    }
    return null;
  } catch (e) { return null; }
}

module.exports = { creds, refreshWAToken };
