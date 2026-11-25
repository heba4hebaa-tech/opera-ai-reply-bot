'use strict';
(() => {
  const state = { info: {}, categories: [], products: [], activeCat: 0, cart: [], customer: null };
  try { state.cart = JSON.parse(localStorage.getItem('opera_cart') || '[]') || []; } catch { state.cart = []; }
  const $ = id => document.getElementById(id);
  const icons = v => (String(v || '').startsWith('/') || /^https?:/.test(v))
    ? `<img src="${esc(v)}" alt="" onerror="this.style.display='none'">` : esc(v || '🛍️');
  const splitOpts = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const parseJson = (v, fallback) => { try { const d = JSON.parse(v || ''); return d ?? fallback; } catch { return fallback; } };

  function saveCart() { localStorage.setItem('opera_cart', JSON.stringify(state.cart)); renderCart(); }

  async function init() {
    const [info, cats, prods, me] = await Promise.all([
      api('/api/store/info'), api('/api/store/categories'), api('/api/store/products'), api('/api/customer/me'),
    ]);
    state.info = info || {};
    state.categories = cats.items || [];
    state.products = prods.items || [];
    state.customer = me.customer || null;
    renderInfo(); renderChips(); renderProducts(); renderCustomer();
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
      state.activeCat = Number(b.dataset.cat); renderChips(); renderProducts();
    });
  }

  function renderProducts() {
    const list = state.activeCat ? state.products.filter(p => p.category_id === state.activeCat) : state.products;
    $('productCount').textContent = `${list.length} منتج`;
    if (!list.length) { $('productGrid').innerHTML = `<div class="empty" style="grid-column:1/-1;"><span class="big">📭</span>لا توجد منتجات في هذا الصنف</div>`; return; }
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
        <div class="product-img" id="pimg-${p.id}">${icons(first)}</div>
        ${thumbs}
        <div class="product-info"><h3>${esc(p.name_ar)}</h3><p>${esc(p.description || 'بدون وصف')}</p>
          <div class="price">${money(p.price, cur)}${p.old_price ? `<s>${money(p.old_price, cur)}</s>` : ''}</div>
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
      <p class="small muted">سجّل بالبريد الإلكتروني — مجاني بلا كود SMS.</p>
      <div class="form-row"><label>البريد الإلكتروني</label><input id="loginEmailBox" type="email" dir="ltr" required></div>
      <button class="btn btn-primary" id="signInEmail">سجّل بالبريد الإلكتروني</button></div>
      <hr style="margin:16px 0;"><div id="loginStep1">
      <p class="small muted">أو سجّل برقم الجوال — سنرسل لك رمز تحقق من ٦ أرقام (وضع تجربة هنا).</p>
      <div class="form-row"><label>رقم الجوال</label><input id="loginPhone" dir="ltr" placeholder="2189xxxxxxxx"></div>
      <button class="btn btn-primary" id="sendCode">إرسال الرمز</button></div>
      <div id="loginStep2" class="hidden">
      <div class="form-row"><label>رمز التحقق</label><input id="loginCode" dir="ltr" maxlength="6" placeholder="000000"></div>
      <div id="demoCode" class="small pill warn"></div>
      <button class="btn btn-primary" id="verifyCode" style="margin-top:12px;">تأكيد الرمز</button>
      <button class="btn btn-ghost btn-sm" id="resendCode" style="margin-top:8px;">إرسال رمز جديد</button></div>`);
    const done = () => { state.customer = true; renderCustomer(); m.close(); profileModal(); if (after) after(); };
    m.el.querySelector('#signInEmail').onclick = async () => {
      const r = await api('/api/customer/signin-email', { method: 'POST', body: { email: $('loginEmailBox').value } });
      if (r.ok) { state.customer = r.customer; renderCustomer(); toast('تم تسجيل الدخول بالبريد ✓'); profileModal(); if (after) after(); m.close(); }
      else toast(r.error || 'تعذر الدخول', true);
    };
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
      state.customer = r.customer; renderCustomer(); m.close(); toast('تم تسجيل الدخول ✓');
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
      <div class="modal-foot"><button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="pickLocation">استخدام هذه النقطة</button></div>`, { wide: true });
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
      <div class="row"><button type="button" class="btn btn-ghost btn-sm" id="coMap">🗺️ تعديل الموقع</button>
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
      modal('تم استلام طلبك ✅', `<div class="center"><div style="font-size:44px;">🎉</div>
        <p>طلبك رقم <b>#${r.orderId}</b> وصلنا وسيتم التواصل معك قريباً.</p>
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
