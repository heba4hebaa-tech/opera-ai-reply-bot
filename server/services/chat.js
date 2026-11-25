'use strict';
const { all, get, run, now, getSettings } = require('../db');
const { askAI, askImage, ruleReply, stripTashkeel } = require('./ai');
const { catalogText, priceListText } = require('./catalog');
const platforms = require('./platforms');

function exactCommand(text) {
  const t = stripTashkeel(text).replace(/[?!.،؟]/g, '').replace(/\s+/g, ' ');
  if (/^(المنتجات|منتجات|عرض المنتجات|اعرض المنتجات|كتالوج|الكتالوج|الاصناف|الأصناف|catalog|products)$/.test(t)) return catalogText();
  if (/^(الاسعار|اسعار|السعر|السعر؟|كم السعر|price|prices|بكم|كم السعر؟)$/.test(t)) {
    return `ما المنتج الذي تريد معرفة سعره؟ 🏷️\nاكتب اسمه أو أرسل صورته وسأرد عليك بالسعر والخيارات.\nأو اكتب «عرض المنتجات» لرؤية الكتالوج كاملاً.`;
  }
  if (/^(مساعدة|المساعده|help|الاوامر|القائمة|قائمة)$/.test(t)) {
    return `أقدر أساعدك في:\n• عرض المنتجات والأسعار\n• التوصيل والدفع\n• تقديم طلب\n• أي استفسار آخر\n\nاكتب سؤالك مباشرة 👇`;
  }
  if (/^(طلب|اطلب|اريد الطلب|طلبت|order)$/.test(t)) {
    const s = getSettings();
    return `يسعدني مساعدتك في الطلب 🛒\nاكتب لي: اسم المنتج + الكمية + اسمك + رقم الجوال + العنوان.\nأو اطلب من المتجر مباشرة${s.catalog_url ? `:\n${s.catalog_url}` : '.'}`;
  }
  return null;
}

async function generateReply(text, history, image) {
  if (image?.base64) {
    const r = await askImage(text || 'عرّف على المنتج في الصورة', image.base64, image.mime);
    if (r) return r;
    return 'ما المنتج الذي أرسلته؟ 📷 اكتب اسمه أو اختر «عرض المنتجات» لأريك الكتالوج وأسعرك فوراً.';
  }
  const cmd = exactCommand(text);
  if (cmd) return cmd;
  const s = getSettings();
  if (String(s.ai_enabled) === '1') {
    const ai = await askAI(text, history);
    if (ai) return ai;
  }
  return ruleReply(text);
}

async function handleIncoming({ platform, psid, name = '', text = '', externalId = '' , sendReply = true, image = null }) {
  text = String(text || '').trim();
  if (!psid || !text) return null;
  if (externalId && get('SELECT id FROM messages WHERE external_id = ? LIMIT 1', externalId)) return null;

  let conv = get('SELECT * FROM conversations WHERE platform = ? AND psid = ?', platform, psid);
  if (!conv) {
    run('INSERT INTO conversations (platform, psid, name, created_at, updated_at) VALUES (?,?,?,?,?)', platform, psid, name, now(), now());
    conv = get('SELECT * FROM conversations WHERE platform = ? AND psid = ?', platform, psid);
  } else if (name && name !== conv.name) {
    run('UPDATE conversations SET name = ? WHERE id = ?', name, conv.id);
  }
  run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)', conv.id, 'in', text, externalId, now());

  const history = all('SELECT direction, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 8', conv.id).reverse();
  const reply = await generateReply(text, history.slice(0, -1), image);
  run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)', conv.id, 'out', reply, '', now());
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), conv.id);

  let sent = { ok: true, skipped: !sendReply };
  if (sendReply) sent = await platforms.send(platform, psid, reply);
  // ترحيب عند أول لقاء (مرة واحدة لكل محادثة)
  if (all('SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND direction = ?', conv.id, 'out').n === 1) {
    const settings = getSettings();
    const welcome = String(settings.greeting || '').replace('{business}', settings.business_name || 'متجرنا');
    if (welcome) await platforms.send(platform, psid, welcome);
  }
  return { reply, sent, conversationId: conv.id };
}

module.exports = { handleIncoming, generateReply };
