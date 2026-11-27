'use strict';
(() => {
  const state = { info: {}, categories: [], products: [], activeCat: 0, cart: [], customer: null, ads: [], query: '', chat: [], chatBusy: false, notifications: [], seenNotifs: [] };
  try { state.seenNotifs = JSON.parse(localStorage.getItem('opera_seen_notifs') || '[]') || []; } catch { state.seenNotifs = []; }
  try { state.cart = JSON.parse(localStorage.getItem('opera_cart') || '[]') || []; } catch { state.cart = []; }
  try { state.chat = JSON.parse(localStorage.getItem('opera_chat') || '[]') || []; } catch { state.chat = []; }
  const $ = id => document.getElementById(id);
  const icons = v => (String(v || '').startsWith('/') || /^https?:/.test(v))
    ? `<img src="${esc(v)}" alt="" onerror="this.style.display='none'">` : esc(v || '🛍️');
  const splitOpts = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const parseJson = (v, fallback) => { try { const d = JSON.parse(v || ''); return d ?? fallback; } catch { return fallback; } };

  // ================= المفضلة =================
  const favs = () => { try { return JSON.parse(localStorage.getItem('opera_favs') || '[]'); } catch { return []; } };
  const isFav = id => favs().map(Number).includes(Number(id));
  function toggleFav(id) {
    const f = favs(); const i = f.map(Number).indexOf(Number(id));
    if (i >= 0) f.splice(i, 1); else f.push(Number(id));
    localStorage.setItem('opera_favs', JSON.stringify(f));
    updateBadges(); renderFavs();
    return i < 0;
  }
  function updateBadges() {
    const c = state.cart.reduce((s, i) => s + i.qty, 0);
    const f = favs().length;
    [['cartBadge', c], ['tabCartBadge', c], ['favBadge', f], ['tabFavBadge', f]].forEach(([id, n]) => {
      const el = $(id); if (!el) return;
      el.textContent = n > 99 ? '99+' : n;
      el.classList.toggle('zero', n === 0);
    });
    const cc = $('cartCount'); if (cc) cc.textContent = c;
  }

  // ================= شاشة البداية =================
  function hideSplash() { const s = $('appSplash'); if (s) setTimeout(() => s.classList.add('hide'), 450); }

  // ================= التنقل بين الشاشات =================
  function openView(id) {
    document.querySelectorAll('.app-view').forEach(v => { v.classList.remove('open'); v.setAttribute('aria-hidden', 'true'); });
    const v = $(id); if (!v) return;
    v.classList.add('open'); v.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeViews() {
    document.querySelectorAll('.app-view').forEach(v => { v.classList.remove('open'); v.setAttribute('aria-hidden', 'true'); });
    document.body.style.overflow = '';
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    $('tabHome')?.classList.add('active');
  }
  function setTabActive(tab) {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  }

  // ================= الدردشة الذكية =================
  function chatTime() { return new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }); }
  function renderChat() {
    const stream = $('chatStream'); if (!stream) return;
    if (!state.chat.length) {
      stream.innerHTML = `<div class="empty-app"><span class="big">🤖</span><h4>أهلاً بك في المساعد الذكي</h4>
        <p>اسألني عن المنتجات والأسعار والتوصيل — أرد فوراً على مدار الساعة</p></div>`;
      return;
    }
    stream.innerHTML = `<div class="chat-day">اليوم</div>` + state.chat.map(m =>
      `<div class="bubble ${m.who === 'me' ? 'me' : 'bot'}">${esc(m.text)}<span class="b-time">${esc(m.time || '')}</span></div>`
    ).join('');
    const sc = $('chatScroll'); if (sc) sc.scrollTop = sc.scrollHeight;
  }
  function saveChat() { localStorage.setItem('opera_chat', JSON.stringify(state.chat.slice(-60))); }
  async function sendChat(text) {
    text = String(text || '').trim(); if (!text || state.chatBusy) return;
    state.chatBusy = true;
    state.chat.push({ who: 'me', text, time: chatTime() }); saveChat(); renderChat();
    const send = $('chatSend'); if (send) send.disabled = true;
    const stream = $('chatStream');
    const typing = document.createElement('div');
    typing.className = 'bubble bot typing'; typing.innerHTML = '<i></i><i></i><i></i>';
    if (stream) { stream.appendChild(typing); const sc = $('chatScroll'); if (sc) sc.scrollTop = sc.scrollHeight; }
    try {
      const history = state.chat.slice(-10).map(m => ({ direction: m.who === 'me' ? 'in' : 'out', text: m.text }));
      const r = await fetch('/api/chat', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      }).then(x => x.json());
      typing.remove();
      const reply = r.reply || r.error || 'تعذر الرد الآن — جرّب مرة أخرى';
      state.chat.push({ who: 'bot', text: reply, time: chatTime() }); saveChat(); renderChat();
    } catch {
      typing.remove();
      state.chat.push({ who: 'bot', text: 'تعذر الاتصال — تحقق من الإنترنت وحاول مجدداً', time: chatTime() }); saveChat(); renderChat();
    } finally {
      state.chatBusy = false;
      if (send) send.disabled = false;
      $('chatInput')?.focus();
    }
  }
  function wireChat() {
    $('chatBack')?.addEventListener('click', closeViews);
    $('chatClear')?.addEventListener('click', () => { state.chat = []; saveChat(); renderChat(); });
    $('chatForm')?.addEventListener('submit', e => { e.preventDefault(); const i = $('chatInput'); sendChat(i.value); if (i) i.value = ''; });
    $('chatChips')?.addEventListener('click', e => { const b = e.target.closest('.chat-chip'); if (b) sendChat(b.textContent.trim()); });
  }

  // ================= المفضلة (شاشة) =================
  function renderFavs() {
    const box = $('favsBody'); if (!box) return;
    const ids = favs().map(Number);
    const list = state.products.filter(p => ids.includes(Number(p.id)));
    if (!list.length) {
      box.innerHTML = `<div class="empty-app"><span class="big">🤍</span><h4>لا توجد منتجات في المفضلة</h4>
        <p>اضغط على القلب في أي منتج لتحفظه هنا</p>
        <button class="btn-app primary" id="favsGoShop">تصفح المتجر</button></div>`;
      $('favsGoShop')?.addEventListener('click', () => { closeViews(); $('products')?.scrollIntoView({ behavior: 'smooth' }); });
      return;
    }
    const cur = state.info.currency || '';
    box.innerHTML = `<div class="fav-grid">` + list.map(p => {
      const out = Number(p.stock) <= 0;
      return `<article class="p-card" data-detail="${p.id}">
        <div class="p-media">${p.image_url && /^\/|^https?:/.test(p.image_url) ? `<img src="${esc(p.image_url)}" alt="" onerror="this.remove()">` : (p.icon && /^\/|^https?:/.test(p.icon) ? `<img src="${esc(p.icon)}" alt="" onerror="this.remove()">` : `<div style="display:grid;place-items:center;height:100%;font-size:44px;">${esc(p.icon || '🛍️')}</div>`)}
          <button class="p-fav on" data-unfav="${p.id}" aria-label="إزالة">❤️</button>
          ${out ? '<span class="p-flag">نفد</span>' : ''}
        </div>
        <div class="p-body">
          <h3 class="p-name">${esc(p.name_ar)}</h3>
          <div class="p-price-row"><span class="p-price">${money(p.price, cur)}</span>${p.old_price ? `<span class="p-old">${money(p.old_price, cur)}</span>` : ''}</div>
          <div class="p-meta"><span class="p-stars">⭐</span><span class="p-stock ${out ? 'out' : ''}">${out ? 'نفد' : `متوفر ${p.stock}`}</span></div>
        </div>
      </article>`;
    }).join('') + `</div>`;
    box.querySelectorAll('[data-unfav]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleFav(b.dataset.unfav); });
    box.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => {
      const p = state.products.find(x => x.id === Number(b.dataset.detail));
      if (p) openProductModal(p);
    });
  }

  // ================= طلباتي / تتبع الطلب =================
  function statusClass(s) {
    const t = String(s || '');
    if (/مكتمل|تم الاستلام|مكتمل/.test(t)) return 's3';
    if (/ملغي|مرفوض/.test(t)) return 's4';
    if (/تحضير|جديد/.test(t)) return 's1';
    return 's2';
  }
  function renderOrders() {
    const box = $('ordersBody'); if (!box) return;
    box.innerHTML = `
      <div class="info-card">
        <h4>🔎 تتبع طلبك</h4>
        <div class="field"><label>رقم الطلب</label><input type="number" id="trkId" placeholder="مثال: 12" min="1"></div>
        <div class="field"><label>رقم الجوال المستخدم في الطلب</label><input type="tel" id="trkPhone" dir="ltr" placeholder="0945343522"></div>
        <button class="btn-app primary block" id="trkGo">تتبع الطلب</button>
        <div id="trkResult"></div>
      </div>
      <div class="info-card">
        <h4>📩 طلباتي السابقة</h4>
        <div id="myOrders"><p class="muted-app">جارٍ التحميل…</p></div>
      </div>
      <div class="info-card">
        <h4>❓ الأسئلة الشائعة</h4>
        <div id="faqBox"><p class="muted-app">جارٍ التحميل…</p></div>
      </div>`;
    $('trkGo')?.addEventListener('click', trackOrder);
    loadMyOrders(); loadFaqs();
  }
  async function trackOrder() {
    const id = ($('trkId')?.value || '').trim();
    const phone = ($('trkPhone')?.value || '').trim();
    const out = $('trkResult'); if (!out) return;
    if (!id || !phone) { out.innerHTML = `<div class="info-card" style="margin-top:12px;border-color:#fca5a5;"><p class="rev-text" style="color:#b91c1c;">أدخل رقم الطلب ورقم الجوال</p></div>`; return; }
    out.innerHTML = `<div class="info-card" style="margin-top:12px;"><p class="muted-app">جارٍ التتبع…</p></div>`;
    try {
      const r = await fetch(`/api/orders/track?id=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}`).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div class="info-card" style="margin-top:12px;border-color:#fca5a5;"><p class="rev-text" style="color:#b91c1c;">${esc(r.error || 'تعذر التتبع')}</p></div>`; return; }
      const o = r.order;
      out.innerHTML = `<div class="info-card" style="margin-top:12px;">
        <div class="order-row"><span>رقم الطلب</span><b>#${o.id}</b></div>
        <div class="order-row"><span>الحالة</span><span class="status-pill ${statusClass(o.status)}">${esc(o.status)}</span></div>
        <div class="order-row"><span>الإجمالي</span><b>${money(o.total, state.info.currency)}</b></div>
        <div class="order-row"><span>التاريخ</span><span>${fmtDate(o.created_at)}</span></div>
        <div class="order-row"><span>التوصيل</span><span>${esc(o.delivery_method || '—')}</span></div>
        ${(o.items || []).map(i => `<div class="order-row"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty, state.info.currency)}</span></div>`).join('')}
      </div>`;
    } catch { out.innerHTML = `<div class="info-card" style="margin-top:12px;border-color:#fca5a5;"><p class="rev-text" style="color:#b91c1c;">تعذر الاتصال</p></div>`; }
  }
  async function loadMyOrders() {
    const box = $('myOrders'); if (!box) return;
    try {
      const me = await api('/api/customer/me');
      if (!me.customer) {
        box.innerHTML = `<p class="muted-app">سجّل دخولك برقم الجوال لعرض طلباتك.</p>
          <button class="btn-app primary sm" id="myLogin">تسجيل الدخول</button>`;
        $('myLogin')?.addEventListener('click', () => { document.querySelectorAll('.overlay').forEach(o => o.remove()); loginModal(); });
        return;
      }
      box.innerHTML = `<p class="muted-app">مرحباً ${esc(me.customer.name || me.customer.phone)} — استخدم «تتبع طلبك» برقم الطلب الذي وصلك، أو تواصل معنا لعرض كل طلباتك.</p>`;
    } catch { box.innerHTML = `<p class="muted-app">تعذر التحميل</p>`; }
  }
  async function loadFaqs() {
    const box = $('faqBox'); if (!box) return;
    try {
      const r = await fetch('/api/faqs').then(x => x.json());
      const items = r.items || [];
      if (!items.length) { box.innerHTML = `<p class="muted-app">لا توجد أسئلة حالياً — اسأل مساعدنا في الدردشة.</p>`; return; }
      box.innerHTML = items.map((f, i) => `
        <details class="info-card" style="margin-bottom:9px;padding:13px 15px;" ${i === 0 ? 'open' : ''}>
          <summary style="font-weight:800;font-size:13.5px;cursor:pointer;">${esc(f.question)}</summary>
          <p class="rev-text" style="margin-top:8px;">${esc(f.answer)}</p>
        </details>`).join('');
    } catch { box.innerHTML = `<p class="muted-app">تعذر التحميل</p>`; }
  }

  // ================= التنبيهات داخل التطبيق + إشعارات الهاتف =================
  function unseenCount() { return state.notifications.filter(n => !state.seenNotifs.includes(n.id)).length; }
  function updateNotifBadge() {
    const n = unseenCount();
    [['notifBadge', n]].forEach(([id, v]) => {
      const el = $(id); if (!el) return;
      el.textContent = v > 99 ? '99+' : v;
      el.classList.toggle('zero', v === 0);
    });
  }
  function markAllSeen() {
    state.notifications.forEach(n => { if (!state.seenNotifs.includes(n.id)) state.seenNotifs.push(n.id); });
    if (state.seenNotifs.length > 300) state.seenNotifs = state.seenNotifs.slice(-300);
    localStorage.setItem('opera_seen_notifs', JSON.stringify(state.seenNotifs));
    updateNotifBadge();
  }
  async function loadNotifications(silent) {
    try {
      const r = await fetch('/api/notifications?limit=40', { credentials: 'same-origin' }).then(x => x.json());
      const items = Array.isArray(r.items) ? r.items : [];
      const fresh = silent ? items.filter(n => !state.notifications.some(o => o.id === n.id)) : [];
      state.notifications = items;
      updateNotifBadge();
      if ($('viewNotifs')?.classList.contains('open')) renderNotifications();
      if (silent && fresh.length) {
        const n = fresh[0];
        toast('🔔 ' + (n.title || 'تنبيه جديد') + ' — ' + (n.message || '').slice(0, 60));
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(n.title || 'LUNZERA', { body: String(n.message || '').slice(0, 160), icon: '/icon-192.png', image: /^\/|^https?:/.test(n.image_url || '') ? n.image_url : undefined, tag: 'lunzera-' + n.id });
          }
        } catch {}
      }
    } catch {}
  }
  function renderNotifications() {
    const box = $('notifsBody'); if (!box) return;
    const unread = unseenCount();
    const head = `<div class="push-enable-card">
      <h4>📲 إشعارات على هاتفك</h4>
      <p>فعّل الإشعارات لتصلك التنبيهات فوراً حتى لو كان التطبيق مغلقاً — تماماً مثل تطبيقات الهاتف.</p>
      <div class="row wrap" style="gap:8px;">
        <button class="btn-app sm" id="pushEnableBtn">${('Notification' in window && Notification.permission === 'granted') ? '✅ الإشعارات مفعّلة' : 'تفعيل إشعارات الهاتف'}</button>
        <button class="btn-app sm" id="pushDisableBtn" style="background:rgba(255,255,255,.18);">🔕 إلغاء التنبيهات</button>
      </div>
    </div>`;
    const list = state.notifications.length
      ? state.notifications.map(n => {
          const isNew = !state.seenNotifs.includes(n.id);
          return `<div class="notif-card${isNew ? ' unread' : ''}">
            <div class="n-icon">${/طلب|🛒|🧾/.test(n.title + n.message) ? '📦' : /عرض|خصم|🎯/.test(n.title + n.message) ? '🏷️' : '🔔'}</div>
            <div class="n-body"><b>${esc(n.title || 'تنبيه من المتجر')}</b>
              ${n.image_url && /^\/|^https?:/.test(n.image_url) ? `<img class="n-img" src="${esc(n.image_url)}" alt="" onerror="this.remove()">` : ''}
              <p>${esc(n.message || '')}</p>
              <span class="n-date">${fmtDate(n.created_at)}</span></div>
            ${isNew ? '<span class="n-new"></span>' : ''}
          </div>`;
        }).join('')
      : `<div class="empty-app"><span class="big">🔕</span><h4>لا توجد تنبيهات بعد</h4><p>ستظهر هنا كل الإشعارات الجديدة من متجرنا</p></div>`;
    box.innerHTML = head + (unread ? `<div class="row" style="justify-content:space-between;margin-bottom:10px;"><span class="muted-app">${unread} تنبيه جديد</span></div>` : '') + list;
    box.querySelector('#pushEnableBtn')?.addEventListener('click', enablePush);
    box.querySelector('#pushDisableBtn')?.addEventListener('click', async () => {
      try {
        const endpoint = localStorage.getItem('opera_push_endpoint') || '';
        if (endpoint) await fetch('/api/push/unsubscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
        localStorage.removeItem('opera_push_endpoint');
        try { (await navigator.serviceWorker?.getRegistration())?.pushManager?.unsubscribe(); } catch {}
        toast('تم إلغاء إشعارات الهاتف 🔕');
      } catch { toast('تعذر إلغاء الإشعارات', true); }
    });
  }
  async function enablePush() {
    const btn = $('pushEnableBtn');
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast('متصفحك لا يدعم إشعارات الهاتف — استخدم متصفح حديث', true); return;
    }
    try {
      if (Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') { toast('يجب السماح بالإشعارات من المتصفح', true); return; }
      }
      if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التفعيل…'; }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch('/api/push/vapid-public-key').then(x => x.json());
      if (!publicKey) throw new Error('no key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const j = sub.toJSON();
      const r = await fetch('/api/push/subscribe', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }, user_agent: navigator.userAgent }),
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error || 'فشل الاشتراك');
      try { localStorage.setItem('opera_push_endpoint', j.endpoint); } catch {}
      if (btn) { btn.textContent = '✅ الإشعارات مفعّلة على هذا الهاتف'; }
      toast('تم تفعيل إشعارات الهاتف ✓');
      new Notification('LUNZERA', { body: 'تم تفعيل الإشعارات — سنرسل لك كل تنبيه فوراً ✅', icon: '/icon-192.png' });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'إعادة محاولة التفعيل'; }
      toast('تعذر تفعيل الإشعارات: ' + (e.message || 'خطأ'), true);
    }
  }
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  // ================= تثبيت التطبيق =================
  function installGuide() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const steps = isIOS
      ? `<div class="info-card"><h4>📱 على iPhone (Safari)</h4>
          <p class="rev-text">1. اضغط زر <b>مشاركة</b> ⬆️ في أسفل الشاشة.<br>
          2. اختر <b>إضافة إلى الشاشة الرئيسية</b>.<br>
          3. اضغط <b>إضافة</b> — سيظهر التطبيق مثل أي تطبيق.</p></div>`
      : `<div class="info-card"><h4>🤖 على Android (Chrome)</h4>
          <p class="rev-text">1. اضغط قائمة المتصفح ⋮ أعلى اليمين.<br>
          2. اختر <b>تثبيت التطبيق</b> أو <b>إضافة إلى الشاشة الرئيسية</b>.<br>
          3. اضغط <b>تثبيت</b> — سيظهر التطبيق على هاتفك.</p></div>`;
    const m = modal('تطبيق LUNZERA على هاتفك 📲', `
      <div class="center"><div style="font-size:42px;">📲</div><p class="muted-app">ثبّت المتجر على شاشتك الرئيسية — يعمل مثل تطبيق حقيقي، ويقبل الإشعارات.</p></div>
      ${steps}
      <div class="info-card"><h4>✅ ماذا تحصل عليه؟</h4>
        <p class="rev-text">• فتح سريع بضغطة واحدة<br>• تجربة كاملة الشاشة بدون متصفح<br>• إشعارات فورية حتى والتطبيق مغلق<br>• يعمل بدون إنترنت للصفحات المحمّلة</p></div>
      <div class="modal-foot"><button class="btn-app ghost" data-close>إغلاق</button>
        <button class="btn-app primary" id="doInstall">${deferredPrompt ? 'تثبيت الآن' : 'حسناً، فهمت'}</button></div>`);
    m.el.querySelector('#doInstall').onclick = async () => {
      if (deferredPrompt) {
        m.close();
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') toast('جارٍ تثبيت التطبيق…');
        deferredPrompt = null;
        $('installBanner')?.classList.remove('show');
      } else { m.close(); toast('استخدم خطوات المتصفح أعلاه لتثبيت التطبيق'); }
    };
  }

  async function init() {
    const [info, cats, prods, me, ads] = await Promise.all([
      api('/api/store/info'), api('/api/store/categories'), api('/api/store/products'), api('/api/customer/me'), api('/api/ads?placement=store').catch(() => ({ items: [] })),
    ]);
    state.info = info || {};
    state.categories = cats.items || [];
    state.products = prods.items || [];
    state.customer = me.customer || null;
    state.ads = ads.items || [];
    if (localStorage.getItem('opera_theme') === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); if ($('hdrTheme')) $('hdrTheme').textContent = '🌙'; }
    else { document.documentElement.removeAttribute('data-theme'); if ($('hdrTheme')) $('hdrTheme').textContent = '☀️'; }
    renderInfo(); renderChips(); renderProducts(); renderCustomer(); renderAds(); wireSearch(); wireScroll(); wireTabs(); wireChat(); wireHeader();
    updateBadges(); renderChat(); hideSplash(); autoAds();
    loadNotifications();
    setInterval(() => loadNotifications(true), 60000); // فحص التنبيهات كل دقيقة
    if (location.hash.startsWith('#p')) {
      const p = state.products.find(x => x.id === Number(location.hash.slice(2)));
      if (p) setTimeout(() => openProductModal(p), 700);
    }
  }

  function wireScroll() {
    const h = document.querySelector('.app-header') || document.querySelector('.site-header');
    const on = () => h && h.classList.toggle('scrolled', window.scrollY > 12);
    window.addEventListener('scroll', on, { passive: true }); on();
  }

  // ================= التبويبات السفلية =================
  function wireTabs() {
    const map = {
      home: () => { closeViews(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      store: () => { closeViews(); $('products')?.scrollIntoView({ behavior: 'smooth' }); },
      chat: () => { setTabActive('chat'); openView('viewChat'); renderChat(); setTimeout(() => $('chatInput')?.focus(), 350); },
      favs: () => { setTabActive('favs'); renderFavs(); openView('viewFavs'); },
      cart: () => { setTabActive('cart'); openCart(); },
    };
    document.querySelectorAll('.tab-item').forEach(t => {
      t.addEventListener('click', () => { const fn = map[t.dataset.tab]; if (fn) fn(); });
    });
    $('favsBack')?.addEventListener('click', closeViews);
    $('ordersBack')?.addEventListener('click', closeViews);
  }
  function wireHeader() {
    $('hdrCart')?.addEventListener('click', openCart);
    $('hdrFavs')?.addEventListener('click', () => { setTabActive('favs'); renderFavs(); openView('viewFavs'); });
    $('hdrOrders')?.addEventListener('click', () => { setTabActive('home'); renderOrders(); openView('viewOrders'); });
    $('hdrTheme')?.addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('opera_theme', 'light'); }
      else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('opera_theme', 'dark'); }
      $('hdrTheme').textContent = dark ? '☀️' : '🌙';
    });
    $('hdrNotif')?.addEventListener('click', () => { renderNotifications(); openView('viewNotifs'); setTimeout(markAllSeen, 900); });
    $('hdrInstall')?.addEventListener('click', installGuide);
    $('notifsBack')?.addEventListener('click', closeViews);
    $('notifsRead')?.addEventListener('click', () => { markAllSeen(); renderNotifications(); toast('تم تعليم التنبيهات كمقروءة'); });
  }

  // ================= شريط إعلاني تلقائي =================
  function autoAds() {
    // لا يتطلب — اللافتات تُعرض عبر renderAds
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
    if (!b) return;
    b.textContent = '👤';
    b.title = state.customer ? (state.customer.name || state.customer.phone || 'حسابي') : 'دخول الزبون';
    b.style.boxShadow = state.customer ? '0 0 0 2.5px #2dd4bf' : 'none';
  }

  function renderInfo() {
    const s = state.info;
    if (s.businessName) { const bn = $('brandName'); if (bn) bn.textContent = s.businessName; document.title = `${s.businessName} | تسوّق وتكلّم معنا`; }
    if (s.logoUrl && $('brandLogo')) $('brandLogo').src = s.logoUrl;
    if (s.footerText && $('footerText')) $('footerText').textContent = s.footerText;
    const wa = String(s.whatsappNumber || '').replace(/\D/g, '');
    const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent('مرحباً، أريد الاستفسار عن منتجاتكم')}` : '';
    if ($('waLink')) {
      const shown = wa.startsWith('218') ? '0' + wa.slice(3) : wa;
      $('waLink').textContent = wa ? `📱 واتساب: ${shown}` : '📱 واتساب';
      $('waLink').href = waUrl || '#';
      $('waLink').onclick = e => { if (!waUrl) { e.preventDefault(); toast('لم يتم ضبط رقم واتساب بعد', true); } };
    }
    const ms = s.messengerLink || (s.messengerPageId ? `https://m.me/${s.messengerPageId}` : '');
    if ($('msLink')) { if (ms) $('msLink').href = ms; $('msLink').onclick = e => { if (!ms) { e.preventDefault(); toast('لم يتم ضبط صفحة مسنجر بعد', true); } }; }
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
    if (!p) return;
    const cur = state.info.currency || '';
    const cat = state.categories.find(c => c.id === p.category_id);
    const colors = splitOpts(p.colors_json).length ? splitOpts(p.colors_json) : (cat ? splitOpts(cat.colors_json) : []);
    const sizes = splitOpts(p.sizes_json).length ? splitOpts(p.sizes_json) : (cat ? splitOpts(cat.sizes_json) : []);
    const gallery = parseJson(p.images_json, []);
    const images = gallery.length ? gallery : (p.image_url ? [p.image_url] : []);
    const colorMap = parseJson(p.color_images_json, {});
    const hexMap = parseJson(p.color_hex_json, {});
    const related = state.products.filter(x => x.id !== p.id && x.category_id === p.category_id && Number(x.stock) > 0).slice(0, 6);
    const out = Number(p.stock) <= 0;
    const discount = p.old_price && Number(p.old_price) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;
    const mainImg = (colorMap[colors[0]] || images[0] || p.image_url || p.icon);
    pushRecent(p.id);
    const html = `<div class="pd">
      <div class="pd-gallery"><div class="pd-main" id="pm_img">${icons(mainImg)}</div>
        <div class="pd-thumbs" id="pm_thumbs">${(images.length ? images : [p.icon]).filter(u => /^\/|^https?:/.test(String(u || ''))).map((u, i) => `<button type="button" class="pd-thumb${i===0?' active':''}" data-i="${i}"><img src="${esc(u)}" onerror="this.style.display='none'"></button>`).join('')}</div></div>
      <div class="pd-info">
        ${discount ? `<span class="pd-badge">خصم ${discount}%</span>` : ''}${out ? `<span class="pd-badge bad" id="pm_stock">نفد المخزون</span>` : `<span class="pd-badge ok" id="pm_stock">متوفر ${esc(variantStock(p, colors[0] || '', sizes[0] || ''))}</span>`}
        <h2 class="pd-title">${esc(p.name_ar)}</h2>${p.name_en ? `<div class="small muted">${esc(p.name_en)}</div>` : ''}${cat ? `<div class="small muted">الصنف: ${esc(cat.name_ar)}</div>` : ''}
        <div class="pd-price">${money(p.price, cur)}${p.old_price ? ` <s>${money(p.old_price, cur)}</s>` : ''}</div>
        <div id="pm_rating">${p.avg_rating ? `<div class="small" style="color:#e6a23c;">⭐ ${Number(p.avg_rating).toFixed(1)} · ${p.rating_count} تقييم</div>` : ''}</div>
        ${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ''}
        ${colors.length ? `<div class="pd-opt"><label>اللون</label><div class="pd-choices pd-colors" id="pm_colors">${colors.map((c,i)=>`<button type="button" class="pd-choice pd-color${i===0?' active':''}" data-color="${esc(c)}" title="${esc(c)}"><span class="color-dot" style="background:${esc(hexMap[c] || '#cbd5e1')}"></span><small>${esc(c)}</small></button>`).join('')}</div></div>` : ''}
        ${sizes.length ? `<div class="pd-opt"><label>المقاس</label><div class="pd-choices" id="pm_sizes">${sizes.map((s,i)=>`<button type="button" class="pd-choice${i===0?' active':''}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
        <div class="pd-opt"><label>الكمية</label><div class="pd-qty"><button type="button" id="pm_minus">−</button><input id="pm_qty" type="number" min="1" value="1"><button type="button" id="pm_plus">+</button></div></div>
        <div class="pd-actions"><button class="btn btn-ghost" id="pm_fav">${isFav(p.id)?'❤️':'🤍'} مفضّلة</button><button class="btn btn-ghost" id="pm_share">🔗 مشاركة</button></div>
        <div class="modal-foot" style="border:0;"><button class="btn btn-ghost" id="pm_add" ${out?'disabled':''}>🛒 أضف للسلة</button><button class="btn btn-primary" id="pm_order" ${out?'disabled':''}>⚡ طلب مباشر</button></div>
      </div></div>
      <div class="divider-app"></div>
      <div id="pm_reviews"><div class="muted-app">جارٍ تحميل التقييمات…</div></div>
      ${related.length ? `<div class="pd-related"><h4>قد يعجبك أيضاً</h4><div class="pd-related-grid">${related.map(r=>`<button type="button" class="pd-related-item" data-rel="${r.id}">${icons(r.image_url||r.icon)}<span>${esc(r.name_ar)}</span><b>${money(r.price,cur)}</b></button>`).join('')}</div></div>` : ''}`;
    const mm = modal('🛍️ ' + p.name_ar, html);
    const root = mm.el; let selColor = colors[0] || ''; let selSize = sizes[0] || '';
    const curImages = () => images.length ? images : [p.icon];
    const setMain = (url) => { const el = root.querySelector('#pm_img'); if (el) el.innerHTML = icons(url); };
    root.querySelectorAll('.pd-thumb').forEach(b => b.onclick = () => { root.querySelectorAll('.pd-thumb').forEach(x => x.classList.remove('active')); b.classList.add('active'); setMain(curImages()[Number(b.dataset.i)] || mainImg); });
    root.querySelectorAll('#pm_colors .pd-choice').forEach(b => b.onclick = () => { root.querySelectorAll('#pm_colors .pd-choice').forEach(x => x.classList.remove('active')); b.classList.add('active'); selColor = b.dataset.color || ''; if (colorMap[selColor]) setMain(colorMap[selColor]); updateStockBadge(); });
    root.querySelectorAll('#pm_sizes .pd-choice').forEach(b => b.onclick = () => { root.querySelectorAll('#pm_sizes .pd-choice').forEach(x => x.classList.remove('active')); b.classList.add('active'); selSize = b.dataset.size || ''; updateStockBadge(); });
    const qty = () => Math.max(1, Number(root.querySelector('#pm_qty')?.value) || 1);
    const step = d => { const i = root.querySelector('#pm_qty'); i.value = Math.max(1, qty() + d); };
    root.querySelector('#pm_minus')?.addEventListener('click', () => step(-1));
    root.querySelector('#pm_plus')?.addEventListener('click', () => step(1));
    const opts = () => [selColor, selSize].filter(Boolean).join(' / ');
    const variant = () => ({ color: selColor, size: selSize });
    const updateStockBadge = () => {
      const badge = root.querySelector('#pm_stock'); if (!badge) return;
      const n = variantStock(p, selColor, selSize);
      badge.textContent = n > 0 ? `متوفر ${n}` : 'نفد';
      badge.classList.toggle('out', n <= 0);
      const qi = root.querySelector('#pm_qty'); if (qi) qi.max = String(Math.max(1, n));
      root.querySelectorAll('#pm_sizes .pd-choice').forEach(b => {
        const s = b.dataset.size || '';
        const available = variantStock(p, selColor, s) > 0;
        b.classList.toggle('oos', !available);
        b.disabled = !available;
      });
      const add = root.querySelector('#pm_add'), order = root.querySelector('#pm_order');
      if (add) add.disabled = n <= 0; if (order) order.disabled = n <= 0;
    };
    root.querySelector('#pm_add')?.addEventListener('click', () => { addToCartQty(p.id, opts(), qty(), false, variant()); });
    root.querySelector('#pm_order')?.addEventListener('click', () => { addToCartQty(p.id, opts(), qty(), true, variant()); mm.close(); checkout(); });
    root.querySelector('#pm_fav')?.addEventListener('click', (e) => { const on = toggleFav(p.id); e.target.textContent = (on ? '❤️' : '🤍') + ' مفضّلة'; });
    root.querySelector('#pm_share')?.addEventListener('click', async () => { const url = location.origin + '/#p' + p.id; try { if (navigator.share) await navigator.share({ title: p.name_ar, url }); else { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط ✓'); } } catch { toast(url); } });
    root.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => { const r = state.products.find(x => x.id === Number(b.dataset.rel)); mm.close(); openProductModal(r); });
    loadReviews(p, root, cur);
    updateStockBadge();
  }

  // ================= التقييمات =================
  function stars(n) { const v = Math.round(Number(n) || 0); return '★'.repeat(v) + '☆'.repeat(5 - v); }
  async function loadReviews(p, root, cur) {
    const box = root.querySelector('#pm_reviews'); if (!box) return;
    try {
      const r = await fetch(`/api/reviews?product_id=${p.id}`).then(x => x.json());
      const items = r.items || [];
      box.innerHTML = `<h4 style="margin:0 0 8px;">⭐ التقييمات (${items.length})</h4>` +
        (items.length ? items.map(v => `
          <div class="rev-item">
            <div class="rev-head"><b>${esc(v.customer_name || 'زبون')}</b><span class="rev-stars">${stars(v.rating)}</span></div>
            <p class="rev-text">${esc(v.text)}</p>
            <span class="rev-date">${fmtDate(v.created_at)}</span>
          </div>`).join('') : `<p class="muted-app">كن أول من يقيّم هذا المنتج ✨</p>`) +
        `<div class="divider-app"></div>
        <h4 style="margin:0 0 8px;">✍️ اكتب تقييمك</h4>
        <div class="field"><label>اسمك</label><input id="rv_name" maxlength="60" value="${esc(state.customer?.name || '')}" placeholder="اسمك"></div>
        <div class="field"><label>التقييم</label>
          <div class="rate-input" id="rv_stars">${[1,2,3,4,5].map(i => `<button type="button" data-r="${i}" class="${i <= 5 ? 'on' : ''}">★</button>`).join('')}</div>
        </div>
        <div class="field"><label>مراجعتك</label><textarea id="rv_text" rows="3" maxlength="900" placeholder="رأيك في المنتج…"></textarea></div>
        <button class="btn-app primary block" id="rv_send">إرسال التقييم</button>`;
      let rating = 5;
      const setR = v => { rating = v; box.querySelectorAll('#rv_stars button').forEach(b => b.classList.toggle('on', Number(b.dataset.r) <= v)); };
      box.querySelectorAll('#rv_stars button').forEach(b => b.onclick = () => setR(Number(b.dataset.r)));
      box.querySelector('#rv_send')?.addEventListener('click', async () => {
        const name = box.querySelector('#rv_name')?.value.trim();
        const text = box.querySelector('#rv_text')?.value.trim();
        if (!name || !text) { toast('اكتب اسمك ومراجعتك', true); return; }
        const btn = box.querySelector('#rv_send'); btn.disabled = true; btn.textContent = 'جارٍ الإرسال…';
        try {
          const res = await fetch('/api/reviews', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: p.id, customer_name: name, phone: state.customer?.phone || '', rating, text }),
          }).then(x => x.json());
          if (res.ok) { toast('شكراً! تم نشر تقييمك ✓'); loadReviews(p, root, cur); }
          else { toast(res.error || 'تعذر الإرسال', true); btn.disabled = false; btn.textContent = 'إرسال التقييم'; }
        } catch { toast('تعذر الاتصال', true); btn.disabled = false; btn.textContent = 'إرسال التقييم'; }
      });
    } catch { box.innerHTML = ''; }
  }

  function variantStock(p, color, size) {
    let vars = []; try { vars = JSON.parse(p?.variants_json || '[]'); } catch { vars = []; }
    if (!vars.length) return Number(p?.stock) || 0;
    const v = vars.find(x => (x.color || '') === (color || '') && (x.size || '') === (size || ''));
    return v ? Number(v.stock) || 0 : 0;
  }
  function addToCartQty(id, options, qty, silent, variant) {
    const p = state.products.find(x => x.id === id); if (!p) return;
    const color = variant?.color || '', size = variant?.size || '';
    const available = variantStock(p, color, size);
    const existing = state.cart.find(x => x.id === id && (x.color || '') === color && (x.size || '') === size);
    if ((existing?.qty || 0) + qty > available) { toast(`الكمية المتوفرة ${available} فقط`, true); return; }
    const key = `${id}|${options}`; const exist = state.cart.find(x => x.key === key);
    if (exist) exist.qty += qty; else state.cart.push({ key, id, name: p.name_ar, price: p.price, qty, icon: p.image_url || p.icon, options, color, size });
    saveCart(); if (!silent) toast(`تمت الإضافة: ${p.name_ar}${options ? ' (' + options + ')' : ''}`);
  }
  function pushRecent(id) { try { const r = JSON.parse(localStorage.getItem('opera_recent') || '[]'); localStorage.setItem('opera_recent', JSON.stringify([Number(id), ...r.filter(x => Number(x) !== Number(id))].slice(0, 12))); } catch {} }

  function renderProducts() {
    const norm = s => String(s || '').toLowerCase();
    const q = norm(state.query);
    let list = state.activeCat ? state.products.filter(p => p.category_id === state.activeCat) : state.products;
    if (q) list = list.filter(p => norm(p.name_ar).includes(q) || norm(p.name_en).includes(q) || norm(p.description).includes(q));
    const pc = $('productCount'); if (pc) pc.textContent = `${list.length} منتج`;
    const grid = $('productGrid'); if (!grid) return;
    if (!list.length) { grid.innerHTML = `<div class="empty-app" style="grid-column:1/-1;"><span class="big">📭</span><h4>${q ? 'لا توجد نتائج لبحثك' : 'لا توجد منتجات'}</h4><p>جرّب كلمة أخرى أو تصفح كل الأصناف</p></div>`; return; }
    const cur = state.info.currency || '';
    grid.innerHTML = list.map((p, idx) => {
      const colors = splitOpts(p.colors_json);
      const sizes = splitOpts(p.sizes_json);
      const gallery = parseJson(p.images_json, []);
      const images = gallery.length ? gallery : (p.image_url ? [p.image_url] : []);
      const colorMap = parseJson(p.color_images_json, {});
    const hexMap = parseJson(p.color_hex_json, {});
      const first = colorMap[colors[0]] || images[0] || p.icon;
      const out = Number(p.stock) <= 0;
      const discount = p.old_price && Number(p.old_price) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;
      const opts = (colors.length || sizes.length) ? `
        ${colors.length ? `<select data-color="${p.id}" class="small" style="width:100%;margin-top:6px;border-radius:10px;padding:7px;border:1px solid var(--app-line);background:var(--app-bg);color:inherit;">${colors.map(c => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
        ${sizes.length ? `<select data-size="${p.id}" class="small" style="width:100%;margin-top:6px;border-radius:10px;padding:7px;border:1px solid var(--app-line);background:var(--app-bg);color:inherit;">${sizes.map(s => `<option>${esc(s)}</option>`).join('')}</select>` : ''}` : '';
      const stockCls = out ? 'out' : (Number(p.stock) <= 5 ? 'low' : '');
      return `<article class="p-card${out ? ' stock-out' : ''}" data-detail="${p.id}" style="animation-delay:${Math.min(idx * 45, 400)}ms">
        <div class="p-media" id="pimg-${p.id}">
          ${first && String(first).match(/^\/|^https?:/) ? `<img src="${esc(first)}" alt="" onerror="this.remove()">` : `<div style="display:grid;place-items:center;height:100%;font-size:44px;">${esc(first || '🛍️')}</div>`}
          ${discount ? `<span class="p-flag">-${discount}%</span>` : (out ? `<span class="p-flag">نفد</span>` : (Number(p.stock) <= 5 && !out ? `<span class="p-flag ok">آخر القطع</span>` : ''))}
          <button class="p-fav${isFav(p.id) ? ' on' : ''}" data-fav="${p.id}" aria-label="مفضلة">${isFav(p.id) ? '❤️' : '🤍'}</button>
          <button class="p-quick" data-add="${p.id}" ${out ? 'disabled' : ''}>＋ سريعة</button>
        </div>
        <div class="p-body">
          <h3 class="p-name" data-detail="${p.id}">${esc(p.name_ar)}</h3>
          <div class="p-price-row"><span class="p-price">${money(p.price, cur)}</span>${p.old_price ? `<span class="p-old">${money(p.old_price, cur)}</span>` : ''}</div>
          <div class="p-meta">
            <span class="p-stars">${p.avg_rating ? `⭐ ${Number(p.avg_rating).toFixed(1)}` : '⭐ جديد'}</span>
            <span class="p-stock ${stockCls}">${out ? 'نفد' : `متوفر ${p.stock}`}</span>
          </div>
          ${opts}
        </div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-color]').forEach(s => s.onchange = () => {
      const id = Number(s.dataset.color);
      const p = state.products.find(x => x.id === id);
      const map = parseJson(p?.color_images_json, {});
      const gallery = parseJson(p?.images_json, []);
      const url = map[s.value] || gallery[0] || p?.image_url;
      const el = $(`pimg-${id}`);
      if (el && url && String(url).match(/^\/|^https?:/)) el.innerHTML = `<img src="${esc(url)}" alt="" onerror="this.remove()">`;
    });
    grid.querySelectorAll('[data-fav]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const on = toggleFav(b.dataset.fav);
      b.textContent = on ? '❤️' : '🤍';
      b.classList.toggle('on', on);
      if (on) toast('أُضيف للمفضلة ❤️'); else toast('أُزيل من المفضلة');
    });
    grid.querySelectorAll('[data-add]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const id = Number(b.dataset.add);
      const card = b.closest('.p-card');
      const color = card?.querySelector(`[data-color="${id}"]`)?.value || '';
      const size = card?.querySelector(`[data-size="${id}"]`)?.value || '';
      addToCart(id, [color, size].filter(Boolean).join(' / '), { color, size });
    });
    grid.querySelectorAll('[data-detail]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const p = state.products.find(x => x.id === Number(b.dataset.detail));
      if (p) openProductModal(p);
    });
  }

  function saveCart() { localStorage.setItem('opera_cart', JSON.stringify(state.cart)); updateBadges(); renderCart(); }

  function addToCart(id, options, variant) {
    addToCartQty(id, options, 1, true, variant);
  }

  function renderCart() {
    const count = state.cart.reduce((s, i) => s + i.qty, 0);
    const cc = $('cartCount'); if (cc) cc.textContent = count;
    const cur = state.info.currency || '';
    const items = $('cartItems'); if (!items) return;
    if (!state.cart.length) {
      items.innerHTML = `<div class="empty-app"><span class="big">🛒</span><h4>سلتك فارغة</h4><p>أضف منتجاتك المفضلة وابدأ التسوق</p></div>`;
      const t = $('cartTotal'); if (t) t.textContent = money(0, cur);
      const cb = $('checkoutBtn'); if (cb) cb.disabled = true;
      return;
    }
    const cb = $('checkoutBtn'); if (cb) cb.disabled = false;
    const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = subtotal >= (state.info.deliveryFreeThreshold || 0) ? 0 : (state.info.deliveryFee || 0);
    const t = $('cartTotal'); if (t) t.textContent = money(subtotal + fee, cur);
    items.innerHTML = state.cart.map(i => `<div class="cart-row">
      <div class="thumb">${icons(i.icon)}</div>
      <div class="grow"><b>${esc(i.name)}</b>${i.options ? `<div class="muted-app">${esc(i.options)}</div>` : ''}
        <div class="muted-app">${money(i.price, cur)}</div></div>
      <div class="qty-pill"><button data-q="-1" data-key="${esc(i.key)}">−</button><b>${i.qty}</b><button data-q="1" data-key="${esc(i.key)}">＋</button></div>
      <button class="icon-btn-round" style="width:34px;height:34px;border-radius:11px;" data-del="${esc(i.key)}" aria-label="حذف">🗑️</button>
    </div>`).join('');
    items.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const item = state.cart.find(x => x.key === b.dataset.key);
      if (!item) return;
      item.qty += Number(b.dataset.q);
      if (item.qty <= 0) state.cart = state.cart.filter(x => x !== item);
      saveCart();
    });
    items.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      state.cart = state.cart.filter(x => x.key !== b.dataset.del); saveCart();
    });
  }

  function openCart() { $('cartDrawer')?.classList.remove('hidden'); $('drawerOverlay')?.classList.remove('hidden'); setTabActive('cart'); }
  function closeCart() {
    $('cartDrawer')?.classList.add('hidden'); $('drawerOverlay')?.classList.add('hidden');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    $('tabHome')?.classList.add('active');
  }

  // ------------------------- customer login -------------------------
  function loginModal(after) {
    const m = modal('دخول الزبون 👤', `<div id="loginStep1">
      <p class="small muted">سجّل برقم الجوال — سنرسل لك رمز تحقق من ٦ أرقام.</p>
      <div class="field"><label>رقم الجوال</label><input id="loginPhone" dir="ltr" placeholder="0945343522 أو 218945343522"></div>
      <button class="btn-app primary block" id="sendCode">إرسال الرمز</button></div>
      <div id="loginStep2" class="hidden">
      <div class="field"><label>رمز التحقق</label><input id="loginCode" dir="ltr" maxlength="6" placeholder="000000"></div>
      <div id="demoCode" class="small pill warn hidden"></div>
      <button class="btn-app primary block" id="verifyCode" style="margin-top:12px;">تأكيد الرمز</button>
      <button class="btn-app ghost block btn-sm" id="resendCode" style="margin-top:8px;">إرسال رمز جديد</button></div>`);
    const send = async () => {
      const btn = m.el.querySelector('#sendCode'); if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الإرسال…'; }
      const r = await api('/api/customer/send-code', { method: 'POST', body: { phone: $('loginPhone').value } });
      if (btn) { btn.disabled = false; btn.textContent = 'إرسال الرمز'; }
      if (!r.ok) { toast(r.error || 'تعذر الإرسال', true); return; }
      m.el.querySelector('#loginStep1')?.classList.add('hidden');
      m.el.querySelector('#loginStep2')?.classList.remove('hidden');
      const dc = m.el.querySelector('#demoCode');
      if (dc && r.demoCode) { dc.textContent = `رمز التجربة: ${r.demoCode}`; dc.classList.remove('hidden'); }
      toast(r.sentWhatsApp ? 'تم إرسال الرمز على واتساب ✓' : 'تم إرسال الرمز');
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
    const m = modal('حسابي 👤', `<form id="profileForm">
      <div class="field"><label>الاسم</label><input id="pf_name" value="${esc(c.name || '')}" required></div>
      <div class="field"><label>الجوال</label><input dir="ltr" value="${esc(c.phone || '')}" readonly style="opacity:.7;"></div>
      <div class="field"><label>المدينة</label><input id="pf_city" value="${esc(c.city || '')}"></div>
      <div class="field"><label>العنوان</label><input id="pf_address" value="${esc(c.address || '')}"></div>
      <div class="row wrap"><button type="button" class="btn-app ghost sm" id="openMap">🗺️ الخريطة</button>
      <button type="button" class="btn-app ghost sm" id="geoBtn">📡 موقعي بدقة</button>
      <span id="coords" class="small muted">${c.latitude ? `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}` : 'لم يتم تحديد الموقع'}</span></div>
      <div class="field" style="margin-top:10px;"><label>إحداثي العرض</label><input type="number" step="0.0001" id="pf_lat_v" value="${(c.latitude || 0).toFixed(4)}"></div>
      <div class="field"><label>إحداثي الطول</label><input type="number" step="0.0001" id="pf_lng_v" value="${(c.longitude || 0).toFixed(4)}"></div>
      <input type="hidden" id="pf_lat" value="${c.latitude || 0}"><input type="hidden" id="pf_lng" value="${c.longitude || 0}">
      <div class="modal-foot"><button type="button" class="btn-app ghost" data-close>إلغاء</button>
      <button type="button" class="btn-app danger sm" id="logoutBtn" style="margin-inline:auto;">تسجيل الخروج</button>
      <button class="btn-app primary">حفظ</button></div>
    </form>`);
    m.el.querySelector('#geoBtn').onclick = () => locate(true);
    const syncManual = () => { const v = $('pf_lat_v'), l = $('pf_lng_v'); if (v) $('pf_lat').value = v.value || 0; if (l) $('pf_lng').value = l.value || 0; };
    m.el.querySelector('#openMap').onclick = () => { syncManual(); mapModal(); };
    m.el.querySelector('#logoutBtn').onclick = async () => {
      await api('/api/customer/logout', { method: 'POST' });
      state.customer = null; renderCustomer(); m.close(); toast('تم تسجيل الخروج');
    };
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
      }, () => toast('تعذر الحصول على الموقع', true));
    }
  }

  function mapModal() {
    if (window.__mapModal) window.__mapModal.close();
    const m = modal('اختر موقعك على الخريطة 🗺️', `<div id="mapDiv" style="height:340px;border-radius:14px;overflow:hidden;background:#e8eef4;"></div>
      <p class="small muted">اضغط على الخريطة لاختيار نقطة، أو استخدم «موقعي تلقائياً».</p>
      <div class="modal-foot"><button class="btn-app ghost" data-close>إلغاء</button><button type="button" class="btn-app ghost" id="geoAuto">📍 موقعي</button><button class="btn-app primary" id="pickLocation">استخدام النقطة</button></div>`, { wide: true });
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
      $('mapDiv').innerHTML = `<div class="empty-app"><span class="big">🗺️</span><p>تعذر تحميل الخريطة — أدخل العنوان يدوياً</p></div>`;
    }
    m.el.querySelector('#pickLocation').onclick = async () => {
      latEl.value = lat; lngEl.value = lng;
      if (coordsEl) coordsEl.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const mv = $('pf_lat_v'), mn = $('pf_lng_v'); if (mv) mv.value = lat.toFixed(4); if (mn) mn.value = lng.toFixed(4);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const d = await res.json(); const a = d.address || {};
        if (a.city || a.town) { const c = $('pf_city'); if (c) c.value = a.city || a.town; }
        if (d.display_name) { const ad = $('pf_address'); if (ad) ad.value = d.display_name.slice(0, 200); }
      } catch {}
      window.__map = null; m.close(); toast('تم تحديد الموقع ✓');
    };
    m.el.querySelector('#geoAuto')?.addEventListener('click', () => {
      if (!navigator.geolocation) { toast('المتصفح لا يدعم تحديد الموقع', true); return; }
      toast('جارٍ تحديد موقعك بدقة...');
      navigator.geolocation.getCurrentPosition(pos => {
        lat = pos.coords.latitude; lng = pos.coords.longitude;
        latEl.value = lat; lngEl.value = lng;
        if (marker) marker.setLatLng([lat, lng]);
        if (window.__map) window.__map.setView([lat, lng], 16);
        if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        toast(`تم تحديد موقعك (±${Math.round(pos.coords.accuracy || 0)}م) ✓`);
      }, () => toast('تعذر الحصول على الموقع — فعّل GPS', true), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  // ------------------------- checkout -------------------------
  function checkout() {
    if (!state.cart.length) { toast('سلتك فارغة', true); return; }
    if (!state.customer) { loginModal(() => checkout()); return; }
    const c = state.customer;
    const cur = state.info.currency || '';
    const fee = state.cart.reduce((s, i) => s + i.price * i.qty, 0) >= (state.info.deliveryFreeThreshold || 0) ? 0 : (state.info.deliveryFee || 0);
    const m = modal('إتمام الطلب 🧾', `<form id="checkoutForm">
      <div class="field"><label>الاسم</label><input id="co_name" value="${esc(c.name || '')}" required></div>
      <div class="field"><label>الجوال</label><input id="co_phone" dir="ltr" value="${esc(c.phone)}" required></div>
      <div class="field"><label>المدينة</label><input id="co_city" value="${esc(c.city || '')}"></div>
      <div class="field"><label>العنوان</label><input id="co_address" value="${esc(c.address || '')}"></div>
      <div class="row"><button type="button" class="btn-app ghost sm" id="coMap">🗺️ الخريطة</button><button type="button" class="btn-app ghost sm" id="coGeo">📍 موقعي</button>
      <span class="small muted" id="coCoords">${c.latitude ? `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}` : 'بدون موقع'}</span></div>
      <input type="hidden" id="co_lat" value="${c.latitude || 0}"><input type="hidden" id="co_lng" value="${c.longitude || 0}">
      <div class="field"><label>طريقة التوصيل</label><select id="co_method">${(state.info.deliveryMethods || ['توصيل للمنزل', 'استلام من المتجر']).map(mm => `<option>${esc(mm)}</option>`).join('')}</select></div>
      <p class="muted-app">${esc(state.info.deliveryNote || '')}</p>
      <div class="field"><label>ملاحظات</label><textarea id="co_notes" rows="2"></textarea></div>
      <div class="info-card" style="margin-bottom:0;">
        <div class="order-row"><span>المجموع الفرعي</span><b>${money(state.cart.reduce((s,i)=>s+i.price*i.qty,0), cur)}</b></div>
        <div class="order-row"><span>رسوم التوصيل</span><b>${money(fee, cur)}</b></div>
        <div class="order-row"><span>الإجمالي</span><b style="color:var(--app-brand-ink);font-size:17px;">${money(state.cart.reduce((s,i)=>s+i.price*i.qty,0) + fee, cur)}</b></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn-app ghost" data-close>إلغاء</button><button class="btn-app primary" type="submit">تأكيد الطلب</button></div>
    </form>`);
    m.el.querySelector('#coMap').onclick = () => mapModal();
    m.el.querySelector('#coGeo')?.addEventListener('click', () => {
      if (!navigator.geolocation) { toast('المتصفح لا يدعم تحديد الموقع', true); return; }
      toast('جارٍ تحديد موقعك بدقة...');
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        $('co_lat').value = latitude; $('co_lng').value = longitude;
        $('coCoords').textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        toast(`تم تحديد موقعك (±${Math.round(pos.coords.accuracy || 0)}م) ✓`);
      }, () => toast('تعذر الحصول على الموقع', true), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
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
      modal('تم استلام طلبك ✅', `<div class="center"><div style="font-size:48px;">🎉</div>
        <p>طلبك رقم <b>#${r.orderId}</b> وصلنا وسيتم التواصل معك قريباً.</p>
        ${payLines.length ? `<div class="info-card" style="text-align:right;">${payLines.map(l => `<div>${l}</div>`).join('')}</div>` : ''}
        <div class="row wrap" style="justify-content:center;margin-top:12px;">
          ${waUrl ? `<a class="btn-app primary" href="${waUrl}" target="_blank" rel="noopener">📱 متابعة على واتساب</a>` : ''}
          <button class="btn-app ghost" id="okTrack">🔎 تتبع الطلب</button>
        </div></div>`);
      $('okTrack')?.addEventListener('click', () => {
        document.querySelectorAll('.overlay').forEach(o => o.remove());
        renderOrders(); openView('viewOrders');
        setTimeout(() => { const i = $('trkId'); if (i) i.value = r.orderId; }, 300);
      });
    });
  }

  function assistantInfo() {
    setTabActive('chat'); openView('viewChat'); renderChat();
    setTimeout(() => $('chatInput')?.focus(), 350);
  }

  // ================= ربط الأحداث =================
  $('closeCart') && ($('closeCart').onclick = closeCart);
  $('drawerOverlay') && ($('drawerOverlay').onclick = closeCart);
  $('checkoutBtn') && ($('checkoutBtn').onclick = checkout);
  $('assistantBtn') && ($('assistantBtn').onclick = assistantInfo);
  $('heroChat') && ($('heroChat').onclick = assistantInfo);
  $('loginBtn') && ($('loginBtn').onclick = () => state.customer ? profileModal() : loginModal());

  // ================= تثبيت التطبيق (PWA) =================
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    if (localStorage.getItem('opera_install_dismissed') !== '1') $('installBanner')?.classList.add('show');
  });
  $('installGo')?.addEventListener('click', installGuide);
  $('installX')?.addEventListener('click', () => { $('installBanner')?.classList.remove('show'); localStorage.setItem('opera_install_dismissed', '1'); });

  // ================= Service Worker (تطبيق قابل للتثبيت) =================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  init().catch(e => { console.error(e); hideSplash(); toast('تعذر تحميل المتجر', true); });
})();
