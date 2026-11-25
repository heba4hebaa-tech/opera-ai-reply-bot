'use strict';
const config = require('../config');
const { getSettings } = require('../db');

function creds() {
  const s = getSettings();
  return {
    token: s.facebook_page_token || config.FACEBOOK_PAGE_TOKEN || '',
    pageId: s.facebook_page_id || config.FACEBOOK_PAGE_ID || '',
  };
}

async function graph(path, params, method = 'POST', tokenOverride) {
  const token = tokenOverride || creds().token;
  if (!token) throw new Error('Facebook token غير مضبوط');
  const body = new URLSearchParams({ ...params, access_token: token });
  const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${path}`;
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    body: method === 'POST' ? body : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) { const e = data.error; throw new Error(e?.message || `HTTP ${res.status}`); }
  return data;
}

async function sendPagePost(message) {
  const { pageId } = creds();
  if (!pageId) throw new Error('Facebook page ID غير مضبوط');
  return graph(`${pageId}/posts`, { message });
}

async function replyPost(postId, message) {
  return graph(`${postId}/comments`, { message, private: 0 });
}

async function replyComment(commentId, message) {
  return graph(`${commentId}/replies`, { message });
}

module.exports = { creds, sendPagePost, replyPost, replyComment, graph };
