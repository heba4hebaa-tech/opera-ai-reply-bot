'use strict';
// استطلاع دوري لمحادثات صفحة فيسبوك عبر Page Access Token.
// يعمل كبديل موثوق عندما لا تصل أحداث Webhook من Meta (إعدادات التطبيق/وضع التطوير).
const { all, get, run, now, getSettings } = require('../db');
const { handleIncoming } = require('./chat');
const config = require('../config');

const INTERVAL_MS = 20000;
let timer = null;
let running = false;
let lastRun = null;
let firstStart = null;
// نبدأ بنافذة 5 دقائق فقط حتى لا نرد على رسائل قديمة عند أول إقلاع
let lastSeenEpoch = Math.floor(Date.now() / 1000) - 300;
const stats = { runs: 0, messages: 0, errors: 0 };

function creds() {
  const s = getSettings();
  const token = s.messenger_page_token || config.MESSENGER_PAGE_TOKEN || s.facebook_page_token || '';
  const pageId = s.messenger_page_id || s.facebook_page_id || config.FACEBOOK_PAGE_ID || '';
  return { token, pageId };
}

async function graph(path, token) {
  const url = `https://graph.facebook.com/${config.GRAPH_API_VERSION}${path}`;
  const r = await fetch(`${url}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data?.error?.message || `Graph HTTP ${r.status}`);
  return data;
}

async function poll() {
  const { token, pageId } = creds();
  if (!token || !pageId || running) return;
  running = true;
  try {
    const convs = await graph(`/${pageId}/conversations?fields=id,updated_time,participants&limit=20`, token);
    for (const c of (convs.data || [])) {
      let msgs;
      try {
        msgs = await graph(`/${c.id}/messages?fields=id,from,to,message,created_time&limit=15`, token);
      } catch (e) { stats.errors++; continue; }
      for (const m of (msgs.data || [])) {
        const epoch = Math.floor(new Date(m.created_time || 0).getTime() / 1000);
        if (epoch < lastSeenEpoch - 60) continue;
        const fromId = String(m.from?.id || '');
        if (!fromId || fromId === String(pageId)) continue; // تجاهل رسائل الصفحة (الصادرة)
        const text = String(m.message || '').trim();
        if (!text) continue;
        const externalId = String(m.id || '');
        if (!externalId) continue;
        if (get('SELECT id FROM messages WHERE external_id = ? LIMIT 1', externalId)) continue;
        // حماية إضافية: إن كان Webhook قد عالج نفس الرسالة بمعرّف مختلف، لا نرد مرتين
        const twoMinAgo = new Date(Date.now() - 120000).toISOString();
        const dup = get(`SELECT 1 FROM messages WHERE direction = 'in' AND text = ? AND created_at >= ? AND conversation_id IN
          (SELECT id FROM conversations WHERE platform = 'messenger' AND psid = ?) LIMIT 1`, text, twoMinAgo, fromId);
        if (dup) continue;
        stats.messages++;
        // تسجيل حدث يشبه حدث Webhook ليظهر في لوحة التشخيص
        try {
          run('INSERT INTO webhook_events (platform, payload, created_at) VALUES (?,?,?)',
            'poll', JSON.stringify({ object: 'poll', entry: [{ messaging: [{ sender: { id: fromId }, message: { text } }] }] }).slice(0, 20000), now());
        } catch {}
        handleIncoming({ platform: 'messenger', psid: fromId, name: String(m.from?.name || ''), text, externalId })
          .catch(e => { stats.errors++; console.error('[poller] handler error:', e.message); });
      }
    }
    lastSeenEpoch = Math.floor(Date.now() / 1000);
    lastRun = now();
    stats.runs++;
  } catch (e) {
    stats.errors++;
    console.error('[poller]', e.message);
  } finally { running = false; }
}

function start() {
  if (timer) return;
  const { token, pageId } = creds();
  if (!token || !pageId) {
    // الإعدادات قد تُستعاد بعد الإقلاع (قاعدة Render مؤقتة) — نعيد المحاولة
    setTimeout(() => { if (!timer) start(); }, 10000).unref?.();
    return;
  }
  firstStart = now();
  poll();
  timer = setInterval(poll, INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log('[poller] ✅ استطلاع محادثات المسنجر مفعّل كل 20 ثانية');
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }
function status() {
  return { enabled: !!timer, intervalMs: INTERVAL_MS, lastRun, startedAt: firstStart, ...stats, creds: !!creds().token && !!creds().pageId };
}

module.exports = { start, stop, poll, status };
