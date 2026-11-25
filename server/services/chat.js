'use strict';
const { all, get, run, now, getSettings } = require('../db');
const { askAI, askImage, ruleReply, stripTashkeel } = require('./ai');
const { catalogText, priceListText } = require('./catalog');
const platforms = require('./platforms');

function exactCommand(text) {
  const t = stripTashkeel(text).replace(/[?!.،؟]/g, '').replace(/\s+/g, ' ');
  if (/^(المنتجات|منتجات|عرض المنتجات|اعرض المنتجات|كتالوج|الكتالوج|الاصناف|الأصناف|catalog|products)$/.test(t)) return catalogText();
  if (/^(الاسعار|اسعار|السعر|السعر؟|كم السعر|price|prices|بكم|كم السعر؟)$/.test(t)) return null;
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
  const s = getSettings();
  // الذكاء الاصطناعي هو المتحدث الأساسي دائماً — الردود المحفوظة للطوارئ فقط
  if (String(s.ai_enabled) === '1') {
    if (image?.base64) {
      const r = await askImage(text || 'عرّف على المنتج في الصورة', image.base64, image.mime);
      if (r) return r;
    }
    const ai = await askAI(text || 'الزبون أرسل صورة', history);
    if (ai) return ai;
  }
  if (image?.base64) return 'ما المنتج الذي أرسلته؟ 📷 اكتب اسمه أو اختر «عرض المنتجات» لأريك الكتالوج وأسعرك فوراً.';
  const cmd = exactCommand(text);
  if (cmd) return cmd;
  return ruleReply(text);
}

const ORDER_FIELDS = ['product', 'qty', 'name', 'phone', 'address'];
const ORDER_LABELS = {
  product: 'اسم المنتج', qty: 'الكمية', name: 'اسمك الكريم', phone: 'رقم الجوال', address: 'العنوان',
};
function orderQuestion(next) {
  const n = ORDER_FIELDS.indexOf(next) + 1;
  const tips = {
    product: 'اكتب اسم المنتج (أو اختر «عرض المنتجات» ثم ارجع)، مثال: قميص تجريبي',
    qty: 'كم القطعة تريد؟ (رقم فقط)',
    name: 'اكتب اسمك الكريم',
    phone: 'اكتب رقم جوالك مع رمز الدولة، مثال: 218945343522',
    address: 'اكتب عنوان التسليم (المدينة + الشارع)',
  };
  return `تمام، خلينا نجهّز طلبك بسرعة 🛒\n${n}/5) ${tips[next]}\n(للإلغاء اكتب «إلغاء»)`;
}
function handleOrderDraft(conv, text) {
  const normalized = stripTashkeel(text).replace(/[!?.،؟]/g, '').replace(/\s+/g, ' ');
  let draft = get('SELECT * FROM order_drafts WHERE conversation_id = ?', conv.id);
  if (!draft) {
    if (/^(أريد الطلب|اريد الطلب|طلب|الطلب|order|OPT_1)$/.test(normalized)) {
      run('INSERT INTO order_drafts (conversation_id, step, data_json, updated_at) VALUES (?,?,?,?)', conv.id, 'product', '{}', now());
      return orderQuestion('product');
    }
    return null;
  }
  if (/^(إلغاء|الغاء|cancel)$/.test(normalized)) {
    run('DELETE FROM order_drafts WHERE conversation_id = ?', conv.id);
    return 'تم إلغاء الطلب 👍 لا مشكلة، أنا هنا لو احتجت أي شيء.';
  }
  let data;
  try { data = JSON.parse(draft.data_json || '{}'); } catch { data = {}; }
  const step = draft.step;
  const value = String(text).trim().slice(0, 200);
  if (step === 'qty' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 99)) return 'الكمية لازم تكون رقم بين ١ و٩٩ 🙏';
  if (step === 'phone' && value.replace(/\D/g, '').length < 8) return 'رقم الجوال غير صالح — اكتبه مع رمز الدولة 🙏';
  data[step] = value;
  const idx = ORDER_FIELDS.indexOf(step);
  const next = ORDER_FIELDS[idx + 1];
  if (next) {
    run('UPDATE order_drafts SET step=?, data_json=?, updated_at=? WHERE conversation_id=?', next, JSON.stringify(data), now(), conv.id);
    return `تم ✔️ ${ORDER_LABELS[step]}: ${value}\n` + orderQuestion(next);
  }
  const products = all('SELECT id, name_ar, price FROM products WHERE active=1');
  const words = stripTashkeel(data.product).split(/\s+/).filter(w => w.length >= 3);
  const p = products.find(x => words.some(w => stripTashkeel(x.name_ar).includes(w))) || { id: 0, name_ar: data.product, price: 0 };
  const qty = Math.min(99, Math.max(1, Number(data.qty) || 1));
  const info = run(`INSERT INTO orders (customer_name, phone, address, notes, items_json, total, status, source, created_at, customer_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, data.name, data.phone, data.address, `طلب من ${conv.platform}`,
    JSON.stringify([{ id: p.id, name: p.name_ar, price: p.price, qty, options: '' }]),
    p.price * qty, 'جديد', conv.platform === 'whatsapp' ? 'واتساب' : 'مسنجر', now(), 0);
  run('DELETE FROM order_drafts WHERE conversation_id = ?', conv.id);
  const cur = getSettings().currency || '';
  return `تم استلام طلبك بنجاح 🎉\nرقم الطلب: #${Number(info.lastInsertRowid)}\n${p.name_ar} × ${qty} = ${Number(p.price * qty).toLocaleString('ar-SA')} ${cur}\nسيتم التواصل معك على ${data.phone} لتأكيد العنوان: ${data.address}\nشكراً لثقتك 🤍`;
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
  const flowReply = handleOrderDraft(conv, text);
  const reply = flowReply || await generateReply(text, history.slice(0, -1), image);
  run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)', conv.id, 'out', reply, '', now());
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), conv.id);

  let sent = { ok: true, skipped: !sendReply };
  if (sendReply) {
    sent = await platforms.send(platform, psid, reply);
    if (all('SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND direction = ?', conv.id, 'out').n <= 1) {
      await platforms.sendOptions(platform, psid, 'اختر ما تريد:', ['عرض المنتجات', 'أريد الطلب', 'مساعدة']);
    }
  }
  // ترحيب عند أول لقاء (مرة واحدة لكل محادثة)
  if (all('SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND direction = ?', conv.id, 'out').n === 1) {
    const settings = getSettings();
    const welcome = String(settings.greeting || '').replace('{business}', settings.business_name || 'متجرنا');
    if (welcome) await platforms.send(platform, psid, welcome);
  }
  return { reply, sent, conversationId: conv.id };
}

module.exports = { handleIncoming, generateReply };
