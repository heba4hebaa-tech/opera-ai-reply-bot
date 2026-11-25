'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const titles = {
    overview: 'نظرة عامة', categories: 'الأصناف', products: 'المنتجات', orders: 'الطلبات',
    conversations: 'المحادثات', faqs: 'الأسئلة الشائعة', tester: 'اختبار الرد', settings: 'الإعدادات', security: 'كلمة المرور',
  };
  const state = { me: null, categories: [], products: [] };
  const statusClass = s => ({ 'جديد': 'warn', 'قيد التحضير': 'ok', 'تم الشحن': '', 'مكتمل': 'ok', 'ملغي': 'bad' }[s] || '');

  async function boot() {
    const me = await api('/api/auth/me');
    if (!me.user) { location.href = '/login'; return; }
    state.me = me.user;
    wireNav();
    await Promise.all([loadOverview(), loadCategories(), loadProducts(), loadOrders(), loadConversations(), loadFaqs(), loadSettings()]);
  }

  function wireNav() {
    document.querySelectorAll('.nav-item[data-section]').forEach(b => b.onclick = () => {
      document.querySelectorAll('.nav-item[data-section]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const key = b.dataset.section;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      $('sec-' + key).classList.add('active');
      $('topTitle').textContent = titles[key] || '';
    });
    $('logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; };
  }

  async function loadOverview() {
    const d = await api('/api/admin/dashboard');
    const icons = [
      ['🧾', 'إجمالي الطلبات', d.stats.orders, 'جديد: ' + d.stats.newOrders],
      ['📦', 'المنتجات', d.stats.products, 'متاحة للبيع'],
      ['🗂️', 'الأصناف', d.stats.categories, 'تصنيفات المتجر'],
      ['💬', 'المحادثات', d.stats.conversations, d.stats.messages + ' رسالة'],
    ];
    $('statGrid').innerHTML = icons.map(i => `<div class="stat-card"><div class="ic">${i[0]}</div><div><div class="num">${i[2]}</div><div class="lbl">${i[1]}</div><div class="small muted">${i[3]}</div></div></div>`).join('');
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
      <div class="form-row two"><div><label>الرمز (إيموجي)</label><input name="icon" value="${esc(c.icon || '📦')}"></div>
      <div><label>الترتيب</label><input name="sort_order" type="number" value="${c.sort_order || 0}"></div></div>
      <div class="form-row check"><input type="checkbox" name="active" ${c.active === 0 ? '' : 'checked'}><label>ظاهر للزبائن</label></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
    </form>`);
    m.el.querySelector('#catForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = {
        name_ar: f.get('name_ar'), name_en: f.get('name_en'), description: f.get('description'),
        icon: f.get('icon'), sort_order: Number(f.get('sort_order')), active: f.get('active') === 'on',
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
      <div><label>الرمز (إيموجي)</label><input name="icon" value="${esc(p.icon || '🛍️')}"></div></div>
      <div class="form-row two"><div><label>السعر</label><input name="price" type="number" step="0.01" value="${p.price || 0}"></div>
      <div><label>السعر قبل الخصم</label><input name="old_price" type="number" step="0.01" value="${p.old_price || 0}"></div></div>
      <div class="form-row two"><div><label>المخزون</label><input name="stock" type="number" value="${p.stock || 0}"></div>
      <div><label>رابط الصورة (اختياري)</label><input name="image_url" value="${esc(p.image_url || '')}" placeholder="https://..."></div></div>
      <div class="form-row check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}><label>ظاهر للزبائن</label></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
    </form>`, { wide: true });
    m.el.querySelector('#prodForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = {
        name_ar: f.get('name_ar'), name_en: f.get('name_en'), description: f.get('description'),
        category_id: Number(f.get('category_id')) || null, icon: f.get('icon'), price: Number(f.get('price')),
        old_price: Number(f.get('old_price')), stock: Number(f.get('stock')), image_url: f.get('image_url'),
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
    const statuses = ['جديد', 'قيد التحضير', 'تم الشحن', 'مكتمل', 'ملغي'];
    $('orderRows').innerHTML = d.items.length ? d.items.map(o => `<tr>
      <td><b>#${o.id}</b><div class="small muted">${fmtDate(o.created_at)}</div></td>
      <td><b>${esc(o.customer_name)}</b><div class="small muted">${esc(o.address || '')}</div></td>
      <td dir="ltr" class="small">${esc(o.phone)}</td>
      <td class="small">${o.items.map(i => `${esc(i.name)} ×${i.qty}`).join('، ')}</td>
      <td><b style="color:var(--teal-dark);">${money(o.total, '')}</b></td>
      <td class="small muted">${esc(o.source)}</td>
      <td><select data-os="${o.id}" style="width:auto;padding:5px 8px;">${statuses.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><button class="icon-btn" data-od="${o.id}" title="حذف">🗑️</button></td>
    </tr>`).join('') : `<tr><td colspan="8" class="empty">لا توجد طلبات بعد</td></tr>`;
    $('orderRows').querySelectorAll('[data-os]').forEach(s => s.onchange = async () => {
      await api('/api/admin/orders/' + s.dataset.os, { method: 'PUT', body: { status: s.value } });
      toast('تم تحديث الحالة'); loadOverview();
    });
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
  }

  $('saveSettings').onclick = async () => {
    const keys = ['business_name', 'currency', 'whatsapp_number', 'messenger_link', 'catalog_url', 'ai_enabled', 'greeting', 'footer_text', 'bot_tone'];
    const payload = {};
    for (const k of keys) {
      const el = $('set_' + k);
      payload[k] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
    }
    const r = await api('/api/admin/settings', { method: 'PUT', body: payload });
    if (r.ok) { toast('تم حفظ الإعدادات ✓'); loadOverview(); } else toast(r.error || 'تعذر الحفظ', true);
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
})();
