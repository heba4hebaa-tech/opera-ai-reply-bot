'use strict';
const { all, get, run, now, getSettings } = require('../db');
const { askAI, askImage, ruleReply, localSmartReply, stripTashkeel, close } = require('./ai');
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
  const mm = stripTashkeel(text);
  if (close(mm, ['سعر', 'اسعار', 'كم', 'price', 'بكم'])) {
    const named = all('SELECT name_ar FROM products WHERE active=1').some(p => {
      const w = stripTashkeel(p.name_ar).split(/\s+/).filter(x => x.length >= 4);
      return w.some(x => mm.includes(x));
    });
    if (!named) return 'أي منتج تود معرفة سعره؟ اختر من الخيارات أدناه وسأعطيك السعر والتفاصيل كاملة 🤍';
  }
  // الذكاء الاصطناعي هو المتحدث الأساسي دائماً — الردود المحفوظة للطوارئ فقط
  if (String(s.ai_enabled) === '1') {
    if (image?.base64) {
      const r = await askImage(text || 'عرّف على المنتج في الصورة', image.base64, image.mime);
      if (r) return r;
    }
    const ai = await askAI(text || 'الزبون أرسل صورة', history);
    if (ai) return ai;
    return localSmartReply(text || 'مساعدة', history);
  }
  if (image?.base64) return 'ما المنتج الذي أرسلته؟ 📷 اكتب اسمه أو اختر «عرض المنتجات» لأريك الكتالوج وأسعرك فوراً.';
  // وضع الردود الجاهزة يعمل فقط إذا أوقف الزبون الذكاء الاصطناعي صراحةً
  return ruleReply(text);
}

const ORDER_FIELDS = ['product', 'qty', 'name', 'phone', 'address'];
const ORDER_LABELS = {
  product: 'اسم المنتج', qty: 'الكمية', name: 'اسمك الكريم', phone: 'رقم الجوال', address: 'العنوان',
};
const ORDER_STATUS_REPLIES = {
  'جديد': 'طلبك في انتظار التأكيد البنكي أو عند الاستلام — سنبدأ التحضير فوراً 🛍️',
  'قيد التحضير': 'جارٍ تجهيز طلبك داخل مخزون المتجر 🔧',
  'تم الإرسال': 'خرج طلبك للتوصيل وسيتواصل معك الشاحن قريباً 📦',
  'تم الشحن': 'الشاحن في الطريق إليك الآن 🚚',
  'مكتمل': 'تم استلام طلبك وتوصيله بنجاح ✅ شكراً لثقتك — نتمنى أن تنال إعجابك.',
  'ملغي': 'تم إلغاء طلبك — يمكنك إعادة الطلب متى شئت 😊',
};
function handleOrderStatus(conv, text) {
  const m = stripTashkeel(text);
  if (!/(حاله|الحالة|حالة|وين|متى|تقدم|استلام|شحن|tracking)/.test(m)) return null;
  let phone = String(conv?.psid || '').replace(/\D/g, '');
  if (phone.startsWith('0') && phone.length === 10) phone = '218' + phone.slice(1);
  else if (phone.startsWith('00218')) phone = '218' + phone.slice(4);
  const cust = phone ? get('SELECT * FROM customers WHERE phone LIKE ? ORDER BY id DESC LIMIT 1', `%${phone}%`) : null;
  const cid = cust?.id || 0;
  const orders = cid
    ? all('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 3', cid)
    : (phone ? all('SELECT * FROM orders WHERE phone LIKE ? ORDER BY id DESC LIMIT 3', `%${phone}%`) : all('SELECT * FROM orders ORDER BY id DESC LIMIT 3'));
  if (!orders.length) return 'عذراً، ما لقيت لك أي طلب مسجّل 😔 — إذا أردت اطلب منتجك من خلال المتجر أو من واتساب التواصل مباشرة.';
  const o = orders[0];
  const items = JSON.parse(o.items_json || '[]');
  const last = items[items.length - 1];
  let out = `📦 طلبك رقم #${o.id}\nالحالة: ${o.status}\n${last ? `${last.name} ×${last.qty}` : ''}`.trim();
  if (ORDER_STATUS_REPLIES[o.status]) out += `\n${ORDER_STATUS_REPLIES[o.status]}`;
  out += '\nللمتابعة أو أي استفسار أكمل معاك — رقم الطلب: #' + o.id;
  return out;
}
function handleRating(conv, text) {
  const m = stripTashkeel(text);
  if (!/(قيم|تقييم|تقيّم|rating|نجم)/.test(m)) return null;
  let phone = String(conv?.psid || '').replace(/\D/g, '');
  if (phone.startsWith('0') && phone.length === 10) phone = '218' + phone.slice(1);
  else if (phone.startsWith('00218')) phone = '218' + phone.slice(4);
  const cust = phone ? get('SELECT * FROM customers WHERE phone LIKE ? ORDER BY id DESC LIMIT 1', `%${phone}%`) : null;
  const cid = cust?.id || 0;
  const orders = cid
    ? all('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 3', cid)
    : (phone ? all('SELECT * FROM orders WHERE phone LIKE ? ORDER BY id DESC LIMIT 3', `%${phone}%`) : all('SELECT * FROM orders ORDER BY id DESC LIMIT 3'));
  if (!orders.length) return 'ما لقيت لك طلباً سابقاً 😔 — بعد استلام الطلب ولتقييم تجربتك هنا.';
  const o = orders[0];
  const existing = get('SELECT * FROM reviews WHERE order_id=? AND customer_name=? ORDER BY id DESC LIMIT 1', o.id, o.customer_name);
  if (existing) return `شكراً لك 🤍 — تقييمك ${existing.rating}/٥ للطلب #${o.id} مسجّل ومُضاف للمنتج.`;
  const items = JSON.parse(o.items_json || '[]');
  const last = items[items.length - 1];
  const numM = String(text).match(/[0-9\u0660-\u0669]/);
  if (!numM) return `شكراً لك! 🌟 قيّل تجربتك — اكتب رقم تقييمك من ١ إلى ٥ (مثل: قيّم بـ ٥).`;
  let num = parseInt(numM[0], 10);
  if (numM[0].charCodeAt(0) > 57) num = String.fromCharCode(numM[0].charCodeAt(0) - 0x0660 + 0x30);
  num = Math.max(1, Math.min(5, num));
  run('INSERT INTO reviews (product_id, order_id, customer_name, phone, rating, text, created_at) VALUES (?,?,?,?,?,?,?)', Number(last?.id) || 0, o.id, o.customer_name, o.phone, num, String(text).slice(0, 300), now());
  return `شكراً لأنك قيّمتنا! 🌟 تم تسجيل تقييمك ${num}/٥ للمنتج — نتمنى أن تنال إعجابك ونحن نجهّز لك كل ما يلزم.`;
}
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
  if (step === 'qty') {
    const prods = all('SELECT id, name_ar, price, stock FROM products WHERE active=1');
    const wds = stripTashkeel(data.product).split(/\s+/).filter(w => w.length >= 3);
    const scored = prods.map(x => ({ x, sc: wds.reduce((s, w) => s + (stripTashkeel(x.name_ar).includes(w) ? w.length : 0), 0) })).sort((a, b) => b.sc - a.sc);
    const prod = scored[0]?.sc ? scored[0].x : null;
    if (prod && prod.stock > 0 && Number(value) > prod.stock) return `الكمية المطلوبة أكبر من المخزون المتوفر (المتوفر: ${prod.stock}) 😔 جرّب بكرة أو اختر منتجاً آخر.`;
  }
  if (step === 'phone' && value.replace(/\D/g, '').length < 8) return 'رقم الجوال غير صالح — اكتبه مع رمز الدولة 🙏';
  data[step] = value;
  const idx = ORDER_FIELDS.indexOf(step);
  const next = ORDER_FIELDS[idx + 1];
  if (next) {
    run('UPDATE order_drafts SET step=?, data_json=?, updated_at=? WHERE conversation_id=?', next, JSON.stringify(data), now(), conv.id);
    return `تم ✔️ ${ORDER_LABELS[step]}: ${value}\n` + orderQuestion(next);
  }
  const products = all('SELECT id, name_ar, price, category_id FROM products WHERE active=1');
  const words = stripTashkeel(data.product).split(/\s+/).filter(w => w.length >= 3);
  const scored = products.map(x => {
    const n = stripTashkeel(x.name_ar);
    return { p: x, score: words.reduce((s, w) => s + (n.includes(w) ? w.length : 0), 0) };
  }).sort((a, b) => b.score - a.score);
  const p = scored[0]?.score ? scored[0].p : { id: 0, name_ar: data.product, price: 0 };
  const qty = Math.min(99, Math.max(1, Number(data.qty) || 1));
  const info = run(`INSERT INTO orders (customer_name, phone, address, notes, items_json, total, status, source, created_at, customer_id, psid, paid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, data.name, data.phone, data.address, `طلب من ${conv.platform}`,
    JSON.stringify([{ id: p.id, name: p.name_ar, price: p.price, qty, options: '', category: p.category_id }]),
    p.price * qty, 'جديد', conv.platform === 'whatsapp' ? 'واتساب' : 'مسنجر', now(), 0, String(conv.psid || conv.id), 0);
  if (p.id) run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', qty, p.id);
  run('DELETE FROM order_drafts WHERE conversation_id = ?', conv.id);
  const cur = getSettings().currency || '';
  const pay = getSettings();
  const payText = [
    pay.payment_methods ? `💳 طرق الدفع: ${pay.payment_methods}` : '',
    pay.bank_info ? `🏦 الحساب البنكي: ${pay.bank_info}` : '',
    pay.delivery_note ? `🚚 ${pay.delivery_note}` : '',
  ].filter(Boolean).join('\n');
  return `تم استلام طلبك بنجاح 🎉\nرقم الطلب: #${Number(info.lastInsertRowid)}\n${p.name_ar} × ${qty} = ${Number(p.price * qty).toLocaleString('ar-SA')} ${cur}\nسيتم التواصل معك على ${data.phone} لتأكيد العنوان: ${data.address}\n${payText}\nشكراً لثقتك 🤍`;
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
  const statusReplyText = handleOrderStatus(conv, text);
  const ratingReply = handleRating(conv, text);
  const reply = statusReplyText || flowReply || ratingReply || await generateReply(text, history.slice(0, -1), image);
  run('INSERT INTO messages (conversation_id, direction, text, external_id, created_at) VALUES (?,?,?,?,?)', conv.id, 'out', reply, '', now());
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), conv.id);

  let sent = { ok: true, skipped: !sendReply };
  if (sendReply) {
    sent = await platforms.send(platform, psid, reply);
    let buttons = ['عرض المنتجات', 'أريد الطلب', 'مساعدة'];
    if (close(stripTashkeel(text), ['سعر', 'اسعار', 'كم', 'price', 'بكم'])) {
      const names = all('SELECT name_ar FROM products WHERE active=1 ORDER BY id DESC LIMIT 3').map(x => x.name_ar);
      if (names.length) buttons = names;
    }
    const opts = await platforms.sendOptions(platform, psid, 'اختر من الخيارات:', buttons);
    console.log(`[Options] ${platform} ${buttons.join(' | ')} -> ${JSON.stringify(opts)}`);
  }
  // ترحيب عند أول لقاء (مرة واحدة لكل محادثة)
  if (String(getSettings().ai_enabled) !== '1' && all('SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND direction = ?', conv.id, 'out').n === 1) {
    const settings = getSettings();
    const welcome = String(settings.greeting || '').replace('{business}', settings.business_name || 'متجرنا');
    if (welcome) await platforms.send(platform, psid, welcome);
  }
  return { reply, sent, conversationId: conv.id };
}

module.exports = { handleIncoming, generateReply };
