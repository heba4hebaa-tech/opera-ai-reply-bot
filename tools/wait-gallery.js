'use strict';
const base = 'https://opera-ai-reply-bot.onrender.com';
(async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/store/products`);
      const d = await r.json();
      if (d.items?.length && Object.prototype.hasOwnProperty.call(d.items[0], 'images_json')) {
        console.log('gallery version live'); process.exit(0);
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('not live yet'); process.exit(1);
})();
