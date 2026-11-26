'use strict';
(() => {
  const state = { info: {}, categories: [], products: [], activeCat: 0, cart: [], customer: null, ads: [], query: '' };
  try { state.cart = JSON.parse(localStorage.getItem('opera_cart') || '[]') || []; } catch { state.cart = []; }
  const $ = id => document.getElementById(id);
  const icons = v => (String(v || '').startsWith('/') || /^https?:/.test(v))
    ? `<img src="${esc(v)}" alt="" onerror="this.style.display='none'">` : esc(v || '🛍️');
  const splitOpts = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const parseJson = (v, fallback) => { try { const d = JSON.parse(v || ''); return d ?? fallback; } catch { return fallback; } };

  function saveCart() { localStorage.setItem('opera_cart', JSON.stringify(state.cart)); renderCart(); }

  async function init() {
    const [info, cats, prods, me, ads] = await Promise.all([
      api('/api/store/info'), api('/api/store/categories'), api('/api/store/products'), api('/api/customer/me'), api('/api/ads?placement=store').catch(() => ({ items: [] })),
    ]);
    state.info = info || {};
    state.categories = cats.items || [];
    state.products = prods.items || [];
    state.customer = me.customer || null;
    state.ads = ads.items || [];
    renderInfo(); renderChips(); renderProducts(); renderCustomer(); renderAds(); wireSearch(); wireScroll();
  }

  function wireScroll() {
    const h = document.querySelector('.site-header');
    const on = () => h && h.classList.toggle('scrolled', window.scrollY > 12);
    window.addEventListener('scroll', on, { passive: true }); on();
  }
  function wireSearch() {
    const inp = $('searchInput');
    if (!inp || inp.dataset.wired) return;
    inp.dataset.wired = '1';
    inp.oninput = () => { state.query = inp.value.trim(); renderProducts(); };
  }

  function adCard(a, badge) {
    const img = a.image_url ? `<img src="${esc(a.image_url)}" alt="" onerror="this.style.display='none'">` : '';
    const inner = `${badge ? `<span class="ad-badge">${esc(badge)}</span>` : ''}${img}
      <div><h3>${esc(a.title || '')}</h3>${a.body ? `<p>${esc(a.body)}</p>` : ''}
      ${a.cta || a.link_url ? `<span class="ad-cta">${esc(a.cta || 'تفاصيل')} ←</span>` : ''}</div>`;
    const kindCls = `kind-${esc(a.kind || 'banner')}`;
    if (a.link_url) return `<a class="ad-card ${kindCls}" href="${esc(a.link_url)}" target="_blank" rel="noopener">${inner}</a>`;
    return `<div class="ad-card ${kindCls}">${inner}</div>`;
  }
  function renderAds() {
    const hero = $('adsHero'), banner = $('adsBanner');
    const ads = state.ads || [];
    const top = ads.filter(a => (a.kind || 'banner') === 'banner' || a.kind === 'promo');
    if (hero) { hero.innerHTML = top.slice(0, 2).map(a => adCard(a, 'إعلان')).join(''); hero.hidden = !top.length; }
    if (banner) { banner.innerHTML = top.slice(2, 5).map(a => adCard(a, 'عرض')).join(''); banner.hidden = !(top.length > 2); }
  }

  function renderCustomer() {
    const b = $('loginBtn');
    b.textContent = state.customer ? `👤 ${state.customer.name || state.customer.phone}` : '👤 دخول الزبون';
  }

  function renderInfo() {
    const s = state.info;
    if (s.businessName) { $('brandName').textContent = s.businessName; document.title = `${s.businessName} | تسوّق وتكلّم معنا`; }
    if (s.logoUrl && $('brandLogo')) $('brandLogo').src = s.logoUrl;
    if (s.footerText) $('footerText').textContent = s.footerText;
    const wa = String(s.whatsappNumber || '').replace(/\D/g, '');
    const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent('مرحباً، أريد الاستفسار عن منتجاتكم')}` : '';
    if (waUrl) $('waLink').href = waUrl;
    $('waLink').onclick = e => { if (!waUrl) { e.preventDefault(); toast('لم يتم ضبط رقم واتساب بعد', true); } };
    const ms = s.messengerLink || (s.messengerPageId ? `https://m.me/${s.messengerPageId}` : '');
    if (ms) $('msLink').href = ms;
    $('msLink').onclick = e => { if (!ms) { e.preventDefault(); toast('لم يتم ضبط صفحة مسنجر بعد — أضفها من الإعدادات', true); } };
    $('fab').href = waUrl || '#';
    $('fab').onclick = e => { if (!waUrl) { e.preventDefault(); toast('أضف رقم واتساب من الإعدادات', true); } };
  }

  function renderChips() {
    $('categoryChips').innerHTML = `<button class="chip${state.activeCat === 0 ? ' active' : ''}" data-cat="0">الكل</button>` +
      state.categories.map(c => `<button class="chip${state.activeCat === c.id ? ' active' : ''}" data-cat="${c.id}">${esc(c.icon && !c.icon.startsWith('/') ? c.icon : '📦')} ${esc(c.name_ar)}</button>`).join('');
    $('categoryChips').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      const catId = Number(b.dataset.cat);
      if (catId === 0) { state.activeCat = 0; renderChips(); renderProducts(); return; }
      openCategory(catId);
    });
  }

  function openCategory(id) {
    const c = state.categories.find(x => x.id === id);
    if (!c) return;
    const prods = state.products.filter(p => p.category_id === id);
    const html = `<div class="row" style="gap:12px;align-items:center;">
        <div style="font-size:44px;">${esc(c.icon && !c.icon.startsWith('/') ? c.icon : '📦')}</div>
        <div><h3 style="margin:0;">${esc(c.name_ar)}</h3><div class="small muted">${esc(c.name_en || '')}</div></div>
      </div>
      ${c.description ? `<p class="small muted">${esc(c.description)}</p>` : ''}
      <div style="margin-top:12px;">
      ${prods.map(p => `<div class="between" style="padding:8px 0;border-bottom:1px solid #f0f3f7;">
        <div class="row" style="gap:10px;">
          <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;background:#f2f6f9;display:flex;align-items:center;justify-content:center;">${icons(p.image_url || p.icon)}</div>
          <div><b class="small">${esc(p.name_ar)}</b><div class="small muted">${money(p.price, state.info.currency)}</div></div>
        </div>
        <button class="btn btn-primary btn-sm" data-addp="${p.id}">＋ أضف</button>
      </div>`).join('')}
      </div>
      ${!prods.length ? `<div class="empty small" style="padding:16px;">لا توجد منتجات في هذا الصنف بعد</div>` : ''}`;
    const m = modal('🗂️ صنف: ' + c.name_ar, html);
    m.el.querySelectorAll('[data-addp]').forEach(b => b.onclick = () => {
      const p = state.products.find(x => x.id === Number(b.dataset.addp));
      m.close(); openProductModal(p);
    });
  }

  function openProductModal(p) {
    const cur = state.info.currency || '';
    const cat = state.categories.find(c => c.id === p.category_id);
    const colors = splitOpts(p.colors_json).length ? splitOpts(p.colors_json) : (cat ? splitOpts(cat.colors_json) : []);
    const sizes = splitOpts(p.sizes_json).length ? splitOpts(p.sizes_json) : (cat ? splitOpts(cat.sizes_json) : []);
    const gallery = parseJson(p.images_json, []);
    const images = gallery.length ? gallery : (p.image_url ? [p.image_url] : []);
    const colorMap = parseJson(p.color_images_json, {});
    const related = state.products.filter(x => x.id !== p.id && x.category_id === p.category_id && Number(x.stock) > 0).slice(0, 6);
    const out = Number(p.stock) <= 0;
    const discount = p.old_price && Number(p.old_price) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;
    const favs = () => { try { return JSON.parse(localStorage.getItem('opera_favs') || '[]'); } catch { return []; } };
    const isFav = () => favs().map(Number).includes(Number(p.id));
    const mainImg = (colorMap[colors[0]] || images[0] || p.image_url || p.icon);
    pushRecent(p.id);
    const html = `<div class="pd">
      <div class="pd-gallery"><div class="pd-main" id="pm_img">${icons(mainImg)}</div>
        <div class="pd-thumbs" id="pm_thumbs">${(images.length ? images : [p.icon]).map((u, i) => `<button type="button" class="pd-thumb${i===0?' active':''}" data-i="${i}"><img src="${esc(u)}" onerror="this.style.display='none'"></button>`).join('')}</div></div>
      <div class="pd-info">
        ${discount ? `<span class="pd-badge">خصم ${discount}%</span>` : ''}${out ? `<span class="pd-badge bad">نفد المخزون</span>` : `<span class="pd-badge ok">متوفر ${esc(p.stock)}</span>`}
        <h2 class="pd-title">${esc(p.name_ar)}</h2>${p.name_en ? `<div class="small muted">${esc(p.name_en)}</div>` : ''}${cat ? `<div class="small muted">الصنف: ${esc(cat.name_ar)}</div>` : ''}
        <div class="pd-price">${money(p.price, cur)}${p.old_price ? ` <s>${money(p.old_price, cur)}</s>` : ''}</div>
        ${p.avg_rating ? `<div class="small" style="color:#e6a23c;">⭐ ${Number(p.avg_rating).toFixed(1)} · ${p.rating_count} تقييم</div>` : ''}
        ${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ''}
        ${colors.length ? `<div class="pd-opt"><label>اللون</label><div class="pd-choices" id="pm_colors">${colors.map((c,i)=>`<button type="button" class="pd-choice${i===0?' active':''}" data-color="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}
        ${sizes.length ? `<div class="pd-opt"><label>المقاس</label><div class="pd-choices" id="pm_sizes">${sizes.map((s,i)=>`<button type="button" class="pd-choice${i===0?' active':''}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
        <div class="pd-opt"><label>الكمية</label><div class="pd-qty"><button type="button" id="pm_minus">−</button><input id="pm_qty" type="number" min="1" value="1"><button type="button" id="pm_plus">+</button></div></div>
        <div class="pd-actions"><button class="btn btn-ghost" id="pm_fav">${isFav()?'❤️':'🤍'} مفضّلة</button><button class="btn btn-ghost" id="pm_share">🔗 مشاركة</button></div>
        <div class="modal-foot" style="border:0;"><button class="btn btn-ghost" id="pm_add" ${out?'disabled':''}>🛒 أضف للسلة</button><button class="btn btn-primary" id="pm_order" ${out?'disabled':''}>⚡ طلب مباشر</button></div>
      </div></div>
      ${related.length ? `<div class="pd-related"><h4>قد يعجبك أيضاً</h4><div class="pd-related-grid">${related.map(r=>`<button type="button" class="pd-related-item" data-rel="${r.id}">${icons(r.image_url||r.icon)}<span>${esc(r.name_ar)}</span><b>${money(r.price,cur)}</b></button>`).join('')}</div></div>` : ''}`;
    const mm = modal('🛍️ ' + p.name_ar, html);
    const root = mm.el; let selColor = colors[0] || ''; let selSize = sizes[0] || '';
    const curImages = () => images.length ? images : [p.icon];
    const setMain = (url) => { const el = root.querySelector('#pm_img'); if (el) el.innerHTML = icons(url); };
    root.querySelectorAll('.pd-thumb').forEach(b => b.onclick = () => { root.querySelectorAll('.pd-thumb').forEach(x => x.classList.remove('active')); b.classList.add('active'); setMain(curImages()[Number(b.dataset.i)] || mainImg); });
    root.querySelectorAll('#pm_colors .pd-choice').forEach(b => b.onclick = () => { root.querySelectorAll('#pm_colors .pd-choice').forEach(x => x.classList.remove('active')); b.classList.add('active'); selColor = b.dataset.color || ''; if (colorMap[selColor]) setMain(colorMap[selColor]); });
    root.querySelectorAll('#pm_sizes .pd-choice').forEach(b => b.onclick = () => { root.querySelectorAll('#pm_sizes .pd-choice').forEach(x => x.classList.remove('active')); b.classList.add('active'); selSize = b.dataset.size || ''; });
    const qty = () => Math.max(1, Number(root.querySelector('#pm_qty')?.value) || 1);
    const step = d => { const i = root.querySelector('#pm_qty'); i.value = Math.max(1, qty() + d); };
    root.querySelector('#pm_minus')?.addEventListener('click', () => step(-1));
    root.querySelector('#pm_plus')?.addEventListener('click', () => step(1));
    const opts = () => [selColor, selSize].filter(Boolean).join(' / ');
    root.querySelector('#pm_add')?.addEventListener('click', () => { addToCartQty(p.id, opts(), qty()); });
    root.querySelector('#pm_order')?.addEventListener('click', () => { addToCartQty(p.id, opts(), qty(), true); mm.close(); checkout(); });
    root.querySelector('#pm_fav')?.addEventListener('click', (e) => { const f = favs(); const i = f.map(Number).indexOf(Number(p.id)); if (i >= 0) f.splice(i, 1); else f.push(Number(p.id)); localStorage.setItem('opera_favs', JSON.stringify(f)); e.target.textContent = (i < 0 ? '❤️' : '🤍') + ' مفضّلة'; });
    root.querySelector('#pm_share')?.addEventListener('click', async () => { const url = location.origin + '/#p' + p.id; try { if (navigator.share) await navigator.share({ title: p.name_ar, url }); else { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط ✓'); } } catch { toast(url); } });
    root.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => { const r = state.products.find(x => x.id === Number(b.dataset.rel)); mm.close(); openProductModal(r); });
  }

  function addToCartQty(id, options, qty, silent) {
    const p = state.products.find(x => x.id === id); if (!p || Number(p.stock) <= 0) return;
    const key = `${id}|${options}`; const exist = state.cart.find(x => x.key === key);
    if (exist) exist.qty += qty; else state.cart.push({ key, id, name: p.name_ar, price: p.price, qty, icon: p.image_url || p.icon, options });
    saveCart(); toast(`تمت الإضافة للسلة: ${p.name_ar}`);
  }
  function pushRecent(id) { try { const r = JSON.parse(localStorage.getItem('opera_recent') || '[]'); localStorage.setItem('opera_recent', JSON.stringify([Number(id), ...r.filter(x => Number(x) !== Number(id))].slice(0, 12))); } catch {} }


  function renderProducts() {
    const norm = s => String(s || '').toLowerCase();
    const q = norm(state.query);
    let list = state.activeCat ? state.products.filter(p => p.category_id === state.activeCat) : state.products;
    if (q) list = list.filter(p => norm(p.name_ar).includes(q) || norm(p.name_en).includes(q) || norm(p.description).includes(q));
    $('productCount').textContent = `${list.length} منتج`;
    if (!list.length) { $('productGrid').innerHTML = `<div class="empty" style="grid-column:1/-1;"><span class="big">📭</span>${q ? 'لا توجد نتائج لبحثك' : 'لا توجد منتجات في هذا الصنف'}</div>`; return; }
    const cur = state.info.currency || '';
    const catOf = id => state.categories.find(c => c.id === id);
    $('productGrid').innerHTML = list.map(p => {
      const cat = catOf(p.category_id);
      const colors = splitOpts(p.colors_json).length ? splitOpts(p.colors_json) : (cat ? splitOpts(cat.colors_json) : []);
      const sizes = splitOpts(p.sizes_json).length ? splitOpts(p.sizes_json) : (cat ? splitOpts(cat.sizes_json) : []);
      const gallery = parseJson(p.images_json, []);
      const images = gallery.length ? gallery : (p.image_url ? [p.image_url] : []);
      const colorMap = parseJson(p.color_images_json, {});
      const first = colorMap[colors[0]] || images[0] || p.icon;
      const out = Number(p.stock) <= 0;
      const opts = (colors.length || sizes.length) ? `<div class="product-info" style="padding:0 14px 6px;">
        ${colors.length ? `<label class="small">اللون</label><select data-color="${p.id}" class="small">${colors.map(c => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
        ${sizes.length ? `<label class="small">المقاس</label><select data-size="${p.id}" class="small">${sizes.map(s => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
      </div>` : '';
      const thumbs = images.length > 1 ? `<div class="row wrap" style="padding:6px 12px 2px;gap:6px;">
        ${images.map((u, i) => `<button type="button" data-thumb="${p.id}" data-i="${i}" style="border:0;background:none;padding:0;">
          <img src="${esc(u)}" style="width:38px;height:38px;object-fit:cover;border-radius:7px;border:2px solid ${i === 0 ? 'var(--teal)' : 'transparent'};"></button>`).join('')}
      </div>` : '';
      return `<article class="product-card${out ? ' stock-out' : ''}">
        <div class="product-img" id="pimg-${p.id}" data-detail="${p.id}">${icons(first)}</div>
        ${thumbs}
        <div class="product-info"><h3 data-detail="${p.id}" style="cursor:pointer;">${esc(p.name_ar)}</h3><p>${esc(p.description || 'بدون وصف')}</p>
          <div class="price">${money(p.price, cur)}${p.old_price ? `<s>${money(p.old_price, cur)}</s>` : ''}</div>
          ${p.avg_rating ? `<div class="small" style="color:#e6a23c;">⭐ ${Number(p.avg_rating).toFixed(1)} · ${p.rating_count} تقييم</div>` : ''}
          <div class="product-foot"><span class="small muted">${out ? 'نفد المخزون' : `المتوفر: ${p.stock}`}</span>
            <button class="btn btn-primary btn-sm" data-add="${p.id}" ${out ? 'disabled' : ''}>＋ أضف</button></div>
        </div>${opts}
      </article>`;
    }).join('');
    const setImage = (id, url) => { const el = $(`pimg-${id}`); if (el) el.innerHTML = icons(url); };
    $('productGrid').querySelectorAll('[data-color]').forEach(s => s.onchange = () => {
      const id = Number(s.dataset.color);
      const p = state.products.find(x => x.id === id);
      const map = parseJson(p?.color_images_json, {});
      const gallery = parseJson(p?.images_json, []);
      setImage(id, map[s.value] || gallery[0] || p?.image_url || p?.icon);
    });
    $('productGrid').querySelectorAll('[data-thumb]').forEach(b => b.onclick = () => {
      const id = Number(b.dataset.thumb);
      const p = state.products.find(x => x.id === id);
      const gallery = parseJson(p?.images_json, []);
      const url = gallery[Number(b.dataset.i)];
      setImage(id, url);
      b.parentElement.querySelectorAll('[data-thumb] img').forEach(im => im.style.border = '2px solid transparent');
      b.querySelector('img').style.border = '2px solid var(--teal)';
    });
    $('productGrid').querySelectorAll('[data-detail]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const p = state.products.find(x => x.id === Number(b.dataset.detail)); if (p) openProductModal(p); });
    $('productGrid').querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      const id = Number(b.dataset.add);
      const color = $(`[data-color="${id}"]`)?.value || '';
      const size = $(`[data-size="${id}"]`)?.value || '';
      addToCart(id, [color, size].filter(Boolean).join(' / '));
    });
  }

  function addToCart(id, options) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    const key = `${id}|${options}`;
    const exist = state.cart.find(x => x.key === key);
    if (exist) exist.qty += 1;
    else state.cart.push({ key, id, name: p.name_ar, price: p.price, qty: 1, icon: p.image_url || p.icon, options });
    saveCart(); toast(`تمت الإضافة للسلة: ${p.name_ar}`); openCart();
  }

  function renderCart() {
    const count = state.cart.reduce((s, i) => s + i.qty, 0);
    $('cartCount').textContent = count;
    const cur = state.info.currency || '';
    if (!state.cart.length) {
      $('cartItems').innerHTML = `<div class="empty"><span class="big">🛒</span>سلتك فارغة حالياً</div>`;
      $('cartTotal').textContent = money(0, cur); $('checkoutBtn').disabled = true; return;
    }
    $('checkoutBtn').disabled = false;
    const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = subtotal >= (state.info.deliveryFreeThreshold || 0) ? 0 : (state.info.deliveryFee || 0);
    $('cartTotal').textContent = money(subtotal + fee, cur);
    $('cartItems').innerHTML = state.cart.map(i => `<div class="cart-item">
      <div class="thumb">${icons(i.icon)}</div>
      <div class="grow"><b class="small">${esc(i.name)}</b>${i.options ? `<div class="small muted">${esc(i.options)}</div>` : ''}<div class="small muted">${money(i.price, cur)}</div></div>
      <div class="qty"><button data-q="-1" data-key="${esc(i.key)}">−</button><b>${i.qty}</b><button data-q="1" data-key="${esc(i.key)}">＋</button></div>
      <button class="icon-btn" data-del="${esc(i.key)}">✕</button></div>`).join('');
    $('cartItems').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const item = state.cart.find(x => x.key === b.dataset.key);
      if (!item) return;
      item.qty += Number(b.dataset.q);
      if (item.qty <= 0) state.cart = state.cart.filter(x => x !== item);
      saveCart();
    });
    $('cartItems').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      state.cart = state.cart.filter(x => x.key !== b.dataset.del); saveCart();
    });
  }

  function openCart() { $('cartDrawer').classList.remove('hidden'); $('drawerOverlay').classList.remove('hidden'); }
  function closeCart() { $('cartDrawer').classList.add('hidden'); $('drawerOverlay').classList.add('hidden'); }

  // ------------------------- customer login -------------------------
  function loginModal(after) {
    const m = modal('دخول الزبون 👤', `<div id="loginEmail">
      <p class="small muted">سجّل برقم الجوال — سنرسل لك رمز تحقق من ٦ أرقام (وضع تجربة هنا).</p>
      <div class="form-row"><label>رقم الجوال</label><input id="loginPhone" dir="ltr" placeholder="2189xxxxxxxx"></div>
      <button class="btn btn-primary" id="sendCode">إرسال الرمز</button></div>
      <div id="loginStep2" class="hidden">
      <div class="form-row"><label>رمز التحقق</label><input id="loginCode" dir="ltr" maxlength="6" placeholder="000000"></div>
      <div id="demoCode" class="small pill warn"></div>
      <button class="btn btn-primary" id="verifyCode" style="margin-top:12px;">تأكيد الرمز</button>
      <button class="btn btn-ghost btn-sm" id="resendCode" style="margin-top:8px;">إرسال رمز جديد</button></div>`);
    const send = async () => {
      const r = await api('/api/customer/send-code', { method: 'POST', body: { phone: $('loginPhone').value } });
      if (!r.ok) { toast(r.error || 'تعذر الإرسال', true); return; }
      $('loginStep1').classList.add('hidden'); $('loginStep2').classList.remove('hidden');
      $('demoCode').textContent = `رمز التجربة: ${r.demoCode}`;
      toast('تم إرسال الرمز');
    };
    m.el.querySelector('#sendCode').onclick = send;
    m.el.querySelector('#resendCode').onclick = send;
    m.el.querySelector('#verifyCode').onclick = async () => {
      const r = await api('/api/customer/verify', { method: 'POST', body: { phone: $('loginPhone').value, code: $('loginCode').value } });
      if (!r.ok) { toast(r.error || 'رمز غير صحيح', true); return; }
      state.customer = r.customer; renderCustomer(); m.close(); toast('تم التسجيل عبر رقم الجوال ✓');
      profileModal(); if (after) after();
    };
  }

  function profileModal() {
    const c = state.customer || {};
    const m = modal('بيانات الزبون 📍', `<form id="profileForm">
      <div class="form-row"><label>الاسم</label><input id="pf_name" value="${esc(c.name || '')}" required></div>
      <div class="form-row two"><div><label>المدينة</label><input id="pf_city" value="${esc(c.city || '')}"></div>
      <div><label>الدولة</label><input id="pf_country" value="${esc(state.info.country || 'ليبيا')}" readonly></div></div>
      <div class="form-row"><label>العنوان</label><input id="pf_address" value="${esc(c.address || '')}"></div>
      <div class="row wrap"><button type="button" class="btn btn-ghost btn-sm" id="openMap">🗺️ تحديد الموقع على الخريطة</button>
      <button type="button" class="btn btn-outline btn-sm" id="geoBtn">📡 موقعي تلقائياً</button>
      <span id="coords" class="small muted">${c.latitude ? `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}` : 'لم يتم تحديد الموقع'}</span></div>
      <div class="form-row two"><div><label>إحداثي العرض (قابل للتعديل يدوياً)</label><input type="number" step="0.0001" id="pf_lat_v" value="${(c.latitude || 0).toFixed(4)}" style="width:100%;"></div>
      <div><label>إحداثي الطول (قابل للتعديل يدوياً)</label><input type="number" step="0.0001" id="pf_lng_v" value="${(c.longitude || 0).toFixed(4)}" style="width:100%;"></div></div>
      <p class="small muted">نصح بالتصحيح إذا كان موقع الخريطة غير دقيق في منطقتك.</p>
      <input type="hidden" id="pf_lat" value="${c.latitude || 0}"><input type="hidden" id="pf_lng" value="${c.longitude || 0}">
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ البيانات</button></div>
    </form>`);
    m.el.querySelector('#geoBtn').onclick = () => locate(true);
    m.el.querySelector('#openMap').onclick = () => mapModal();
    const syncManual = () => { const v = $('pf_lat_v'), l = $('pf_lng_v'); if (v) $('pf_lat').value = v.value || 0; if (l) $('pf_lng').value = l.value || 0; };
    m.el.querySelector('#openMap').onclick = () => { syncManual(); mapModal(); };
    m.el.querySelector('#profileForm').onsubmit = async e => {
      e.preventDefault();
      syncManual();
      const r = await api('/api/customer/profile', { method: 'PUT', body: {
        name: $('pf_name').value, city: $('pf_city').value, address: $('pf_address').value,
        latitude: Number($('pf_lat').value), longitude: Number($('pf_lng').value),
      } });
      if (r.ok) { state.customer = r.customer; renderCustomer(); m.close(); toast('تم حفظ بياناتك ✓'); }
      else toast(r.error || 'تعذر الحفظ', true);
    };

    async function locate(setOnMap) {
      if (!navigator.geolocation) { toast('المتصفح لا يدعم تحديد الموقع', true); return; }
      navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude, longitude } = pos.coords;
        $('pf_lat').value = latitude; $('pf_lng').value = longitude;
        $('coords').textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const d = await res.json();
          const a = d.address || {};
          if (a.city || a.town || a.village) $('pf_city').value = a.city || a.town || a.village;
          if (d.display_name) $('pf_address').value = d.display_name.slice(0, 200);
        } catch {}
        if (setOnMap && window.__map) window.__map.setView([latitude, longitude], 15);
        toast('تم تحديد موقعك ✓');
      }, () => toast('تعذر الحصول على الموقع — تحقق من صلاحيات المتصفح', true));
    }
  }

  function mapModal() {
    if (window.__mapModal) window.__mapModal.close();
    const m = modal('اختر موقعك على الخريطة 🗺️', `<div id="mapDiv" style="height:340px;border-radius:12px;overflow:hidden;background:#e8eef4;"></div>
      <p class="small muted">اضغط على الخريطة لاختيار نقطة، أو استخدم زر «موقعي تلقائياً».</p>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>إلغاء</button><button type="button" class="btn btn-outline" id="geoAuto">📍 موقعي تلقائياً (دقيق)</button><button class="btn btn-primary" id="pickLocation">استخدام هذه النقطة</button></div>`, { wide: true });
    window.__mapModal = m;
    const latEl = $('pf_lat') || $('co_lat') || document.createElement('input');
    const lngEl = $('pf_lng') || $('co_lng') || document.createElement('input');
    const coordsEl = $('coords') || $('coCoords');
    let lat = Number(latEl.value) || 32.89, lng = Number(lngEl.value) || 13.19;
    let marker;
    if (window.L) {
      const map = L.map('mapDiv').setView([lat, lng], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      map.on('click', e => { lat = e.latlng.lat; lng = e.latlng.lng; marker.setLatLng(e.latlng); });
      marker.on('dragend', () => { lat = marker.getLatLng().lat; lng = marker.getLatLng().lng; });
      window.__map = map;
    } else {
      $('mapDiv').innerHTML = '<div class="empty">تعذر تحميل الخريطة — تحقق من الإنترنت، أو أدخل العنوان يدوياً</div>';
    }
    m.el.querySelector('#pickLocation').onclick = async () => {
      latEl.value = lat; lngEl.value = lng;
      if (coordsEl) coordsEl.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const mv = $('pf_lat_v'), mn = $('pf_lng_v'); if (mv) mv.value = lat.toFixed(4); if (mn) mn.value = lng.toFixed(4);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const d = await res.json(); const a = d.address || {};
        if (a.city || a.town) $('pf_city').value = a.city || a.town;
        if (d.display_name) $('pf_address').value = d.display_name.slice(0, 200);
      } catch {}
      window.__map = null; m.close(); toast('تم تحديد الموقع ✓');
    };
    // تحديد موقع دقيق تلقائياً بالـ GPS
    m.el.querySelector('#geoAuto')?.addEventListener('click', () => {
      if (!navigator.geolocation) { toast('المتصفح لا يدعم تحديد الموقع', true); return; }
      toast('جارٍ تحديد موقعك بدقة...');
      navigator.geolocation.getCurrentPosition(pos => {
        lat = pos.coords.latitude; lng = pos.coords.longitude;
        latEl.value = lat; lngEl.value = lng;
        if (marker) marker.setLatLng([lat, lng]);
        if (window.__map) window.__map.setView([lat, lng], 16);
        if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        toast(`تم تحديد موقعك بدقة (±${Math.round(pos.coords.accuracy || 0)}م) ✓`);
      }, () => toast('تعذر الحصول على الموقع — فعّل الـ GPS وأذن المتصفح', true), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  // ------------------------- checkout -------------------------
  function checkout() {
    if (!state.cart.length) return;
    if (!state.customer) { loginModal(() => checkout()); return; }
    const c = state.customer;
    const cur = state.info.currency || '';
    const fee = state.cart.reduce((s, i) => s + i.price * i.qty, 0) >= (state.info.deliveryFreeThreshold || 0) ? 0 : (state.info.deliveryFee || 0);
    const m = modal('إتمام الطلب 🧾', `<form id="checkoutForm">
      <div class="form-row two"><div><label>الاسم</label><input id="co_name" value="${esc(c.name || '')}" required></div>
      <div><label>الجوال</label><input id="co_phone" dir="ltr" value="${esc(c.phone)}" required></div></div>
      <div class="form-row two"><div><label>المدينة</label><input id="co_city" value="${esc(c.city || '')}"></div>
      <div><label>الدولة</label><input value="${esc(state.info.country || 'ليبيا')}" readonly></div></div>
      <div class="form-row"><label>العنوان</label><input id="co_address" value="${esc(c.address || '')}"></div>
      <div class="row"><button type="button" class="btn btn-ghost btn-sm" id="coMap">🗺️ تعديل الموقع</button><button type="button" class="btn btn-ghost btn-sm" id="coGeo">📍 تحديد موقعي بدقة</button>
      <span class="small muted" id="coCoords">${c.latitude ? `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}` : 'بدون موقع'}</span></div>
      <input type="hidden" id="co_lat" value="${c.latitude || 0}"><input type="hidden" id="co_lng" value="${c.longitude || 0}">
      <div class="form-row two"><div><label>طريقة التوصيل</label><select id="co_method">${(state.info.deliveryMethods || ['توصيل للمنزل', 'استلام من المتجر']).map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div><label>رسوم التوصيل</label><input id="co_fee" readonly value="${money(state.info.deliveryFee || 0, cur)}"></div></div>
      <p class="small muted">${esc(state.info.deliveryNote || '')}</p>
      <div class="form-row" style="margin-top:12px;"><label>ملاحظات</label><textarea id="co_notes" style="min-height:70px;"></textarea></div>
      <div class="card" style="box-shadow:none;background:#f6f9fb;padding:12px;"><div class="between">
        <span>المجموع الفرعي</span><b style="color:var(--teal-dark);font-size:14px;">${money(state.cart.reduce((s,i)=>s+i.price*i.qty,0), cur)}</b></div>
        <div class="between" style="margin-top:6px;"><span>رسوم التوصيل</span><b style="font-size:14px;">${money(fee, cur)}</b></div>
        <div class="between" style="margin-top:6px;"><span><b>الإجمالي</b></span><b style="color:var(--teal-dark);font-size:18px;">${money(state.cart.reduce((s,i)=>s+i.price*i.qty,0) + fee, cur)}</b></div></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" type="submit">تأكيد الطلب</button></div>
    </form>`);
    m.el.querySelector('#coMap').onclick = () => mapModal();
    m.el.querySelector('#coGeo')?.addEventListener('click', () => {
      if (!navigator.geolocation) { toast('المتصفح لا يدعم تحديد الموقع', true); return; }
      toast('جارٍ تحديد موقعك بدقة...');
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        $('co_lat').value = latitude; $('co_lng').value = longitude;
        $('coCoords').textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        toast(`تم تحديد موقعك بدقة (±${Math.round(pos.coords.accuracy || 0)}م) ✓`);
      }, () => toast('تعذر الحصول على الموقع — فعّل الـ GPS', true), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
    m.el.querySelector('#checkoutForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = '...';
      const r = await api('/api/store/orders', { method: 'POST', body: {
        customer_name: $('co_name').value, phone: $('co_phone').value, address: $('co_address').value,
        notes: $('co_notes').value, items_json: JSON.stringify(state.cart),
        delivery_method: $('co_method').value,
        latitude: Number($('co_lat').value), longitude: Number($('co_lng').value),
      } });
      btn.disabled = false; btn.textContent = 'تأكيد الطلب';
      if (!r.ok) { toast(r.error || 'تعذر إرسال الطلب', true); return; }
      state.cart = []; saveCart(); closeCart(); m.close();
      const wa = String(state.info.whatsappNumber || '').replace(/\D/g, '');
      const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`مرحباً، أرسلت الطلب رقم ${r.orderId}`)}` : '';
      const payLines = [];
      if (state.info.paymentMethods) payLines.push(`💳 طرق الدفع: ${state.info.paymentMethods}`);
      if (state.info.bankInfo) payLines.push(`🏦 الحساب البنكي: ${state.info.bankInfo}`);
      modal('تم استلام طلبك ✅', `<div class="center"><div style="font-size:44px;">🎉</div>
        <p>طلبك رقم <b>#${r.orderId}</b> وصلنا وسيتم التواصل معك قريباً.</p>
        ${payLines.length ? `<div class="card" style="box-shadow:none;background:#f6f9fb;padding:12px;margin-top:10px;text-align:right;">${payLines.map(l => `<div>${l}</div>`).join('')}</div>` : ''}
        ${waUrl ? `<a class="btn btn-primary" href="${waUrl}" target="_blank" rel="noopener">📱 متابعة على واتساب</a>` : ''}</div>`);
    });
  }

  function assistantInfo() {
    const s = state.info;
    const wa = String(s.whatsappNumber || '').replace(/\D/g, '');
    const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent('مرحباً، لدي سؤال')}` : '';
    const ms = s.messengerLink || (s.messengerPageId ? `https://m.me/${s.messengerPageId}` : '');
    modal('تكلّم مع المساعد الذكي 🤖', `<div class="small" style="line-height:2;">
      <p>مساعدنا يرد تلقائياً على استفساراتك عن المنتجات والأسعار والتوصيل والطلبات على مدار الساعة.</p>
      <div class="row wrap" style="gap:8px;margin-top:14px;">
        ${waUrl ? `<a class="btn btn-primary" href="${waUrl}" target="_blank" rel="noopener">📱 واتساب</a>` : `<span class="pill warn">رقم واتساب غير مضبوط</span>`}
        ${ms ? `<a class="btn btn-outline" href="${ms}" target="_blank" rel="noopener">💬 مسنجر</a>` : `<span class="pill warn">صفحة مسنجر غير مضبوطة</span>`}
      </div></div>`);
  }

  $('cartBtn').onclick = openCart;
  $('closeCart').onclick = closeCart;
  $('drawerOverlay').onclick = closeCart;
  $('checkoutBtn').onclick = checkout;
  $('assistantBtn').onclick = assistantInfo;
  $('heroChat').onclick = assistantInfo;
  $('loginBtn').onclick = () => state.customer ? profileModal() : loginModal();
  init();
})();
