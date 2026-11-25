'use strict';

async function api(path, opts = {}) {
  const options = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(path, options);
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') {
      if (location.pathname !== '/login.html' && location.pathname !== '/login') location.href = '/login';
    }
    return data;
  } catch (e) {
    toast('تعذر الاتصال بالسيرفر', true);
    throw e;
  }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, isError = false) {
  const box = document.getElementById('toast');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast-item' + (isError ? ' err' : '');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function money(n, currency) {
  return `${Number(n || 0).toLocaleString('ar-SA')} ${currency || ''}`.trim();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });
}

function modal(title, html, opts = {}) {
  const root = document.getElementById('modalRoot') || document.body;
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}">
    <div class="between" style="margin-bottom:16px;"><h3 style="margin:0;">${title}</h3><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body">${html}</div>
  </div>`;
  root.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  return { el: wrap, body: wrap.querySelector('.modal-body'), close };
}

function confirmBox(message, onYes) {
  const m = modal('تأكيد', `<p>${esc(message)}</p><div class="modal-foot">
    <button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-danger" id="confirmYes">تأكيد</button></div>`);
  m.el.querySelector('#confirmYes').addEventListener('click', () => { m.close(); onYes(); });
}
