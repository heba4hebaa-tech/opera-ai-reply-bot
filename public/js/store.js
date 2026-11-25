'use strict';
(() => {
  const state = { info: {}, categories: [], products: [], activeCat: 0, cart: [] };
  try { state.cart = JSON.parse(localStorage.getItem('opera_cart') || '[]') || []; } catch { state.cart = []; }
  const $ = id => document.getElementById(id);

  function saveCart() { localStorage.setItem('opera_cart', JSON.stringify(state.cart)); renderCart(); }

  async function init() {
    const [info, cats, prods] = await Promise.all([
      api('/api/store/info'), api('/api/store/categories'), api('/api/store/products'),
    ]);
    state.info = info || {};
    state.categories = cats.items || [];
    state.products = prods.items || [];
    renderInfo();
    renderChips();
    renderProducts();
  }

  function renderInfo() {
    const s = state.info;
    if (s.businessName) { $('brandName').textContent = s.businessName; document.title = `${s.businessName} | تسوّق وتكلّم معنا`; }
    if (s.footerText) $('footerText').textContent = s.footerText;
    const wa = String(s.whatsappNumber || '').replace(/\D/g, '');
    const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent('مرحباً، أريد الاستفسار عن منتجاتكم')}` : '';
    if (waUrl) $('waLink').href = waUrl;
    $('waLink').onclick = e => { if (!waUrl) { e.preventDefault(); toast('لم يتم ضبط رقم واتساب بعد — أضفه من الإعدادات', true); } };
    const ms = s.messengerLink || '';
    if (ms) $('msLink').href = ms;
    $('msLink').onclick = e => { if (!ms) { e.preventDefault(); toast('لم يتم ضبط رابط مسنجر بعد — أضفه من الإعدادات', true); } };
    $('fab').onclick = e => { if (!waUrl) { e.preventDefault(); toast('أضف رقم واتساب من الإعدادات لتفعيل زر المحادثة', true); } };
    $('fab').href = waUrl || '#';
  }

  function renderChips() {
    $('categoryChips').innerHTML = `<button class="chip${state.activeCat === 0 ? ' active' : ''}" data-cat="0">الكل</button>` +
      state.categories.map(c => `<button class="chip${state.activeCat === c.id ? ' active' : ''}" data-cat="${c.id}">${esc(c.icon || '📦')} ${esc(c.name_ar)}</button>`).join('');
    $('categoryChips').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      state.activeCat = Number(b.dataset.cat); renderChips(); renderProducts();
    });
  }

  function renderProducts() {
    const list = state.activeCat ? state.products.filter(p => p.category_id === state.activeCat) : state.products;
    $('productCount').textContent = `${list.length} منتج`;
    if (!list.length) {
      $('productGrid').innerHTML = `<div class="empty" style="grid-column:1/-1;"><span class="big">📭</span>لا توجد منتجات في هذا الصنف حالياً</div>`;
      return;
    }
    const cur = state.info.currency || '';
    $('productGrid').innerHTML = list.map(p => {
      const out = Number(p.stock) <= 0;
      const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="" onerror="this.style.display='none'">` : esc(p.icon || '🛍️');
      return `<article class="product-card${out ? ' stock-out' : ''}">
        <div class="product-img">${img}</div>
        <div class="product-info">
          <h3>${esc(p.name_ar)}</h3>
          <p>${esc(p.description || 'بدون وصف')}</p>
          <div class="price">${money(p.price, cur)}${p.old_price ? `<s>${money(p.old_price, cur)}</s>` : ''}</div>
          <div class="product-foot">
            <span class="small muted">${out ? 'نفد المخزون' : `المتوفر: ${p.stock}`}</span>
            <button class="btn btn-primary btn-sm" data-add="${p.id}" ${out ? 'disabled' : ''}>＋ أضف</button>
          </div>
        </div>
      </article>`;
    }).join('');
    $('productGrid').querySelectorAll('[data-add]').forEach(b => b.onclick = () => addToCart(Number(b.dataset.add)));
  }

  function addToCart(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    const exist = state.cart.find(x => x.id === id);
    if (exist) exist.qty += 1;
    else state.cart.push({ id, name: p.name_ar, price: p.price, qty: 1, icon: p.icon || '🛍️' });
    saveCart();
    toast(`تمت الإضافة للسلة: ${p.name_ar}`);
    openCart();
  }

  function renderCart() {
    const count = state.cart.reduce((s, i) => s + i.qty, 0);
    $('cartCount').textContent = count;
    const cur = state.info.currency || '';
    if (!state.cart.length) {
      $('cartItems').innerHTML = `<div class="empty"><span class="big">🛒</span>سلتك فارغة حالياً</div>`;
      $('cartTotal').textContent = money(0, cur);
      $('checkoutBtn').disabled = true;
      return;
    }
    $('checkoutBtn').disabled = false;
    $('cartTotal').textContent = money(state.cart.reduce((s, i) => s + i.price * i.qty, 0), cur);
    $('cartItems').innerHTML = state.cart.map(i => `<div class="cart-item">
      <div class="thumb">${esc(i.icon)}</div>
      <div class="grow"><b class="small">${esc(i.name)}</b><div class="small muted">${money(i.price, cur)}</div></div>
      <div class="qty"><button data-q="-1" data-id="${i.id}">−</button><b>${i.qty}</b><button data-q="1" data-id="${i.id}">＋</button></div>
      <button class="icon-btn" data-del="${i.id}">✕</button>
    </div>`).join('');
    $('cartItems').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const item = state.cart.find(x => x.id === Number(b.dataset.id));
      if (!item) return;
      item.qty += Number(b.dataset.q);
      if (item.qty <= 0) state.cart = state.cart.filter(x => x !== item);
      saveCart();
    });
    $('cartItems').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      state.cart = state.cart.filter(x => x.id !== Number(b.dataset.del)); saveCart();
    });
  }

  function openCart() { $('cartDrawer').classList.remove('hidden'); $('drawerOverlay').classList.remove('hidden'); }
  function closeCart() { $('cartDrawer').classList.add('hidden'); $('drawerOverlay').classList.add('hidden'); }

  function checkout() {
    if (!state.cart.length) return;
    const cur = state.info.currency || '';
    const m = modal('إتمام الطلب 🧾', `<form id="checkoutForm">
      <div class="form-row"><label>اسمك الكريم</label><input id="co_name" required></div>
      <div class="form-row two"><div><label>رقم الجوال</label><input id="co_phone" required placeholder="05xxxxxxxx"></div>
      <div><label>المدينة / العنوان</label><input id="co_address"></div></div>
      <div class="form-row"><label>ملاحظات (اختياري)</label><textarea id="co_notes" style="min-height:70px;"></textarea></div>
      <div class="card" style="box-shadow:none;background:#f6f9fb;padding:12px;">
        <div class="between"><span>الإجمالي</span><b style="color:var(--teal-dark);font-size:18px;">${money(state.cart.reduce((s,i)=>s+i.price*i.qty,0), cur)}</b></div>
        <div class="small muted">${state.cart.length} أصناف · ${state.cart.reduce((s,i)=>s+i.qty,0)} قطع</div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" type="submit">تأكيد الطلب</button></div>
    </form>`);
    m.el.querySelector('#checkoutForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = '...';
      const r = await api('/api/store/orders', { method: 'POST', body: {
        customer_name: $('co_name').value, phone: $('co_phone').value,
        address: $('co_address').value, notes: $('co_notes').value,
        items_json: JSON.stringify(state.cart),
      } });
      btn.disabled = false; btn.textContent = 'تأكيد الطلب';
      if (!r.ok) { toast(r.error || 'تعذر إرسال الطلب', true); return; }
      state.cart = []; saveCart(); closeCart(); m.close();
      const wa = String(state.info.whatsappNumber || '').replace(/\D/g, '');
      const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`مرحباً، أرسلت الطلب رقم ${r.orderId}`)}` : '';
      modal('تم استلام طلبك ✅', `<div class="center">
        <div style="font-size:44px;">🎉</div>
        <p>شكراً لك! طلبك رقم <b>#${r.orderId}</b> وصلنا وسيتم التواصل معك قريباً.</p>
        ${waUrl ? `<a class="btn btn-primary" href="${waUrl}" target="_blank" rel="noopener">📱 تابع الطلب على واتساب</a>` : ''}
      </div>`);
    });
  }

  function assistantInfo() {
    const s = state.info;
    const wa = String(s.whatsappNumber || '').replace(/\D/g, '');
    const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent('مرحباً، لدي سؤال')}` : '';
    const ms = s.messengerLink || '';
    modal('تكلّم مع المساعد الذكي 🤖', `<div class="small" style="line-height:2;">
      <p>مساعدنا يرد تلقائياً على استفساراتك عن المنتجات والأسعار والتوصيل والطلبات، على مدار الساعة.</p>
      <div class="row wrap" style="gap:8px;margin-top:14px;">
        ${waUrl ? `<a class="btn btn-primary" href="${waUrl}" target="_blank" rel="noopener">📱 ابدأ على واتساب</a>` : `<span class="pill warn">رقم واتساب غير مضبوط بعد</span>`}
        ${ms ? `<a class="btn btn-outline" href="${ms}" target="_blank" rel="noopener">💬 ابدأ على مسنجر</a>` : `<span class="pill warn">رابط مسنجر غير مضبوط بعد</span>`}
      </div>
      <p class="muted" style="margin-top:14px;">أو اكتب لنا مباشرة: "المنتجات"، "كم السعر"، "متى التوصيل"، "أريد الطلب".</p>
    </div>`);
  }

  $('cartBtn').onclick = openCart;
  $('closeCart').onclick = closeCart;
  $('drawerOverlay').onclick = closeCart;
  $('checkoutBtn').onclick = checkout;
  $('assistantBtn').onclick = assistantInfo;
  $('heroChat').onclick = assistantInfo;
  init();
})();
