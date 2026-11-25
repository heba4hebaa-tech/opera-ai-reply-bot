'use strict';
const { all, getSettings } = require('../db');

function money(n) {
  const s = getSettings();
  return `${Number(n || 0).toLocaleString('ar-SA')} ${s.currency || ''}`.trim();
}

function productsForPrompt(limit = 40) {
  return all(`SELECT p.id, p.name_ar, p.name_en, p.description, p.price, p.old_price, p.stock, p.colors_json, p.sizes_json,
                     c.name_ar AS category
              FROM products p LEFT JOIN categories c ON c.id = p.category_id
              WHERE p.active = 1 ORDER BY p.id DESC LIMIT ?`, limit);
}

function catalogText(limit = 12) {
  const rows = productsForPrompt(limit);
  const s = getSettings();
  if (!rows.length) return 'لا توجد منتجات متاحة حالياً.';
  let text = `🛍️ كتالوج ${s.business_name || 'متجرنا'}:\n\n`;
  rows.forEach((p, i) => {
    text += `${i + 1}. ${p.name_ar}${p.category ? ` (${p.category})` : ''} — ${money(p.price)}${p.old_price ? ` (كان ${money(p.old_price)})` : ''}\n`;
  });
  const link = s.catalog_url ? `\nرابط الكتالوج الكامل: ${s.catalog_url}` : '';
  return text + `${link}\n\nاكتب اسم المنتج أو "أريد الطلب" للمتابعة.`;
}

function priceListText() {
  const rows = productsForPrompt(15);
  if (!rows.length) return 'الأسعار غير متاحة حالياً.';
  return `💰 الأسعار:\n\n` + rows.map(p => `• ${p.name_ar}: ${money(p.price)}`).join('\n');
}

function buildKnowledge() {
  const s = getSettings();
  const cats = all('SELECT name_ar, description FROM categories WHERE active = 1 ORDER BY sort_order, id');
  const products = productsForPrompt(40);
  const faqs = all('SELECT question, answer FROM faqs WHERE active = 1 ORDER BY id LIMIT 30');
  const lines = [];
  lines.push(`اسم المتجر: ${s.business_name || 'متجر'}`);
  lines.push(`العملة: ${s.currency || 'ر.س'}`);
  if (s.whatsapp_number) lines.push(`رقم واتساب المتجر: ${s.whatsapp_number}`);
  if (s.catalog_url) lines.push(`رابط الكتالوج: ${s.catalog_url}`);
  if (s.business_hours) lines.push(`ساعات العمل: ${s.business_hours}`);
  if (s.return_policy) lines.push(`سياسة الإرجاع أو الاستبدال: ${s.return_policy}`);
  lines.push(`طريقة الرد المطلوبة: ${s.bot_tone || 'ودود ومختصر'}`);
  if (s.greeting) lines.push(`رسالة الترحيب التي يفضلها المتجر: ${s.greeting.replace('{business}', s.business_name || 'متجرنا')}`);
  lines.push('\nالأصناف: ' + (cats.map(c => c.name_ar).join('، ') || 'لا يوجد'));
  lines.push('\nالمنتجات والأسعار (استخدمها حرفياً ولا تخترع أسعاراً):');
  const parse = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  lines.push(products.map(p => {
    const colors = parse(p.colors_json), sizes = parse(p.sizes_json);
    return `- ${p.name_ar} | ${p.category || 'عام'} | ${money(p.price)}${p.old_price ? ` | قبل: ${money(p.old_price)}` : ''}${p.stock <= 0 ? ' | نفد المخزون' : ''} | ${p.description || ''}${colors.length ? ` | الألوان: ${colors.join('، ')}` : ''}${sizes.length ? ` | المقاسات: ${sizes.join('، ')}` : ''}`;
  }).join('\n') || '- لا توجد منتجات');
  lines.push('\nأسئلة شائعة وإجاباتها المعتمدة:');
  lines.push(faqs.map(f => `س: ${f.question}\nج: ${f.answer}`).join('\n') || '- لا توجد');
  return lines.join('\n');
}

module.exports = { money, catalogText, priceListText, buildKnowledge, productsForPrompt };
