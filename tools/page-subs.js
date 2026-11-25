'use strict';
const config = require('../server/config');
const { getSettings } = require('../server/db');
const s = getSettings();
const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN;
const page = '1428737297000917';
(async () => {
  const u = `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${page}/subscriptions?fields=feed,messages,messaging_postbacks&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(u);
  console.log(r.status, (await r.text()).slice(0, 800));
})();
