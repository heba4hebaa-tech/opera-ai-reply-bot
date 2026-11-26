'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const titles = {
    overview: 'نظرة عامة', categories: 'الأصناف', products: 'المنتجات', orders: 'الطلبات',
    conversations: 'المحادثات', customers: 'الزبائن والتحقق', faqs: 'الأسئلة الشائعة', ads: 'الإعلانات', replies: 'ردود مخصصة', notifications: 'التنبيهات', tester: 'اختبار الرد', settings: 'الإعدادات', system: 'حالة النظام', security: 'كلمة المرور',
  };
  const state = { me: null, categories: [], products: [] };
  const statusClass = s => ({ 'جديد': 'warn', 'قيد التحضير': 'ok', 'تم الشحن': '', 'مكتمل': 'ok', 'ملغي': 'bad' }[s] || '');

  const splitOpts = v => String(v || '').split(/[،,]/).map(x => x.trim()).filter(Boolean);
  const parseOpts = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const parseJsonSafe = (v, fallback) => { try { const d = JSON.parse(v || ''); return d ?? fallback; } catch { return fallback; } };

  async function uploadFile(file) {
    const res = await fetch('/api/admin/upload', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'image/png', 'X-File-Name': file.name },
      body: file,
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'فشل الرفع');
    return d.url;
  }
  function bindUpload(inputId, targetId, previewId) {
    const input = $(inputId);
    if (!input) return;
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      toast('جارٍ رفع الصورة...');
      try {
        const url = await uploadFile(file);
        $(targetId).value = url;
        if ($(previewId)) $(previewId).innerHTML = `<img src="${url}" style="max-width:100%;max-height:110px;border-radius:10px;">`;
        toast('تم الرفع ✓');
      } catch (e) { toast(e.message, true); }
    };
  }

  async function boot() {
    const me = await api('/api/auth/me');
    if (!me.user) { location.href = '/login'; return; }
    state.me = me.user;
    wireNav();
    await Promise.all([loadOverview(), loadCategories(), loadProducts(), loadOrders(), loadConversations(), loadCustomers(), loadFaqs(), loadSettings(), loadAds(), loadReplies(), loadNotifications(), loadPostRules()]);
  }

  let sysTimer = null;
  function wireNav() {
    document.querySelectorAll('.nav-item[data-section]').forEach(b => b.onclick = () => {
      document.querySelectorAll('.nav-item[data-section]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const key = b.dataset.section;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      $('sec-' + key).classList.add('active');
      $('topTitle').textContent = titles[key] || '';
      if (key === 'system') { loadSystemStatus(); if (!sysTimer) sysTimer = setInterval(loadSystemStatus, 12000); }
      else if (sysTimer) { clearInterval(sysTimer); sysTimer = null; }
    });
    $('logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; };
    const sr = $('sysRefresh'); if (sr) sr.onclick = () => loadSystemStatus();
    const sp = $('sysRunPoller');
    if (sp) sp.onclick = async () => { await api('/api/admin/poller/run', { method: 'POST', body: {} }); await loadSystemStatus(); toast('تم فحص المحادثات ✓'); };
  }

  const chip = (ok, label) => `<span style="display:inline-block;padding:3px 10px;border-radius:999px;margin:2px 4px 2px 0;font-size:12px;background:${ok ? '#e6f7ee' : '#fdeaea'};color:${ok ? '#127c47' : '#c0392b'};">${ok ? '✅' : '❌'} ${label}</span>`;
  async function loadSystemStatus() {
    const r = await api('/api/admin/system-status');
    if (!r || r.error || !r.services) return;
    const s = r.services, sec = r.security, d = r.data;
    $('sysSummary').innerHTML =
      chip(true, 'الخادم يعمل') + chip(s.database, 'قاعدة البيانات') + chip(s.messengerToken, 'توكن مسنجر') +
      chip(!!s.pageId, 'صفحة فيسبوك') + chip(s.whatsapp, 'واتساب') + chip(s.gemini, 'Gemini AI') +
      chip(s.poller, 'الاستطلاع التلقائي') + chip(!!s.webhookLastInbound, 'استقبال رسائل') +
      chip(sec.passwordChanged, 'كلمة مرور مغيّرة');
    $('sysServices').textContent = [
      `الخادم: يعمل ✅ — البناء ${r.build}`,
      `مدة التشغيل: ${Math.floor(r.uptimeSec / 60)} دقيقة`,
      `قاعدة البيانات: ${s.database ? 'متصلة ✅' : 'معطلة ❌'}`,
      `مسنجر: ${s.messengerToken ? 'توكن موجود ✅' : 'بدون توكن ❌'} — الصفحة ${s.pageId || 'غير معروفة'}`,
      `واتساب: ${s.whatsapp ? 'مفعّل ✅' : 'يحتاج توكن جديد ❌'}${s.whatsappNumber ? ' (' + s.whatsappNumber + ')' : ''}`,
      `Gemini AI: ${s.gemini ? 'مفعّل ✅' : 'غير مُعدّ (رد محلي)'}`,
      `الاستطلاع: ${s.poller ? 'يعمل كل 20 ثانية ✅' : 'متوقف ❌'} — رسائل مستلمة: ${s.pollerStats?.messages ?? 0}، أخطاء: ${s.pollerStats?.errors ?? 0}`,
    ].join('\n');
    $('sysSecurity').textContent = [
      `كلمة مرور الأدمن: ${sec.passwordChanged ? 'مغيّرة عن الافتراضية ✅' : 'ما زالت الافتراضية admin123 ⚠️ — غيّرها فوراً من قسم كلمة المرور'}`,
      `جلسة الدخول: ${sec.sessionCookie} ✅`,
      `حماية من التخمين: ${sec.loginLock} ✅`,
      `توقيع Meta Webhook: ${sec.signatureCheck ? 'مفعّل ✅' : 'غير مفعّل (META_APP_SECRET غير مضبوط) — استقبال يعمل لكن التوقيع غير متحقق'}`,
      `ترويسات الأمان: مفعّلة ✅ (nosniff, frame-options, HSTS, referrer)`,
    ].join('\n');
    $('sysData').textContent = [
      `الأصناف: ${d.categories} · المنتجات: ${d.products}`,
      `الطلبات: ${d.orders} · المحادثات: ${d.conversations} · الرسائل: ${d.messages}`,
      `الأسئلة الشائعة: ${d.faqs}`,
      `العملة: ${r.currency}`,
      `النسخ الاحتياطي: يُحفظ تلقائياً قبل كل نشر (data/production-backup.json) ✅`,
    ].join('\n');
    $('sysActivity').textContent = [
      `آخر رسالة واردة: ${s.webhookLastInbound ? s.webhookLastInbound.at + '\n  «' + s.webhookLastInbound.text + '» (من: ' + (s.webhookLastInbound.source === 'poll' ? 'استطلاع' : 'Webhook') + ')' : 'لا توجد بعد'}`,
      `آخر تحقق من Meta: ${s.webhookLastVerify || 'لم يُسجّل بعد'}`,
      `الاستطلاع: ${s.pollerStats?.enabled ? 'مفعّل ✅' : 'متوقف ❌'} — آخر فحص: ${s.pollerStats?.lastRun || '—'}`,
    ].join('\n');
    $('sysHint').textContent = (r.hint || '') + (sec.defaultPasswordActive ? ' ⚠️ غيّر كلمة المرور الافتراضية الآن.' : '');
  }

  async function loadOverview() {
    const d = await api('/api/admin/dashboard');
    const icons = [
      ['🧾', 'إجمالي الطلبات', d.stats.orders, 'جديد: ' + d.stats.newOrders],
      ['📦', 'المنتجات', d.stats.products, 'متاحة للبيع'],
      ['🗂️', 'الأصناف', d.stats.categories, 'تصنيفات المتجر'],
      ['💬', 'المحادثات', d.stats.conversations, d.stats.messages + ' رسالة'],
      ['👥', 'الزبائن', d.stats.customers ?? 0, 'مسجّلون برقم الجوال'],
    ];
    const extra = [
      ['💰', 'إجمالي المبيعات', money(d.stats.revenue, ''), 'طلبات مدفوعة: ' + (d.stats.paidOrders ?? 0)],
      ['🚚', 'طلبات مسلّمة', String(d.stats.delivered ?? 0), ''],
      ['🧾', 'متوسط قيمة الطلب', money(d.stats.avgOrder, ''), ''],
      ['🏷️', 'أعلى صنف مبيعات', d.stats.topCategory ? `${d.stats.topCategory[0]} — ${money(d.stats.topCategory[1]?.revenue, '')}` : '—', ''],
      ['🔁', 'عملاء متكررون', String(d.stats.repeatCustomersCount ?? 0), ''],
    ];
    $('statGrid').innerHTML = icons.map(i => `<div class="stat-card"><div class="ic">${i[0]}</div><div><div class="num">${i[2]}</div><div class="lbl">${i[1]}</div><div class="small muted">${i[3]}</div></div></div>`).join('')
      + extra.map(i => `<div class="stat-card"><div class="ic">${i[0]}</div><div><div class="num">${i[2]}</div><div class="lbl">${i[1]}</div><div class="small muted">${i[3]}</div></div></div>`).join('');
    $('recentOrders').innerHTML = d.recentOrders.length ? d.recentOrders.map(o => `<div class="between" style="padding:8px 0;border-bottom:1px solid #f0f3f7;">
      <div><b class="small">#${o.id} · ${esc(o.customer_name)}</b><div class="small muted">${money(o.total, '')} · ${esc(o.source)}</div></div>
      <span class="pill ${statusClass(o.status)}">${esc(o.status)}</span></div>`).join('') : `<div class="empty small">لا توجد طلبات بعد</div>`;
    $('recentChats').innerHTML = d.recentConversations.length ? d.recentConversations.map(c => `<div class="between" style="padding:8px 0;border-bottom:1px solid #f0f3f7;">
      <div><b class="small">${c.platform === 'whatsapp' ? '📱' : '💬'} ${esc(c.name || c.psid)}</b><div class="small muted">${esc((c.last_message || '').slice(0, 60))}</div></div>
      <span class="small muted">${fmtDate(c.updated_at)}</span></div>`).join('') : `<div class="empty small">لا توجد محادثات بعد</div>`;
    const cfg = d.config;
    $('badgeAI').classList.toggle('on', cfg.gemini);
    $('badgeWA').classList.toggle('on', cfg.whatsapp);
    $('badgeMS').classList.toggle('on', cfg.messenger);
    $('configInfo').innerHTML = [
      ['🤖', 'Google Gemini', cfg.gemini ? 'مفعّل' : 'يحتاج مفتاح API', cfg.gemini],
      ['📱', 'WhatsApp Cloud API', cfg.whatsapp ? 'مفعّل' : 'يحتاج Token ورقم', cfg.whatsapp],
      ['💬', 'Messenger', cfg.messenger ? 'مفعّل' : 'يحتاج Page Token', cfg.messenger],
      ['🔏', 'توقيع Webhook', cfg.webhookSecret ? 'مفعّل' : 'اختياري (مُعطّل)', cfg.webhookSecret],
    ].map(i => `<div class="row"><span class="pill ${i[3] ? 'ok' : 'warn'}">${i[0]}</span><div><b class="small">${i[1]}</b><div class="small muted">${i[2]}</div></div></div>`).join('');
  }

  async function loadCategories() {
    const d = await api('/api/admin/categories');
    state.categories = d.items || [];
    $('categoryRows').innerHTML = state.categories.length ? state.categories.map(c => `<tr>
      <td>${c.sort_order}</td><td><b>${esc(c.icon)} ${esc(c.name_ar)}</b><div class="small muted">${esc(c.name_en || '')}</div></td>
      <td class="small muted">${esc(c.description || '—')}</td>
      <td><span class="pill ${c.active ? 'ok' : 'bad'}">${c.active ? 'نشط' : 'مخفي'}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-ec="${c.id}">تعديل</button> <button class="btn btn-danger btn-sm" data-dc="${c.id}">حذف</button></td>
    </tr>`).join('') : `<tr><td colspan="5" class="empty">لا توجد أصناف — أضف صنفاً جديداً</td></tr>`;
    $('categoryRows').querySelectorAll('[data-ec]').forEach(b => b.onclick = () => categoryForm(state.categories.find(c => c.id === Number(b.dataset.ec))));
    $('categoryRows').querySelectorAll('[data-dc]').forEach(b => b.onclick = () => confirmBox('حذف هذا الصنف؟ منتجاته ستبقى بدون صنف.', async () => {
      await api('/api/admin/categories/' + b.dataset.dc, { method: 'DELETE' }); toast('تم الحذف'); loadCategories(); loadProducts();
    }));
  }

  function categoryForm(c) {
    c = c || {};
    const m = modal(c.id ? 'تعديل الصنف' : 'صنف جديد', `<form id="catForm">
      <div class="form-row two"><div><label>الاسم بالعربية *</label><input name="name_ar" value="${esc(c.name_ar || '')}" required></div>
      <div><label>الاسم بالإنجليزية</label><input name="name_en" value="${esc(c.name_en || '')}"></div></div>
      <div class="form-row"><label>الوصف</label><input name="description" value="${esc(c.description || '')}"></div>
      <div class="form-row two"><div><label>الرمز (إيموجي أو صورة)</label><input name="icon" id="catIcon" value="${esc(c.icon || '📦')}"></div>
      <div><label>ارفع أيقونة من جهازك</label><input type="file" id="catIconFile" accept="image/*"><div id="catIconPreview" class="small" style="margin-top:6px;"></div></div></div>
      <div class="form-row check"><input type="checkbox" name="has_options" ${c.has_options ? 'checked' : ''}><label>هذا الصنف له ألوان ومقاسات</label></div>
      <div class="form-row two"><div><label>الألوان (افصل بفاصلة)</label><input name="colors_json" value="${esc(Array.isArray(c.colors_json) ? c.colors_json.join('، ') : (typeof c.colors_json === 'string' ? c.colors_json.replace(/[\[\]"]/g, '') : ''))}" placeholder="أحمر، أزرق، أسود"></div>
      <div><label>المقاسات (افصل بفاصلة)</label><input name="sizes_json" value="${esc(Array.isArray(c.sizes_json) ? c.sizes_json.join('، ') : (typeof c.sizes_json === 'string' ? c.sizes_json.replace(/[\[\]"]/g, '') : ''))}" placeholder="S، M، L، XL"></div></div>
      <div class="form-row two"><div><label>الترتيب</label><input name="sort_order" type="number" value="${c.sort_order || 0}"></div></div>
      <div class="form-row check"><input type="checkbox" name="active" ${c.active === 0 ? '' : 'checked'}><label>ظاهر للزبائن</label></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
    </form>`);
    bindUpload('catIconFile', 'catIcon', 'catIconPreview');
    m.el.querySelector('#catForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = {
        name_ar: f.get('name_ar'), name_en: f.get('name_en'), description: f.get('description'),
        icon: f.get('icon'), sort_order: Number(f.get('sort_order')), active: f.get('active') === 'on',
        has_options: f.get('has_options') === 'on',
        colors_json: JSON.stringify(splitOpts(f.get('colors_json'))),
        sizes_json: JSON.stringify(splitOpts(f.get('sizes_json'))),
      };
      const r = await api(c.id ? '/api/admin/categories/' + c.id : '/api/admin/categories', { method: c.id ? 'PUT' : 'POST', body: payload });
      if (r.error) { toast(r.error, true); return; }
      m.close(); toast('تم الحفظ ✓'); loadCategories();
    });
  }

  async function loadProducts() {
    const d = await api('/api/admin/products');
    state.products = d.items || [];
    const catName = id => state.categories.find(c => c.id === id)?.name_ar || 'عام';
    $('productRows').innerHTML = state.products.length ? state.products.map(p => `<tr>
      <td><b>${esc(p.icon)} ${esc(p.name_ar)}</b><div class="small muted">${money(p.price, '')} · ${esc(p.name_en || '')}</div></td>
      <td class="small">${esc(catName(p.category_id))}</td>
      <td><b style="color:var(--teal-dark);">${money(p.price, '')}</b>${p.old_price ? `<div class="small muted"><s>${money(p.old_price, '')}</s></div>` : ''}</td>
      <td>${p.stock}</td>
      <td>${p.avg_rating ? `⭐ ${Number(p.avg_rating).toFixed(1)} (${p.rating_count} تقييم)` : '—'}</td>
      <td><span class="pill ${p.active ? 'ok' : 'bad'}">${p.active ? 'نشط' : 'مخفي'}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-ep="${p.id}">تعديل</button> <button class="btn btn-danger btn-sm" data-dp="${p.id}">حذف</button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">لا توجد منتجات — أضف منتجاً جديداً</td></tr>`;
    $('productRows').querySelectorAll('[data-ep]').forEach(b => b.onclick = () => productForm(state.products.find(p => p.id === Number(b.dataset.ep))));
    $('productRows').querySelectorAll('[data-dp]').forEach(b => b.onclick = () => confirmBox('حذف هذا المنتج؟', async () => {
      await api('/api/admin/products/' + b.dataset.dp, { method: 'DELETE' }); toast('تم الحذف'); loadProducts();
    }));
  }

  function productForm(p) {
    p = p || {};
    const options = state.categories.map(c => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('');
    const m = modal(p.id ? 'تعديل المنتج' : 'منتج جديد', `<form id="prodForm">
      <div class="form-row two"><div><label>الاسم بالعربية *</label><input name="name_ar" value="${esc(p.name_ar || '')}" required></div>
      <div><label>الاسم بالإنجليزية</label><input name="name_en" value="${esc(p.name_en || '')}"></div></div>
      <div class="form-row"><label>الوصف</label><textarea name="description" style="min-height:70px;">${esc(p.description || '')}</textarea></div>
      <div class="form-row two"><div><label>الصنف</label><select name="category_id"><option value="0">عام</option>${options}</select></div>
      <div><label>الرمز (إيموجي أو صورة)</label><input name="icon" id="prodIcon" value="${esc(p.icon || '🛍️')}"></div></div>
      <div class="form-row two"><div><label>ارفع صورة المنتج من جهازك</label><input type="file" id="prodImageFile" accept="image/*"><div id="prodImagePreview" class="small" style="margin-top:6px;">${p.image_url ? `<img src="${esc(p.image_url)}" style="max-width:100%;max-height:110px;border-radius:10px;">` : ''}</div></div>
      <div><label>أو ارفع أيقونة</label><input type="file" id="prodIconFile" accept="image/*"><div id="prodIconPreview" class="small" style="margin-top:6px;"></div></div></div>
      <div class="form-row"><label>رابط الصورة (يُملأ تلقائياً عند الرفع)</label><input name="image_url" id="prodImageUrl" value="${esc(p.image_url || '')}" placeholder="/uploads/..."></div>
      <div class="form-row two"><div><label>السعر</label><input name="price" type="number" step="0.01" value="${p.price || 0}"></div>
      <div><label>السعر قبل الخصم</label><input name="old_price" type="number" step="0.01" value="${p.old_price || 0}"></div></div>
      <div class="form-row two"><div><label>المخزون</label><input name="stock" type="number" value="${p.stock || 0}"></div>
      <div><label>ألوان هذا المنتج (فارغ = من الصنف)</label><input name="colors_json" value="${esc(parseOpts(p.colors_json).join('، '))}" placeholder="أحمر، أزرق"></div></div>
      <div class="form-row two"><div><label>مقاسات هذا المنتج (فارغ = من الصنف)</label><input name="sizes_json" value="${esc(parseOpts(p.sizes_json).join('، '))}" placeholder="S، M، L"></div></div>
      <div class="form-row">
        <label>🧮 الكمية لكل لون/مقاس (اختياري)</label>
        <input type="hidden" name="variants_json" id="prodVariantsJson" value="${esc(p.variants_json || '[]')}">
        <div class="row wrap" style="gap:8px;margin-bottom:8px;">
          <button type="button" class="btn btn-ghost btn-sm" id="genVariants">توليد المتغيرات</button>
          <input type="number" id="bulkStock" placeholder="كمية موحدة" min="0" style="width:130px;">
          <button type="button" class="btn btn-ghost btn-sm" id="applyBulkStock">تطبيق على الكل</button>
          <span class="small muted" id="variantsHint"></span>
        </div>
        <div id="variantRows" style="max-height:230px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:8px;"></div>
        <div class="small muted" style="margin-top:6px;">اترك المتغيرات فارغة لاستخدام المخزون العام أعلاه. عند وجود متغيرات يُحسب المخزون الإجمالي تلقائياً من مجموعها.</div>
      </div>
      <div class="form-row">
        <label>صور المنتج (يمكن اختيار أكثر من صورة)</label>
        <input type="file" id="prodGallery" accept="image/*" multiple>
        <input type="hidden" name="images_json" id="prodImagesJson" value="${esc(p.images_json || '[]')}">
        <div id="prodGalleryPreview" class="row wrap" style="margin-top:8px;"></div>
      </div>
      <div class="form-row">
        <label>صورة لكل لون (عند اختيار اللون تتغير الصورة)</label>
        <input type="hidden" name="color_images_json" id="prodColorImagesJson" value="${esc(p.color_images_json || '{}')}">
        <div id="colorImages"></div>
      </div>
      <div class="form-row check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}><label>ظاهر للزبائن</label></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
    </form>`, { wide: true });
    bindUpload('prodImageFile', 'prodImageUrl', 'prodImagePreview');
    bindUpload('prodIconFile', 'prodIcon', 'prodIconPreview');

    let gallery = parseJsonSafe($('prodImagesJson').value, []);
    let colorMap = parseJsonSafe($('prodColorImagesJson').value, {});
    const colorsInput = m.el.querySelector('[name=colors_json]');
    const sizesInput = m.el.querySelector('[name=sizes_json]');
    const variantsInput = $('prodVariantsJson');

    const readVariants = () => parseJsonSafe(variantsInput.value, []);
    const saveVariants = (v) => { variantsInput.value = JSON.stringify(v); renderVariants(); };
    function combosFromInputs() {
      const colors = splitOpts(colorsInput.value), sizes = splitOpts(sizesInput.value);
      const out = [];
      if (colors.length && sizes.length) colors.forEach(c => sizes.forEach(s => out.push({ color: c, size: s, stock: 0 })));
      else if (colors.length) colors.forEach(c => out.push({ color: c, size: '', stock: 0 }));
      else if (sizes.length) sizes.forEach(s => out.push({ color: '', size: s, stock: 0 }));
      return out;
    }
    function generateVariants() {
      const old = readVariants(), next = combosFromInputs();
      next.forEach(v => { const found = old.find(x => (x.color || '') === v.color && (x.size || '') === v.size); if (found) v.stock = Number(found.stock) || 0; });
      if (next.length && !next.some(v => v.stock) && old.length === 1 && !old[0].color && !old[0].size) next.forEach(v => v.stock = Number(old[0].stock) || 0);
      saveVariants(next);
    }
    function renderVariants() {
      const box = $('variantRows'); if (!box) return;
      const vars = readVariants();
      const hint = $('variantsHint');
      if (hint) hint.textContent = vars.length ? `المجموع: ${vars.reduce((s, v) => s + (Number(v.stock) || 0), 0)} قطعة` : '';
      if (!vars.length) {
        box.innerHTML = `<div class="small muted">لا توجد متغيرات — اكتب الألوان/المقاسات ثم اضغط «توليد المتغيرات».</div>`;
        return;
      }
      box.innerHTML = `<div class="row wrap" style="gap:8px;padding:4px 2px 8px;border-bottom:1px solid var(--line);font-weight:800;">
          <span style="min-width:110px;">اللون</span><span style="min-width:100px;">المقاس</span><span style="min-width:100px;">الكمية</span><span>السعر (اختياري)</span></div>` +
        vars.map((v, i) => `<div class="row wrap" style="gap:8px;padding:6px 2px;border-bottom:1px solid #f0f3f7;">
          <span class="pill" style="min-width:110px;">${esc(v.color || '—')}</span>
          <span class="pill" style="min-width:100px;">${esc(v.size || '—')}</span>
          <input type="number" min="0" data-vi="${i}" data-vf="stock" value="${Number(v.stock) || 0}" style="width:100px;">
          <input type="number" min="0" step="0.01" data-vi="${i}" data-vf="price" value="${Number(v.price) || 0}" placeholder="0" style="width:110px;">
          <button type="button" class="icon-btn" data-vd="${i}" style="background:#fff;">✕</button>
        </div>`).join('');
      box.querySelectorAll('[data-vf]').forEach(inp => inp.oninput = () => {
        const v = readVariants(); const i = Number(inp.dataset.vi);
        if (v[i]) { v[i][inp.dataset.vf] = Number(inp.value) || 0; variantsInput.value = JSON.stringify(v); if (inp.dataset.vf === 'stock') { const h = $('variantsHint'); if (h) h.textContent = `المجموع: ${v.reduce((s, x) => s + (Number(x.stock) || 0), 0)} قطعة`; } }
      });
      box.querySelectorAll('[data-vd]').forEach(b => b.onclick = () => { const v = readVariants(); v.splice(Number(b.dataset.vd), 1); saveVariants(v); });
    }
    $('genVariants')?.addEventListener('click', generateVariants);
    $('applyBulkStock')?.addEventListener('click', () => {
      const n = Number($('bulkStock').value) || 0; const v = readVariants();
      v.forEach(x => x.stock = n); saveVariants(v); toast(`تم تطبيق الكمية ${n} على ${v.length} متغير`);
    });

    function renderGallery() {
      $('prodGalleryPreview').innerHTML = gallery.map((u, i) => `<div class="center" style="position:relative;">
        <img src="${esc(u)}" style="width:76px;height:76px;object-fit:cover;border-radius:9px;">
        <button type="button" class="icon-btn" data-rm="${i}" style="position:absolute;top:-6px;left:-6px;background:#fff;">✕</button></div>`).join('');
      $('prodGalleryPreview').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
        gallery.splice(Number(b.dataset.rm), 1);
        $('prodImagesJson').value = JSON.stringify(gallery); renderGallery();
      });
    }
    function renderColorRows() {
      const colors = splitOpts(colorsInput.value);
      $('colorImages').innerHTML = colors.length ? colors.map(c => `<div class="row wrap" style="padding:7px 0;border-bottom:1px solid #f0f3f7;">
        <span class="pill">${esc(c)}</span>
        <input type="file" accept="image/*" data-color="${esc(c)}" style="width:auto;max-width:150px;">
        <input type="text" data-color-url="${esc(c)}" value="${esc(colorMap[c] || '')}" placeholder="رابط الصورة أو ارفع ملف" style="flex:1;min-width:140px;">
        ${colorMap[c] ? `<img src="${esc(colorMap[c])}" style="width:42px;height:42px;object-fit:cover;border-radius:8px;">` : ''}
      </div>`).join('') : `<div class="small muted">اكتب الألوان في الحقل أعلاه لتظهر هنا إمكانية ربط صورة بكل لون.</div>`;
    }
    $('prodGallery').onchange = async e => {
      for (const f of Array.from(e.target.files || [])) {
        try { gallery.push(await uploadFile(f)); } catch (err) { toast(err.message, true); }
      }
      $('prodImagesJson').value = JSON.stringify(gallery); renderGallery(); toast('تمت إضافة الصور ✓');
      e.target.value = '';
    };
    $('colorImages').onchange = async e => {
      const t = e.target;
      if (!t.matches('input[type=file][data-color]') || !t.files[0]) return;
      try {
        colorMap[t.dataset.color] = await uploadFile(t.files[0]);
        $('prodColorImagesJson').value = JSON.stringify(colorMap); renderColorRows(); toast(`صورة ${t.dataset.color} جاهزة ✓`);
      } catch (err) { toast(err.message, true); }
    };
    $('colorImages').oninput = e => {
      if (!e.target.matches('input[data-color-url]')) return;
      colorMap[e.target.dataset.colorUrl] = e.target.value;
      $('prodColorImagesJson').value = JSON.stringify(colorMap);
    };
    colorsInput.oninput = () => { renderColorRows(); generateVariants(); };
    sizesInput.oninput = generateVariants;
    renderGallery(); renderColorRows(); renderVariants();

    m.el.querySelector('#prodForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = {
        name_ar: f.get('name_ar'), name_en: f.get('name_en'), description: f.get('description'),
        category_id: Number(f.get('category_id')) || null, icon: f.get('icon'), price: Number(f.get('price')),
        old_price: Number(f.get('old_price')), stock: Number(f.get('stock')), image_url: f.get('image_url'),
        colors_json: JSON.stringify(splitOpts(f.get('colors_json'))),
        sizes_json: JSON.stringify(splitOpts(f.get('sizes_json'))),
        images_json: f.get('images_json') || '[]',
        color_images_json: f.get('color_images_json') || '{}',
        variants_json: f.get('variants_json') || '[]',
        active: f.get('active') === 'on',
      };
      const r = await api(p.id ? '/api/admin/products/' + p.id : '/api/admin/products', { method: p.id ? 'PUT' : 'POST', body: payload });
      if (r.error) { toast(r.error, true); return; }
      m.close(); toast('تم الحفظ ✓'); loadProducts(); loadOverview();
    });
  }

  async function loadOrders() {
    const status = $('orderFilter').value;
    const d = await api('/api/admin/orders' + (status ? '?status=' + encodeURIComponent(status) : ''));
    const statuses = ['جديد', 'قيد التحضير', 'تم الإرسال', 'تم الشحن', 'مكتمل', 'ملغي'];
    $('orderRows').innerHTML = d.items.length ? d.items.map(o => `<tr>
      <td><b>#${o.id}</b><div class="small muted">${fmtDate(o.created_at)}</div></td>
      <td><b>${esc(o.customer_name)}</b><div class="small muted">${esc(o.address || '')}</div></td>
      <td dir="ltr" class="small">${esc(o.phone)}</td>
      <td class="small">${o.items.map(i => `${esc(i.name)} ×${i.qty}`).join('، ')}</td>
      <td><b style="color:var(--teal-dark);">${money(o.total, '')}</b></td>
      <td class="small muted">${esc(o.source)}</td>
      <td><select data-os="${o.id}" style="width:auto;padding:5px 8px;">${statuses.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select> ${o.paid ? '<span class="pill ok">💳 مدفوع</span>' : ''}</td>
      <td><button class="btn btn-ghost btn-sm" data-inv="${o.id}">🖨️ فاتورة</button> <button class="icon-btn" data-od="${o.id}" title="حذف">🗑️</button></td>
    </tr>`).join('') : `<tr><td colspan="8" class="empty">لا توجد طلبات بعد</td></tr>`;
    $('orderRows').querySelectorAll('[data-os]').forEach(s => s.onchange = async () => {
      const r = await api('/api/admin/orders/' + s.dataset.os, { method: 'PUT', body: { status: s.value } });
      if (r.ok) { toast('تم تحديث الحالة ✓'); loadOrders(); loadOverview(); }
      else toast(r.error || 'تعذر التحديث', true);
    });
    $('orderRows').querySelectorAll('[data-inv]').forEach(b => b.onclick = () => window.open(`/api/admin/orders/${b.dataset.inv}/invoice`, '_blank'));
    $('orderRows').querySelectorAll('[data-od]').forEach(b => b.onclick = () => confirmBox('حذف الطلب نهائياً؟', async () => {
      await api('/api/admin/orders/' + b.dataset.od, { method: 'DELETE' }); toast('تم الحذف'); loadOrders(); loadOverview();
    }));
  }

  async function loadConversations() {
    const d = await api('/api/admin/conversations');
    $('conversationRows').innerHTML = d.items.length ? d.items.map(c => `<tr>
      <td><span class="pill ${c.platform === 'whatsapp' ? 'ok' : ''}">${c.platform === 'whatsapp' ? '📱 واتساب' : '💬 مسنجر'}</span></td>
      <td><b>${esc(c.name || '(بدون اسم)')}</b><div class="small muted" dir="ltr">${esc(c.psid)}</div></td>
      <td class="small">${esc((c.last_message || '').slice(0, 70))}</td>
      <td>${c.msg_count}</td><td class="small muted">${fmtDate(c.updated_at)}</td>
      <td><button class="btn btn-ghost btn-sm" data-oc="${c.id}">عرض</button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">لا توجد محادثات بعد — ستظهر هنا أول رسالة من زبون</td></tr>`;
    $('conversationRows').querySelectorAll('[data-oc]').forEach(b => b.onclick = () => viewConversation(Number(b.dataset.oc)));
  }

  async function viewConversation(id) {
    const d = await api('/api/admin/conversations/' + id + '/messages');
    const m = modal('المحادثة', `<div class="chat-box" style="max-height:60vh;">
      ${d.items.map(x => `<div class="bubble ${x.direction === 'in' ? 'in' : 'out'}">
        <span class="who">${x.direction === 'in' ? 'الزبون' : 'المساعد الذكي'} · ${fmtDate(x.created_at)}</span>${esc(x.text)}</div>`).join('') || '<div class="empty">لا توجد رسائل</div>'}
    </div>`, { wide: true });
  }

  async function loadCustomers() {
    const [c, o] = await Promise.all([api('/api/admin/customers'), api('/api/admin/otps')]);
    $('customerRows').innerHTML = c.items.length ? c.items.map(x => `<tr>
      <td>${x.id}</td><td class="small" dir="ltr">${esc(x.phone)}</td><td><b>${esc(x.name || '—')}</b></td>
      <td class="small">${esc(x.city || '—')}</td>
      <td class="small muted">${x.latitude ? `${Number(x.latitude).toFixed(4)}, ${Number(x.longitude).toFixed(4)}` : '—'}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="empty">لا يوجد زبائن بعد</td></tr>`;
    $('otpRows').innerHTML = o.items.length ? o.items.map(x => `<tr>
      <td dir="ltr" class="small">${esc(x.phone)}</td><td><b>${esc(x.code)}</b></td>
      <td><span class="pill ${x.used ? '' : 'warn'}">${x.used ? 'مستخدم' : 'ساري حتى ' + fmtDate(new Date(x.expires_at).toISOString())}</span></td>
    </tr>`).join('') : `<tr><td colspan="3" class="empty">لا توجد رموز بعد</td></tr>`;
  }

  async function loadFaqs() {
    const d = await api('/api/admin/faqs');
    $('faqRows').innerHTML = d.items.length ? d.items.map(f => `<tr>
      <td><b>${esc(f.question)}</b></td><td class="small muted">${esc(f.answer)}</td>
      <td><span class="pill ${f.active ? 'ok' : 'bad'}">${f.active ? 'نشط' : 'مخفي'}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-ef="${f.id}">تعديل</button> <button class="btn btn-danger btn-sm" data-df="${f.id}">حذف</button></td>
    </tr>`).join('') : `<tr><td colspan="4" class="empty">لا توجد أسئلة شائعة</td></tr>`;
    $('faqRows').querySelectorAll('[data-ef]').forEach(b => b.onclick = async () => {
      const all = (await api('/api/admin/faqs')).items;
      faqForm(all.find(f => f.id === Number(b.dataset.ef)));
    });
    $('faqRows').querySelectorAll('[data-df]').forEach(b => b.onclick = () => confirmBox('حذف هذا السؤال؟', async () => {
      await api('/api/admin/faqs/' + b.dataset.df, { method: 'DELETE' }); toast('تم الحذف'); loadFaqs();
    }));
  }

  // ------------------------- ads -------------------------
  async function loadAds() {
    const d = await api('/api/admin/ads');
    const rows = $('adRows'); if (!rows) return;
    const kindL = { banner: 'لافتة', promo: 'ترويج', chat: 'شات' };
    const placeL = { store: 'متجر', messenger: 'مسنجر', whatsapp: 'واتساب', chat: 'شات', all: 'الكل' };
    rows.innerHTML = d.items.length ? d.items.map(a => `<tr>
      <td><b>${esc(a.title || '—')}</b>${a.body ? `<div class="small muted">${esc(a.body.slice(0, 60))}</div>` : ''}</td>
      <td><span class="pill">${esc(kindL[a.kind] || a.kind)}</span></td>
      <td><span class="pill">${esc(placeL[a.placement] || a.placement)}</span></td>
      <td>${a.priority || 0}</td>
      <td><span class="pill ${a.active ? 'ok' : 'bad'}">${a.active ? 'نشط' : 'مخفي'}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-ea="${a.id}">تعديل</button> <button class="btn btn-danger btn-sm" data-da="${a.id}">حذف</button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">لا توجد إعلانات بعد</td></tr>`;
    rows.querySelectorAll('[data-ea]').forEach(b => b.onclick = async () => { const all = (await api('/api/admin/ads')).items; adForm(all.find(a => a.id === Number(b.dataset.ea))); });
    rows.querySelectorAll('[data-da]').forEach(b => b.onclick = () => confirmBox('حذف هذا الإعلان؟', async () => { await api('/api/admin/ads/' + b.dataset.da, { method: 'DELETE' }); toast('تم الحذف'); loadAds(); }));
  }

  function adForm(a) {
    a = a || {};
    const kind = a.kind || 'banner', placement = a.placement || 'store';
    const m = modal(a.id ? 'تعديل إعلان' : 'إعلان جديد', `<form id="adForm">
      <div class="form-row"><label>العنوان</label><input name="title" value="${esc(a.title || '')}"></div>
      <div class="form-row"><label>النص</label><textarea name="body">${esc(a.body || '')}</textarea></div>
      <div class="form-row"><label>صورة الإعلان (ارفع من ملفك)</label>
        <input type="hidden" name="image_url" id="adImgUrl" value="${esc(a.image_url || '')}">
        <input type="file" id="adImgFile" accept="image/*" style="margin:6px 0;">
        <div id="adImgPreview" style="margin:6px 0;">${a.image_url ? `<img src="${esc(a.image_url)}" style="max-height:90px;border-radius:10px;">` : ''}</div>
        <div class="small muted">يمكن رفع صورة من جهازك (لا حاجة لرابط).</div></div>
      <div class="form-row two"><div><label>رابط التوجيه (CTA)</label><input name="link_url" value="${esc(a.link_url || '')}" placeholder="https://..."></div><div><label>نص الزر</label><input name="cta" value="${esc(a.cta || '')}" placeholder="تفاصيل"></div></div>
      <div class="form-row two"><div><label>النوع</label><select name="kind"><option value="banner" ${kind === 'banner' ? 'selected' : ''}>لافتة</option><option value="promo" ${kind === 'promo' ? 'selected' : ''}>ترويج</option><option value="chat" ${kind === 'chat' ? 'selected' : ''}>شات</option></select></div>
        <div><label>المكان</label><select name="placement"><option value="store" ${placement === 'store' ? 'selected' : ''}>متجر</option><option value="messenger" ${placement === 'messenger' ? 'selected' : ''}>مسنجر</option><option value="whatsapp" ${placement === 'whatsapp' ? 'selected' : ''}>واتساب</option><option value="chat" ${placement === 'chat' ? 'selected' : ''}>شات</option><option value="all" ${placement === 'all' ? 'selected' : ''}>الكل</option></select></div></div>
      <div class="form-row two"><div><label>أولوية (أعلى أولاً)</label><input name="priority" type="number" value="${a.priority || 0}"></div><div class="check" style="align-self:end;padding-bottom:10px;"><input type="checkbox" name="active" ${a.active === 0 ? '' : 'checked'}><label>مفعّل</label></div></div>
      <div class="form-row two"><div><label>يبدأ (اختياري)</label><input name="start_at" value="${esc(a.start_at || '')}" placeholder="2026-11-26T00:00:00Z"></div><div><label>ينتهي (اختياري)</label><input name="end_at" value="${esc(a.end_at || '')}" placeholder="2026-12-01T00:00:00Z"></div></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
    </form>`);
    const adFile = m.el.querySelector('#adImgFile');
    if (adFile) adFile.onchange = async () => {
      const f = adFile.files[0]; if (!f) return; toast('جارٍ رفع الصورة...');
      try { const url = await uploadFile(f); m.el.querySelector('#adImgUrl').value = url; m.el.querySelector('#adImgPreview').innerHTML = '<img src="' + url + '" style="max-height:90px;border-radius:10px;">'; toast('تم الرفع ✓'); }
      catch (err) { toast(err.message, true); }
    };
    m.el.querySelector('#adForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title'), body: fd.get('body'), image_url: fd.get('image_url'), link_url: fd.get('link_url'), cta: fd.get('cta'),
        kind: fd.get('kind'), placement: fd.get('placement'), priority: Number(fd.get('priority') || 0), active: fd.get('active') === 'on',
        start_at: fd.get('start_at') || '', end_at: fd.get('end_at') || '',
      };
      const r = await api(a.id ? '/api/admin/ads/' + a.id : '/api/admin/ads', { method: a.id ? 'PUT' : 'POST', body: payload });
      if (r.error) { toast(r.error, true); return; }
      m.close(); toast('تم الحفظ ✓'); loadAds();
    });
  }

  function faqForm(f) {
    f = f || {};
    const m = modal(f.id ? 'تعديل سؤال' : 'سؤال جديد', `<form id="faqForm">
      <div class="form-row"><label>السؤال</label><input name="question" value="${esc(f.question || '')}" required></div>
      <div class="form-row"><label>الجواب</label><textarea name="answer" required>${esc(f.answer || '')}</textarea></div>
      <div class="form-row check"><input type="checkbox" name="active" ${f.active === 0 ? '' : 'checked'}><label>مفعّل</label></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
    </form>`);
    m.el.querySelector('#faqForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { question: fd.get('question'), answer: fd.get('answer'), active: fd.get('active') === 'on' };
      const r = await api(f.id ? '/api/admin/faqs/' + f.id : '/api/admin/faqs', { method: f.id ? 'PUT' : 'POST', body: payload });
      if (r.error) { toast(r.error, true); return; }
      m.close(); toast('تم الحفظ ✓'); loadFaqs();
    });
  }

  // أضف إعلان + حفظ تلقائي لمفاتيح الإعلانات
  const addAdBtn = $('addAd'); if (addAdBtn) addAdBtn.onclick = () => adForm();
  for (const k of ['set_ads_enabled', 'set_ads_in_chat']) {
    const el = $(k); if (!el) continue;
    el.addEventListener('change', () => api('/api/admin/settings', { method: 'PUT', body: { [k.replace('set_', '')]: el.checked ? '1' : '0' } }));
  }

  async function loadSettings() {
    const d = await api('/api/admin/settings');
    for (const [k, v] of Object.entries(d.settings)) {
      const el = $('set_' + k);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = String(v) === '1';
      else el.value = v;
    }
    const r = d.runtime;
    $('runtimeInfo').innerHTML = `<span class="pill ${r.gemini ? 'ok' : 'warn'}">${r.gemini ? esc(r.model) : 'Gemini غير مفعّل'}</span>
      <span class="pill ${r.whatsapp ? 'ok' : 'warn'}">واتساب</span><span class="pill ${r.messenger ? 'ok' : 'warn'}">مسنجر</span>`;
    const msHook = $('msWebhookUrl'); if (msHook) msHook.textContent = location.origin + '/webhooks/messenger';
  }

  $('saveSettings').onclick = async () => {
    const keys = ['business_name', 'currency', 'country', 'logo_url', 'invoice_size', 'delivery_fee', 'delivery_free_threshold', 'delivery_note', 'delivery_methods', 'business_hours', 'return_policy', 'payment_methods', 'bank_info', 'whatsapp_number', 'wa_phone_number_id', 'wa_access_token', 'messenger_link', 'messenger_page_token', 'messenger_page_id', 'facebook_page_id', 'facebook_page_token', 'catalog_url', 'app_link', 'ai_enabled', 'greeting', 'welcome', 'welcome_messenger', 'welcome_whatsapp', 'custom_instructions', 'reply_language', 'ai_temperature', 'ai_max_tokens', 'footer_text', 'bot_tone', 'ads_enabled', 'ads_in_chat'];
    const payload = {};
    for (const k of keys) {
      const el = $('set_' + k);
      if (!el) continue;
      payload[k] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
    }
    const r = await api('/api/admin/settings', { method: 'PUT', body: payload });
    if (r.ok) { toast('تم حفظ الإعدادات ✓'); loadOverview(); } else toast(r.error || 'تعذر الحفظ', true);
  };

  $('testWhatsapp').onclick = async () => {
    const out = $('waTestResult');
    out.textContent = 'جارٍ التحقق...';
    const r = await api('/api/admin/test-whatsapp', { method: 'POST', body: {} });
    if (r.ok) out.textContent = `✅ ${r.displayPhone || r.phoneId} ${r.verifiedName ? '· ' + r.verifiedName : ''}`;
    else out.textContent = '❌ ' + (r.error || 'تعذر التحقق');
  };

  (() => {
    const input = $('logoFile');
    if (!input) return;
    const show = url => {
      if (!url) return;
      $('set_logo_url').value = url;
      $('logoPreview').innerHTML = `<img src="${url}" style="max-height:60px;border-radius:8px;">`;
      $('logoCurrent').src = url;
    };
    show($('set_logo_url').value);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      toast('جارٍ رفع اللوجو...');
      try { show(await uploadFile(file)); toast('تم رفع اللوجو ✓ — اضغط حفظ الإعدادات'); }
      catch (e) { toast(e.message, true); }
    };
  })();

  $('testFacebook').onclick = async () => {
    const out = $('fbTestResult');
    out.textContent = 'جارٍ التحقق...';
    const r = await api('/api/admin/test-facebook', { method: 'POST', body: {} });
    out.textContent = r.ok ? `✅ صفحة ${r.pageId} · ${r.name}` : '❌ ' + (r.error || 'تعذر التحقق');
  };
  $('postToPage').onclick = async () => {
    const msg = ($('fbPostText').value || '').trim();
    if (!msg) { toast('اكتب أولاً المحتوى للنشر', true); return; }
    const r = await api('/api/admin/page/post', { method: 'POST', body: { message: msg } });
    toast(r.ok ? '✅ تم نشر المحتوى على الفيس ✅' : (r.error || 'فشل النشر'), !r.ok);
    if (r.ok) $('fbPostText').value = '';
  };
  $('testMessenger').onclick = async () => {
    const out = $('msTestResult');
    out.textContent = 'جارٍ التحقق...';
    const r = await api('/api/admin/test-messenger', { method: 'POST', body: {} });
    if (r.ok) {
      const subs = r.subscribed ? ` | اشتراكات: ${(r.subscribed[0]?.subscribed_fields||[]).join(', ') || 'لا يوجد'}` : '';
      out.textContent = `✅ ${r.name || ''} (${r.pageId || ''})${subs}`;
    } else out.textContent = '❌ ' + (r.error || 'تعذر التحقق');
  };
  const subBtn = $('subscribeMessenger');
  if (subBtn) subBtn.onclick = async () => {
    const out = $('msTestResult');
    out.textContent = 'جارٍ تفعيل الاشتراك...';
    const r = await api('/api/admin/subscribe-messenger', { method: 'POST', body: {} });
    out.textContent = r.ok ? '✅ تم تفعيل استقبال الرسائل' : '❌ ' + (r.error || 'فشل الاشتراك');
    if (r.ok) $('webhookStatusBtn')?.click();
  };
  const whBtn = $('webhookStatusBtn');
  if (whBtn) whBtn.onclick = async () => {
    const box = $('webhookStatusBox');
    box.textContent = 'جارٍ الفحص...';
    const r = await api('/api/admin/webhook-status');
    if (!r || r.error) { box.textContent = 'تعذر الجلب: ' + (r?.error || ''); return; }
    const lines = [];
    lines.push(`الرابط: ${location.origin}${r.endpoint}`);
    lines.push(`رمز التحقق: ${r.verifyToken}`);
    lines.push(`الصفحة: ${r.pageId || 'غير معروف'} | توكن مسنجر: ${r.hasToken ? 'موجود ✅' : 'مفقود ❌'}`);
    lines.push(`اشتراك الرسائل: ${r.subscribedAt ? 'مفعّل ✅ (' + r.subscribedAt + ')' : 'لم يُسجّل بعد — اضغط "تفعيل استقبال الرسائل"'}`);
    lines.push(`آخر تحقق من Meta: ${r.lastVerify ? r.lastVerify.label + ' — ' + r.lastVerify.at : 'لا يوجد ❌ (لم يصل Meta إلى الرابط)'}`);
    lines.push(`آخر رسالة واردة: ${r.lastMessage ? r.lastMessage.at + ' — من ' + r.lastMessage.sender + ': ' + (r.lastMessage.text || '') : 'لا توجد رسائل بعد'}`);
    if (r.events?.length) {
      lines.push('--- آخر الأحداث ---');
      for (const e of r.events.slice(0, 8)) lines.push(`• ${e.at} — ${e.label}${e.text ? ' — ' + e.text : ''}`);
    } else lines.push('--- لا توجد أحداث مسجّلة بعد ---');
    lines.push('');
    lines.push(r.hint);
    box.textContent = lines.join('\n');
    $('webhookStatusAt').textContent = 'آخر فحص: ' + new Date().toLocaleTimeString('ar');
  };
  const pollerBtn = $('pollerBtn');
  if (pollerBtn) pollerBtn.onclick = async () => {
    const box = $('pollerBox');
    box.textContent = 'جارٍ الفحص...';
    let p = await api('/api/admin/poller/status');
    if (!p.enabled && p.creds) {
      p = await api('/api/admin/poller/start', { method: 'POST', body: {} });
      box.textContent = 'تم تشغيل الاستطلاع التلقائي ✅\n';
    }
    const r = await api('/api/admin/poller/run', { method: 'POST', body: {} });
    box.textContent = (box.textContent || '') + `الاستطلاع: ${r.enabled ? 'مفعّل ✅' : 'متوقف ❌'}\n` +
      `كل 20 ثانية | آخر فحص: ${r.lastRun || '—'}\n` +
      `الرسائل المستلمة: ${r.messages} | الأخطاء: ${r.errors}\n` +
      `آخر تشغيل: ${r.runs}`;
  };

  $('backupBtn').onclick = async () => {
    const r = await fetch('/api/admin/backup', { credentials: 'same-origin' });
    if (!r.ok) { toast('تعذر إنشاء النسخة', true); return; }
    const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `opera-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('تم تنزيل النسخة الاحتياطية ✓');
  };
  $('restoreBtn').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { toast('ملف JSON غير صالح', true); return; }
    confirmBox('سيتم استبدال البيانات الحالية بالنسخة المستوردة. متابعة؟', async () => {
      const r = await api('/api/admin/restore', { method: 'POST', body: { data: parsed } });
      if (r.ok) {
        toast('تم استيراد النسخة ✓');
        await Promise.all([loadOverview(), loadCategories(), loadProducts(), loadOrders(), loadConversations(), loadFaqs()]);
      } else toast(r.error || 'تعذر الاستيراد', true);
    });
    e.target.value = '';
  };

  $('savePassword').onclick = async () => {
    const r = await api('/api/admin/password', { method: 'POST', body: {
      username: $('sec_username').value, old_password: $('sec_old').value, new_password: $('sec_new').value,
    } });
    if (r.ok) { toast('تم تغيير كلمة المرور ✓'); $('sec_old').value = ''; $('sec_new').value = ''; }
    else toast(r.error || 'تعذر التغيير', true);
  };

  $('addCategory').onclick = () => categoryForm();
  $('addProduct').onclick = () => productForm();
  $('addFaq').onclick = () => faqForm();
  $('orderFilter').onchange = loadOrders;
  document.querySelectorAll('#quickTests .chip').forEach(b => b.onclick = () => { $('testInput').value = b.dataset.msg; });
  $('testBtn').onclick = async () => {
    const btn = $('testBtn'); btn.disabled = true; btn.textContent = '...';
    const r = await api('/api/admin/test-reply', { method: 'POST', body: { message: $('testInput').value } });
    btn.disabled = false; btn.textContent = 'إرسال للاختبار';
    if (r.error) { toast(r.error, true); return; }
    $('testResult').innerHTML = `<div class="bubble out"><span class="who">المساعد الذكي 🤖</span>${esc(r.reply)}</div>`;
  };

  boot();
// ===== custom replies + notifications + post rules =====
async function loadReplies() {
  const d = await api('/api/admin/replies'); const rows = $('replyRows'); if (!rows) return;
  const matchL = { contains: 'يحتوي', exact: 'مطابقة', starts: 'يبدأ', word: 'كلمة' };
  rows.innerHTML = d.items.length ? d.items.map(r => `<tr><td><b>${esc(r.keyword)}</b></td><td class="small muted">${esc(r.answer.slice(0,60))}</td><td>${esc(matchL[r.match_type]||r.match_type)}</td><td>${esc(r.channel)}</td><td>${r.priority||0}</td><td><span class="pill ${r.active?'ok':'bad'}">${r.active?'نشط':'مخفي'}</span></td><td><button class="btn btn-ghost btn-sm" data-er="${r.id}">تعديل</button> <button class="btn btn-danger btn-sm" data-dr="${r.id}">حذف</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">لا توجد ردود مخصصة</td></tr>';
  rows.querySelectorAll('[data-er]').forEach(b => b.onclick = async () => { const all = (await api('/api/admin/replies')).items; replyForm(all.find(x => x.id === Number(b.dataset.er))); });
  rows.querySelectorAll('[data-dr]').forEach(b => b.onclick = () => confirmBox('حذف الرد؟', async () => { await api('/api/admin/replies/' + b.dataset.dr, { method: 'DELETE' }); toast('تم الحذف'); loadReplies(); }));
}
function replyForm(r) {
  r = r || {}; const mt = r.match_type || 'contains', ch = r.channel || 'all';
  const m = modal(r.id ? 'تعديل رد' : 'رد جديد', `<form id="replyForm">
    <div class="form-row"><label>كلمات مفتاحية (فاصلة)</label><input name="keyword" value="${esc(r.keyword||'')}" required></div>
    <div class="form-row"><label>الرد</label><textarea name="answer" required>${esc(r.answer||'')}</textarea></div>
    <div class="form-row two"><div><label>النوع</label><select name="match_type"><option value="contains" ${mt==='contains'?'selected':''}>يحتوي</option><option value="exact" ${mt==='exact'?'selected':''}>مطابقة تامة</option><option value="starts" ${mt==='starts'?'selected':''}>يبدأ بـ</option><option value="word" ${mt==='word'?'selected':''}>كلمة كاملة</option></select></div>
      <div><label>القناة</label><select name="channel"><option value="all" ${ch==='all'?'selected':''}>الكل</option><option value="messenger" ${ch==='messenger'?'selected':''}>مسنجر</option><option value="whatsapp" ${ch==='whatsapp'?'selected':''}>واتساب</option></select></div></div>
    <div class="form-row two"><div><label>أولوية</label><input name="priority" type="number" value="${r.priority||0}"></div><div class="check" style="align-self:end;padding-bottom:10px;"><input type="checkbox" name="active" ${r.active===0?'':'checked'}><label>مفعّل</label></div></div>
    <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div></form>`);
  m.el.querySelector('#replyForm').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target); const payload = { keyword: fd.get('keyword'), answer: fd.get('answer'), match_type: fd.get('match_type'), channel: fd.get('channel'), priority: Number(fd.get('priority')||0), active: fd.get('active')==='on' }; const res = await api(r.id ? '/api/admin/replies/'+r.id : '/api/admin/replies', { method: r.id?'PUT':'POST', body: payload }); if (res.error) { toast(res.error, true); return; } m.close(); toast('تم الحفظ ✓'); loadReplies(); });
}
const addReplyBtn = $('addReply'); if (addReplyBtn) addReplyBtn.onclick = () => replyForm();

async function loadNotifications() {
  try {
    const p = await api('/api/admin/push/subscribers');
    const el = $('pushSubs'); if (el) el.textContent = `الأجهزة المشتركة في إشعارات الهاتف: ${p.count || 0} — التنبيهات تصل حتى والتطبيق مغلق`;
  } catch {}
  const d = await api('/api/admin/notifications'); const rows = $('notifRows'); if (!rows) return;
  rows.innerHTML = (d.items||[]).length ? d.items.map(n => `<tr><td>${esc(n.title||'—')}</td><td class="small muted">${esc((n.message||'').slice(0,60))}</td><td>${esc(n.platform)}</td><td>${n.sent}</td><td>${n.failed}</td><td class="small muted">${esc(n.created_at)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">لا توجد تنبيهات</td></tr>';
}
const sendNotifBtn = $('sendNotif'); if (sendNotifBtn) sendNotifBtn.onclick = async () => {
  const msg = $('notif_msg').value.trim(); if (!msg) { toast('نص التنبيه مطلوب', true); return; }
  const r = await api('/api/admin/notify', { method: 'POST', body: { title: $('notif_title').value, message: msg, platform: $('notif_platform').value, psid: $('notif_psid').value.trim() || undefined } });
  if (r.ok) { toast(`تم الإرسال ✓ — التطبيق/الهاتف: ${r.pushSent || 0} · محادثات: ${r.sent - (r.pushSent || 0)}/${r.targets}`); $('notif_msg').value = ''; loadNotifications(); } else toast(r.error || 'فشل الإرسال', true);
};

async function loadPostRules() {
  const d = await api('/api/admin/post-rules'); const rows = $('postRuleRows'); if (!rows) return;
  rows.innerHTML = (d.items||[]).length ? d.items.map(p => `<tr><td>${esc(p.post_id)}</td><td>${esc(p.keyword||'كل')}</td><td class="small muted">${esc((p.answer||'').slice(0,50))}</td><td>${p.reply_comment?'✅':'—'}</td><td>${p.notify_admin?'✅':'—'}</td><td><button class="btn btn-danger btn-sm" data-dp="${p.id}">حذف</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">لا توجد قواعد</td></tr>';
  rows.querySelectorAll('[data-dp]').forEach(b => b.onclick = () => confirmBox('حذف القاعدة؟', async () => { await api('/api/admin/post-rules/' + b.dataset.dp, { method: 'DELETE' }); toast('تم الحذف'); loadPostRules(); }));
}
const addPostRuleBtn = $('addPostRule'); if (addPostRuleBtn) addPostRuleBtn.onclick = async () => {
  const post_id = prompt('معرّف المنشور (post_id) أو * للكل:'); if (!post_id) return;
  const answer = prompt('نص الرد على التعليق:'); if (!answer) return;
  const keyword = prompt('كلمة مفتاحية (اتركها فارغة لكل التعليقات):') || '';
  await api('/api/admin/post-rules', { method: 'POST', body: { post_id, answer, keyword, reply_comment: true, notify_admin: true } }); toast('تمت الإضافة ✓'); loadPostRules();
};
})();
