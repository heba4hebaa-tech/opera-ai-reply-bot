'use strict';
// نشر آمن مع الحفاظ على البيانات:
// 1) نسخ بيانات الإنتاج الحالية إلى data/production-backup.json
// 2) تحديث رقم البناء ثم git push (نشر تلقائي)
// 3) انتظار اكتمال النشر على الإنتاج
// 4) إعادة البيانات إلى الإنتاج والتحقق منها
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const BASE = process.env.BASE || 'https://opera-ai-reply-bot.onrender.com';
const ROOT = path.join(__dirname, '..');
const run = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

(async () => {
  console.log('1) جلب نسخة بيانات الإنتاج...');
  run('node tools/sync-data.js');

  const build = 'b' + Date.now();
  fs.writeFileSync(path.join(ROOT, 'server', 'build.js'), `module.exports = '${build}';\n`, 'utf8');
  console.log('2) رقم البناء:', build);

  run('git add -A');
  let committed = false;
  try {
    run('git -c user.name="Opera AI" -c user.email="admin@opera.local" commit -m "Deploy ' + build + ' with data sync"');
    committed = true;
  } catch { console.log('   (لا تغييرات للنشر)'); }
  if (committed) run('git push');

  console.log('3) انتظار النشر...');
  let live = false;
  for (let i = 0; i < 60; i++) {
    try {
      const h = await fetch(`${BASE}/api/health`).then(r => r.json());
      if (h.build === build) { live = true; console.log('   نشر جديد حي ✅'); break; }
    } catch {}
    await new Promise(r => setTimeout(r, 8000));
  }
  if (!live) { console.error('فشل اكتمال النشر في الوقت المحدد'); process.exit(1); }

  console.log('4) إعادة البيانات...');
  run('node tools/restore-data.js');
  console.log('✅ اكتمل النشر مع الحفاظ على البيانات');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
