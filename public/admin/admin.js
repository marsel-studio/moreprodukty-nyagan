/* Админка сайта «Морепродукты Нягань». Без библиотек. */
(() => {
'use strict';

const S = { data: null, orders: [], ordersFilter: 'new', dirty: false, timer: null, frame: null };
const app = document.getElementById('app');
const SVG = 'http://www.w3.org/2000/svg';
let uidn = 0;

/* ───── помощники ───── */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function sym(id, cls) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 120 120'); if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', '/img/sprite.svg#' + id); s.append(u);
  return s;
}
const ART = { caviar: 'i-caviar', crab: 'i-crab', shrimp: 'i-shrimp', fish: 'i-fish', squid: 'i-squid', shell: 'i-mussel', dish: 'i-bowl', sweet: 'i-snack' };
const ART_NAMES = { caviar: 'Банка икры', crab: 'Краб', shrimp: 'Креветка', fish: 'Рыба', squid: 'Кальмар / осьминог', shell: 'Ракушка', dish: 'Блюдо', sweet: 'Десерт' };
function artIcon(key, accent) {
  const s = sym(ART[key] || 'i-fish');
  s.style.setProperty('--a', accent); s.style.setProperty('--b', `color-mix(in srgb, ${accent} 45%, #fff)`); s.style.setProperty('--c', `color-mix(in srgb, ${accent} 40%, #000)`);
  return s;
}
const rub = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/[\s ]/g, ' ') + ' ₽';
const HEAD = { bitter: ["'Bitter', Georgia, serif", 800], fira: ["'Fira Sans', Arial, sans-serif", 900], lora: ["'Lora', Georgia, serif", 700], montserrat: ["'Montserrat', Arial, sans-serif", 800] };
const BODY = { fira: "'Fira Sans', Arial, sans-serif", sourcesans: "'Source Sans 3', Arial, sans-serif", montserrat: "'Montserrat', Arial, sans-serif" };
const COLOR_NAMES = { navy: 'Тёмный фон', ocean: 'Синий (ссылки)', cyan: 'Голубой', ice: 'Фон страницы', red: 'Кнопки и акцент', gold: 'Золотой акцент', ink: 'Цвет текста', paper: 'Фон карточек' };

let toastT;
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, bad ? 5200 : 2400);
}
const fail = (e) => toast(e && e.message ? e.message : 'Что-то пошло не так', true);

async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch { throw new Error('Нет связи с сервером. Проверьте интернет и повторите.'); }
  if (r.status === 401 && url !== '/api/admin/login') { showLogin(); throw new Error('Сессия закончилась. Войдите снова.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Ошибка ' + r.status);
  return j;
}

function F(label, control, hint, cls) {
  const id = 'f' + (++uidn);
  if (control.id === '' || !control.id) control.id = id;
  return h('div', { class: 'field' + (cls ? ' ' + cls : '') }, h('label', { for: control.id, text: label }), control, hint ? h('small', { text: hint }) : null);
}
function bind(obj, key, o = {}) {
  const el = o.area ? h('textarea', { rows: o.rows || 3 }) : h('input', { type: o.type || 'text' });
  el.value = obj[key] ?? '';
  if (o.ph) el.placeholder = o.ph;
  if (o.max) el.maxLength = o.max;
  if (o.type === 'number') { el.min = o.min ?? 0; if (o.step) el.step = o.step; el.inputMode = 'numeric'; }
  if (o.list) el.setAttribute('list', o.list);
  el.addEventListener('input', () => { obj[key] = o.type === 'number' ? Number(el.value || 0) : el.value; if (o.settings !== false) markDirty(); if (o.onInput) o.onInput(obj[key]); });
  return el;
}
function check(obj, key, label, o = {}) {
  const i = h('input', { type: 'checkbox' }); i.checked = !!obj[key];
  i.addEventListener('change', () => { obj[key] = i.checked; if (o.settings !== false) markDirty(); if (o.onChange) o.onChange(i.checked); });
  return h('label', { class: 'chk' }, i, label);
}
function select(obj, key, opts, o = {}) {
  const s = h('select', null, opts.map(([v, t]) => h('option', { value: v, text: t })));
  s.value = obj[key] ?? '';
  s.addEventListener('change', () => { obj[key] = s.value; if (o.settings !== false) markDirty(); if (o.onChange) o.onChange(s.value); });
  return s;
}
const card = (title, lead, ...kids) => h('section', { class: 'card' }, title ? h('h2', { text: title }) : null, lead ? h('p', { class: 'lead', text: lead }) : null, ...kids);
const confirmBox = (msg) => window.confirm(msg);

/* ───── фото: сжатие в браузере и загрузка ───── */
function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть картинку. Подойдут JPG, PNG, WebP.')); };
    img.src = url;
  });
}
async function uploadFile(file) {
  if (!file) return null;
  const data = await resizeImage(file);
  const r = await api('POST', '/api/admin/upload', { data });
  return r.url;
}
function imgPicker(obj, key, o = {}) {
  const pv = h('div', { class: 'pv' });
  const paint = () => { pv.replaceChildren(obj[key] ? h('img', { src: obj[key], alt: '' }) : (o.empty || 'Нет фото')); rm.hidden = !obj[key]; };
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'sr', tabindex: '-1' });
  const btn = h('button', { class: 'btn sm', type: 'button', text: obj[key] ? 'Заменить фото' : 'Загрузить фото', onclick: () => fileIn.click() });
  const rm = h('button', { class: 'btn sm dng', type: 'button', text: 'Убрать', onclick: () => { obj[key] = ''; paint(); btn.textContent = 'Загрузить фото'; if (o.onChange) o.onChange(); } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    btn.disabled = true; btn.textContent = 'Загружаем…';
    try { obj[key] = await uploadFile(f); paint(); toast('Фото загружено'); if (o.onChange) o.onChange(); } catch (e) { fail(e); }
    btn.disabled = false; btn.textContent = 'Заменить фото'; fileIn.value = '';
  });
  paint();
  const extra = o.extra ? o.extra : null;
  return h('div', { class: 'photo-box' }, pv, h('div', { style: 'display:grid;gap:8px' }, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, btn, rm, extra), o.hint ? h('small', { text: o.hint, style: 'color:#5f7584' }) : null), fileIn);
}

/* ───── вход ───── */
function showLogin() {
  clearInterval(S.timer);
  const err = h('div', { class: 'err', role: 'alert' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: '', autofocus: '' });
  const btn = h('button', { class: 'btn pri', type: 'submit', text: 'Войти' });
  const form = h('form', null, h('h1', { text: 'Вход в админку' }), F('Пароль', pw), err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await api('POST', '/api/admin/login', { password: pw.value }); await start(); } catch (ex) { err.textContent = ex.message; pw.select(); }
    btn.disabled = false;
  });
  app.replaceChildren(h('div', { class: 'login' }, form));
  document.title = 'Вход — Админка';
}

/* ───── оболочка ───── */
const NAV = [['orders', 'Заказы'], ['products', 'Каталог'], ['categories', 'Категории'], ['design', 'Вид сайта'], ['contacts', 'Контакты и доставка'], ['telegram', 'Telegram'], ['account', 'Аккаунт']];
function badgeNode() { const n = S.data ? S.data.newOrders : 0; return n ? h('span', { class: 'badge', text: n }) : null; }
function shell() {
  const route = currentRoute();
  const side = h('nav', { class: 'side', 'aria-label': 'Разделы' },
    h('div', { class: 'logo' }, S.data.settings.brand.name, h('small', { text: 'Админка' })),
    NAV.map(([id, name]) => h('a', { class: 'nav' + (id === route ? ' on' : ''), href: '#' + id, 'aria-current': id === route ? 'page' : null }, name, id === 'orders' ? badgeNode() : null)),
    h('div', { class: 'sp' }),
    h('a', { class: 'ghost', href: '/', target: '_blank', rel: 'noopener', text: 'Открыть сайт ↗' }),
    h('button', { class: 'ghost', type: 'button', text: 'Выйти', onclick: async () => { try { await api('POST', '/api/admin/logout', {}); } catch { /* ок */ } showLogin(); } }));
  const main = h('main', { class: 'main', id: 'main' });
  app.replaceChildren(h('div', { class: 'shell' }, side, main));
  document.title = (S.data.newOrders ? `(${S.data.newOrders}) ` : '') + 'Админка';
  return main;
}
const currentRoute = () => { const r = location.hash.replace('#', ''); return NAV.some(([id]) => id === r) ? r : 'orders'; };
async function reload() { S.data = await api('GET', '/api/admin/data'); return S.data; }

async function route() {
  clearInterval(S.timer); S.dirty = false; S.frame = null;
  if (!S.data) return;
  const r = currentRoute();
  const main = shell();
  window.scrollTo(0, 0);
  try { await PAGES[r](main); } catch (e) { fail(e); }
}
window.addEventListener('hashchange', () => { if (S.data) route(); });
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ───── панель сохранения настроек ───── */
let saveNote, saveBtn;
function saveBar(extraSave) {
  saveNote = h('span', { text: 'Все изменения сохранены', style: 'color:#5f7584' });
  saveBtn = h('button', { class: 'btn pri', type: 'button', text: 'Сохранить', onclick: () => saveSettings(extraSave) });
  return h('div', { class: 'savebar' }, saveNote, saveBtn);
}
function markDirty() { S.dirty = true; if (saveNote) { saveNote.textContent = 'Есть несохранённые изменения'; saveNote.style.color = '#b0561a'; } }
async function saveSettings(before) {
  if (saveBtn) saveBtn.disabled = true;
  try {
    if (before) before();
    await api('PUT', '/api/admin/settings', S.data.settings);
    S.dirty = false;
    await reload();
    toast('Сохранено');
    // страница собирается заново: так редактор работает с свежими данными, а предпросмотр загружает сохранённый сайт
    const y = window.scrollY;
    await route();
    window.scrollTo(0, y);
    return true;
  } catch (e) { fail(e); return false; } finally { if (saveBtn) saveBtn.disabled = false; }
}

/* ───── заказы ───── */
const ST = { new: 'Новый', confirmed: 'Подтверждён', done: 'Выполнен', cancelled: 'Отменён' };
const fmtDate = (iso, tz) => { try { return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return iso; } };

async function pageOrders(main) {
  const list = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Заказы' }), h('p', { text: 'Новые заказы приходят сюда и в Telegram. Список обновляется сам.' }))), tabs, list);
  let tz = S.data.settings.timezone;
  async function load(silent) {
    const r = await api('GET', '/api/admin/orders');
    S.orders = r.orders; tz = r.tz;
    S.data.newOrders = S.orders.filter((o) => o.status === 'new').length;
    document.title = (S.data.newOrders ? `(${S.data.newOrders}) ` : '') + 'Админка';
    const bd = document.querySelector('.side a.nav .badge'); const link = document.querySelector('.side a[href="#orders"]');
    if (bd) bd.remove(); if (link && S.data.newOrders) link.append(badgeNode());
    paint(); if (!silent) return;
  }
  function paintTabs() {
    const counts = { new: 0, confirmed: 0, done: 0, cancelled: 0 }; S.orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    tabs.replaceChildren(...[['new', 'Новые'], ['confirmed', 'В работе'], ['done', 'Выполненные'], ['cancelled', 'Отменённые'], ['all', 'Все']].map(([id, t]) =>
      h('button', { class: 'tab' + (S.ordersFilter === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(S.ordersFilter === id), onclick: () => { S.ordersFilter = id; paint(); } },
        t + (id === 'all' ? ` (${S.orders.length})` : ` (${counts[id] || 0})`))));
  }
  function paint() {
    paintTabs();
    const items = S.orders.filter((o) => S.ordersFilter === 'all' || o.status === S.ordersFilter);
    list.replaceChildren();
    if (!items.length) { list.append(h('div', { class: 'empty', text: S.ordersFilter === 'new' ? 'Новых заказов нет. Когда покупатель оформит заказ, он появится здесь.' : 'Здесь пока пусто.' })); return; }
    items.forEach((o) => list.append(orderCard(o)));
  }
  function orderCard(o) {
    const setStatus = async (status) => { try { await api('PUT', '/api/admin/orders/' + o.id, { status }); await load(); toast('Статус: ' + ST[status]); } catch (e) { fail(e); } };
    const acts = [];
    if (o.status === 'new') acts.push(h('button', { class: 'btn sm ok', type: 'button', text: 'Подтвердить', onclick: () => setStatus('confirmed') }));
    if (o.status === 'new' || o.status === 'confirmed') acts.push(h('button', { class: 'btn sm', type: 'button', text: 'Выполнен', onclick: () => setStatus('done') }), h('button', { class: 'btn sm dng', type: 'button', text: 'Отменить', onclick: () => setStatus('cancelled') }));
    if (o.status === 'done' || o.status === 'cancelled') acts.push(h('button', { class: 'btn sm', type: 'button', text: 'Вернуть в работу', onclick: () => setStatus('confirmed') }));
    acts.push(h('button', { class: 'btn sm', type: 'button', text: 'Отправить в Telegram снова', onclick: async () => { try { const r = await api('POST', `/api/admin/orders/${o.id}/resend`, {}); toast(r.ok ? 'Отправлено в Telegram' : 'Не отправлено: ' + r.error, !r.ok); await load(); } catch (e) { fail(e); } } }));
    acts.push(h('button', { class: 'btn sm dng', type: 'button', text: 'Удалить', onclick: async () => { if (!confirmBox(`Удалить заказ №${o.number}? Это нельзя отменить.`)) return; try { await api('DELETE', '/api/admin/orders/' + o.id); await load(); toast('Удалено'); } catch (e) { fail(e); } } }));
    const c = o.customer;
    const tg = o.tg && o.tg.sent ? h('span', { class: 'tg good', text: '✓ Уведомление в Telegram отправлено' }) : h('span', { class: 'tg bad', text: 'Telegram: ' + (o.tg && o.tg.error ? o.tg.error : 'не отправлено') });
    return h('article', { class: 'card order ' + o.status },
      h('div', { class: 'o-head' }, h('h3', { text: `Заказ №${o.number}` }), h('span', null, h('span', { class: 'pill ' + o.status, text: ST[o.status] }), '  ', fmtDate(o.createdAt, tz))),
      h('div', { class: 'o-cols' },
        h('div', { class: 'o-info' },
          h('div', null, h('b', { text: 'Клиент' }), c.name),
          h('div', null, h('b', { text: 'Телефон' }), h('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, ''), text: c.phone })),
          h('div', null, h('b', { text: 'Адрес' }), c.address),
          c.comment ? h('div', null, h('b', { text: 'Комментарий' }), c.comment) : null),
        h('div', null,
          h('table', { class: 'o-items' }, h('tbody', null, o.items.map((it) => h('tr', null, h('td', { text: `${it.name} — ${it.qty} × ${it.qtyLabel || 'шт'}` }), h('td', { text: (it.approx ? '≈ ' : '') + rub(it.price * it.qty) }))))),
          o.fee ? h('div', { class: 'o-total', style: 'font-size:15px;font-weight:500' }, h('span', { text: 'Доставка' }), h('span', { text: rub(o.fee) })) : null,
          h('div', { class: 'o-total' }, h('span', { text: 'Итого' }), h('span', { text: (o.approx ? '≈ ' : '') + rub(o.total) })),
          o.approx ? h('small', { text: 'Есть товары с плавающим весом: сумму уточните по факту.', style: 'color:#5f7584' }) : null)),
      h('div', { class: 'o-acts' }, acts), h('div', { style: 'margin-top:8px' }, tg));
  }
  await load();
  S.timer = setInterval(() => { load(true).catch(() => {}); }, 30000);
}

/* ───── каталог ───── */
const prodBody = (p, patch = {}) => ({ name: p.name, cat: p.cat, desc: p.desc, price: p.price, oldPrice: p.oldPrice, unit: p.unit, qtyLabel: p.qtyLabel, note: p.note, badge: p.badge, featured: p.featured, approx: p.approx, art: p.art || '', qtyMin: p.qtyMin, photo: p.photo, available: p.available, hidden: p.hidden, ...patch });

async function pageProducts(main) {
  const d = S.data;
  const st = { q: '', cat: '' };
  const tbody = h('tbody');
  const q = h('input', { type: 'search', placeholder: 'Найти позицию', 'aria-label': 'Поиск по каталогу' });
  const catSel = h('select', { 'aria-label': 'Категория' }, h('option', { value: '', text: 'Все категории' }), d.categories.map((c) => h('option', { value: c.id, text: c.name })));
  q.addEventListener('input', () => { st.q = q.value; paint(); });
  catSel.addEventListener('change', () => { st.cat = catSel.value; paint(); });
  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Каталог' }), h('p', { text: 'Цена и наличие меняются прямо в таблице. Остальное — по кнопке «Изменить».' })),
    h('button', { class: 'btn pri', type: 'button', text: '+ Добавить позицию', onclick: () => openProduct(null) })),
  h('div', { class: 'bar' }, h('div', { class: 'grow' }, q), h('div', null, catSel)),
  h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Название', 'Цена, ₽', 'В наличии', ''].map((t) => h('th', { text: t })))), tbody));
  const catOf = (id) => d.categories.find((c) => c.id === id);
  async function savePatch(p, patch, okMsg) {
    try { const r = await api('PUT', '/api/admin/products/' + p.id, prodBody(p, patch)); Object.assign(p, r.product); toast(okMsg || 'Сохранено'); paint(); } catch (e) { fail(e); paint(); }
  }
  async function move(p, dir, visible) {
    const full = d.products.slice(); const i = full.indexOf(p); const j = full.indexOf(visible[visible.indexOf(p) + dir]);
    if (i < 0 || j < 0) return;
    [full[i], full[j]] = [full[j], full[i]];
    try { await api('POST', '/api/admin/products/reorder', { ids: full.map((x) => x.id) }); await reload(); main.replaceChildren(); route(); } catch (e) { fail(e); }
  }
  function paint() {
    const w = st.q.trim().toLowerCase().replace(/ё/g, 'е');
    const vis = d.products.filter((p) => (!st.cat || p.cat === st.cat) && (!w || (p.name + ' ' + p.desc).toLowerCase().replace(/ё/g, 'е').includes(w)));
    tbody.replaceChildren();
    if (!vis.length) { tbody.append(h('tr', null, h('td', { colspan: 5 }, h('div', { class: 'empty', text: 'Ничего не найдено' })))); return; }
    vis.forEach((p) => {
      const c = catOf(p.cat);
      const price = h('input', { class: 'price-in', type: 'number', min: 0, step: 10, value: p.price, 'aria-label': 'Цена: ' + p.name, inputmode: 'numeric' });
      price.addEventListener('change', () => { const v = Math.max(0, Math.round(Number(price.value) || 0)); if (v !== p.price) savePatch(p, { price: v }, 'Цена сохранена'); });
      const sw = h('input', { type: 'checkbox', 'aria-label': 'В наличии: ' + p.name }); sw.checked = p.available;
      sw.addEventListener('change', () => savePatch(p, { available: sw.checked }, sw.checked ? 'В наличии' : 'Нет в наличии'));
      tbody.append(h('tr', { class: p.hidden ? 'off' : '' },
        h('td', null, h('div', { class: 'thumb' }, p.photo ? h('img', { src: p.photo, alt: '', loading: 'lazy' }) : (c ? artIcon(c.art, c.accent) : null))),
        h('td', null, h('button', { class: 'pname', type: 'button', text: p.name, onclick: () => openProduct(p) }), p.hidden ? h('span', { class: 'tag', text: 'скрыт' }) : null, p.featured ? h('span', { class: 'tag', style: 'background:#fbf0d3;color:#7a5a0a', text: 'сегодня' }) : null,
          h('div', { class: 'psub', text: `${c ? c.name : '—'} · ${p.unit}` })),
        h('td', null, price),
        h('td', null, h('label', { class: 'switch' }, sw, h('i'))),
        h('td', null, h('div', { class: 'acts' },
          h('button', { class: 'icon-btn', type: 'button', title: 'Выше', 'aria-label': 'Поднять выше', text: '↑', onclick: () => move(p, -1, vis), disabled: vis.indexOf(p) === 0 }),
          h('button', { class: 'icon-btn', type: 'button', title: 'Ниже', 'aria-label': 'Опустить ниже', text: '↓', onclick: () => move(p, 1, vis), disabled: vis.indexOf(p) === vis.length - 1 }),
          h('button', { class: 'btn sm', type: 'button', text: 'Изменить', onclick: () => openProduct(p) })))));
    });
  }
  paint();

  function openProduct(orig) {
    const isNew = !orig;
    const f = orig ? { ...orig } : { name: '', cat: (st.cat || (d.categories[0] || {}).id || ''), desc: '', price: 0, oldPrice: 0, unit: 'за 1 кг', qtyLabel: 'кг', note: '', badge: '', featured: false, approx: false, qtyMin: 1, photo: '', available: true, hidden: false };
    const dlg = h('dialog', { 'aria-labelledby': 'dlgT' });
    const err = h('div', { class: 'err', role: 'alert' });
    const catS = h('select', null, d.categories.map((c) => h('option', { value: c.id, text: c.name }))); catS.value = f.cat; catS.addEventListener('change', () => { f.cat = catS.value; });
    const badgeS = h('select', null, Object.entries(d.badges).map(([v, t]) => h('option', { value: v, text: t || 'Без отметки' }))); badgeS.value = f.badge; badgeS.addEventListener('change', () => { f.badge = badgeS.value; });
    const artP = h('select', null, [h('option', { value: '', text: 'Как у категории' }), ...d.artKeys.map((k) => h('option', { value: k, text: ART_NAMES[k] || k }))]); artP.value = f.art || ''; artP.addEventListener('change', () => { f.art = artP.value; });
    const dl = h('datalist', { id: 'units' }, ['за 1 кг', 'за 500 г', 'за 250 г', 'за 100 г', 'за 1 шт', 'за упаковку', 'за порцию'].map((v) => h('option', { value: v })));
    const dl2 = h('datalist', { id: 'qlabels' }, ['кг', 'уп.', 'шт', 'порц.', 'банка', '100 г'].map((v) => h('option', { value: v })));
    const body = h('div', { class: 'dlg-b' },
      F('Название', bind(f, 'name', { max: 120, settings: false, ph: 'Например: Икра нерки' })),
      h('div', { class: 'grid2' }, F('Категория', catS), F('Отметка на карточке', badgeS)),
      h('div', { class: 'grid3' },
        F('Цена, ₽', bind(f, 'price', { type: 'number', settings: false, step: 10 })),
        F('Старая цена (зачёркнутая)', bind(f, 'oldPrice', { type: 'number', settings: false, step: 10 }), 'Необязательно'),
        F('Цена за…', bind(f, 'unit', { max: 40, list: 'units', settings: false }), 'Подпись под ценой')),
      h('div', { class: 'grid2' },
        F('Единица в корзине', bind(f, 'qtyLabel', { max: 20, list: 'qlabels', settings: false }), 'Например: кг, уп., шт'),
        F('Минимум в заказе', bind(f, 'qtyMin', { type: 'number', min: 1, settings: false }))),
      F('Заметка под названием', bind(f, 'note', { max: 120, settings: false, ph: 'Например: Вес тушки 6–7 кг' })),
      F('Описание', bind(f, 'desc', { area: true, rows: 3, max: 600, settings: false }), 'Коротко: вкус, фасовка, как подавать. Без медицинских обещаний.'),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Фото' }), imgPicker(f, 'photo', { hint: 'Лучше горизонтальное, 4:3. Размер сожмётся автоматически.', empty: 'Нет фото — покажем значок' })),
      F('Значок, если нет фото', artP, 'Рисунок на карточке без фото'),
      h('div', { class: 'grid2' },
        check(f, 'available', 'В наличии', { settings: false }),
        check(f, 'featured', 'Показать в блоке «Сегодня на льду»', { settings: false }),
        check(f, 'approx', 'Вес плавающий (итог уточняем по факту)', { settings: false }),
        check(f, 'hidden', 'Скрыть с сайта', { settings: false })),
      err, dl, dl2);
    const save = h('button', { class: 'btn pri', type: 'button', text: 'Сохранить' });
    const foot = h('div', { class: 'dlg-f' },
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        !isNew ? h('button', { class: 'btn dng', type: 'button', text: 'Удалить', onclick: async () => { if (!confirmBox(`Удалить «${orig.name}»?`)) return; try { await api('DELETE', '/api/admin/products/' + orig.id); await reload(); dlg.close(); route(); toast('Удалено'); } catch (e) { err.textContent = e.message; } } }) : null,
        !isNew ? h('button', { class: 'btn', type: 'button', text: 'Дублировать', onclick: async () => { try { await api('POST', '/api/admin/products', prodBody(f, { name: f.name + ' (копия)' })); await reload(); dlg.close(); route(); toast('Копия создана'); } catch (e) { err.textContent = e.message; } } }) : null),
      h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn', type: 'button', text: 'Отмена', onclick: () => dlg.close() }), save));
    dlg.append(h('div', { class: 'dlg-h' }, h('h2', { id: 'dlgT', text: isNew ? 'Новая позиция' : 'Изменить позицию' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', text: '✕', onclick: () => dlg.close() })), body, foot);
    save.addEventListener('click', async () => {
      err.textContent = '';
      if (!String(f.name).trim()) { err.textContent = 'Укажите название'; return; }
      save.disabled = true;
      try {
        if (isNew) await api('POST', '/api/admin/products', prodBody(f)); else await api('PUT', '/api/admin/products/' + orig.id, prodBody(f));
        await reload(); dlg.close(); route(); toast('Сохранено');
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }
}

/* ───── категории ───── */
async function pageCategories(main) {
  const d = S.data;
  const cats = d.categories.map((c) => ({ ...c }));
  const list = h('div');
  const counts = (id) => d.products.filter((p) => p.cat === id).length;
  function paint() {
    list.replaceChildren();
    cats.forEach((c, i) => {
      const pv = h('div', { class: 'pv' }); const drawPv = () => { pv.style.background = `color-mix(in srgb, ${c.accent} 16%, #fff)`; pv.replaceChildren(artIcon(c.art, c.accent)); }; drawPv();
      const artS = h('select', { 'aria-label': 'Значок' }, d.artKeys.map((k) => h('option', { value: k, text: ART_NAMES[k] || k }))); artS.value = c.art; artS.addEventListener('change', () => { c.art = artS.value; drawPv(); });
      const col = h('input', { type: 'color', value: c.accent, 'aria-label': 'Цвет значка' }); col.addEventListener('input', () => { c.accent = col.value; drawPv(); });
      const name = h('input', { type: 'text', value: c.name, maxlength: 60, 'aria-label': 'Название категории' }); name.addEventListener('input', () => { c.name = name.value; });
      list.append(h('div', { class: 'crow' }, pv, name, artS, col,
        h('div', { class: 'acts' },
          h('span', { class: 'psub', text: c.id && counts(c.id) ? `${counts(c.id)} поз.` : '' }),
          h('button', { class: 'icon-btn', type: 'button', text: '↑', 'aria-label': 'Выше', disabled: i === 0, onclick: () => { [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; paint(); } }),
          h('button', { class: 'icon-btn', type: 'button', text: '↓', 'aria-label': 'Ниже', disabled: i === cats.length - 1, onclick: () => { [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; paint(); } }),
          h('button', { class: 'btn sm dng', type: 'button', text: 'Удалить', onclick: () => { if (c.id && counts(c.id)) { toast(`В категории «${c.name}» есть позиции (${counts(c.id)}). Сначала перенесите их в другую категорию.`, true); return; } cats.splice(i, 1); paint(); } }))));
    });
  }
  paint();
  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Категории' }), h('p', { text: 'Порядок здесь — порядок на сайте. Значок показывается, пока у позиции нет фото.' }))),
    card(null, null, list, h('div', { style: 'display:flex;gap:10px;margin-top:16px;flex-wrap:wrap' },
      h('button', { class: 'btn', type: 'button', text: '+ Добавить категорию', onclick: () => { cats.push({ id: '', name: 'Новая категория', art: 'fish', accent: '#0B5E8E' }); paint(); } }),
      h('button', { class: 'btn pri', type: 'button', text: 'Сохранить категории', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('PUT', '/api/admin/categories', { categories: cats }); await reload(); toast('Категории сохранены'); route(); } catch (ex) { fail(ex); e.currentTarget.disabled = false; } } }))));
}

/* ───── вид сайта ───── */
function listEditor(arr, mk, opts = {}) {
  const wrap = h('div', { class: 'list-ed' });
  const paint = () => {
    wrap.replaceChildren();
    arr.forEach((item, i) => wrap.append(h('div', { class: 'li' }, h('div', { class: 'two' }, mk(item, i)),
      h('div', { class: 'acts' },
        h('button', { class: 'icon-btn', type: 'button', text: '↑', 'aria-label': 'Выше', disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); paint(); } }),
        h('button', { class: 'icon-btn', type: 'button', text: '✕', 'aria-label': 'Убрать', onclick: () => { arr.splice(i, 1); markDirty(); paint(); } })))));
    if (arr.length < (opts.max || 8)) wrap.append(h('div', null, h('button', { class: 'btn sm', type: 'button', text: opts.add || '+ Добавить', onclick: () => { arr.push(opts.blank()); markDirty(); paint(); } })));
  };
  paint();
  return wrap;
}

async function pageDesign(main) {
  const s = S.data.settings, dz = s.design;
  const frame = h('iframe', { src: '/', title: 'Предпросмотр сайта', loading: 'lazy' });
  S.frame = frame;
  const live = () => {
    try {
      const doc = frame.contentDocument; if (!doc || !doc.documentElement) return;
      const r = doc.documentElement.style;
      for (const k of Object.keys(dz.colors)) r.setProperty('--' + k, dz.colors[k]);
      r.setProperty('--r', dz.radius + 'px');
      r.setProperty('--f-head', HEAD[dz.fontHead][0]); r.setProperty('--w-head', HEAD[dz.fontHead][1]); r.setProperty('--f-body', BODY[dz.fontBody]);
    } catch { /* ещё не загружено */ }
  };
  frame.addEventListener('load', live);

  const palBox = h('div', { class: 'palettes' });
  const colorsBox = h('div', { class: 'colors' });
  const paintPal = () => {
    palBox.replaceChildren(...Object.entries(S.data.palettes).map(([k, p]) => h('button', {
      class: 'pal' + (dz.palette === k ? ' on' : ''), type: 'button',
      onclick: () => { dz.palette = k; for (const c of Object.keys(dz.colors)) dz.colors[c] = p[c]; markDirty(); paintPal(); paintColors(); live(); },
    }, h('span', { class: 'sw' }, ['navy', 'ocean', 'red', 'gold', 'ice'].map((c) => h('i', { style: 'background:' + p[c] }))), p.name)));
  };
  const paintColors = () => {
    colorsBox.replaceChildren(...Object.keys(dz.colors).map((k) => {
      const i = h('input', { type: 'color', value: dz.colors[k], 'aria-label': COLOR_NAMES[k] || k });
      i.addEventListener('input', () => { dz.colors[k] = i.value; dz.palette = 'custom'; markDirty(); paintPal(); live(); });
      return h('label', { class: 'color' }, i, COLOR_NAMES[k] || k);
    }));
  };
  paintPal(); paintColors();
  const radius = h('input', { type: 'range', min: 0, max: 28, step: 1, value: dz.radius, 'aria-label': 'Скругление углов' });
  radius.addEventListener('input', () => { dz.radius = Number(radius.value); markDirty(); live(); });
  const fontsHead = Object.entries(S.data.fontsHead), fontsBody = Object.entries(S.data.fontsBody);

  const productOpts = [['', '— первая подходящая —'], ...S.data.products.map((p) => [p.id, p.name])];
  const left = h('div', null,
    card('Главный экран', 'Первое, что видит покупатель.',
      h('div', { class: 'grid2' },
        F('Заголовок', bind(s.hero, 'title', { max: 120 }), null, 'span2'),
        F('Подзаголовок', bind(s.hero, 'subtitle', { area: true, rows: 2 }), null, 'span2'),
        F('Главная кнопка', bind(s.hero, 'btnPrimary', { max: 40 })),
        F('Кнопка звонка', bind(s.hero, 'btnSecondary', { max: 40 })),
        F('Товар на подвешенном ценнике', select(s.hero, 'tagProductId', productOpts), 'Его цена и кнопка «В корзину» висят на главной'),
        F('Текст на золотой печати', bind(s.hero, 'stamp', { max: 80 }), 'Пусто — печати не будет')),
      h('div', { class: 'field', style: 'margin-top:14px' }, h('span', { class: 'lab', text: 'Главное фото' }),
        imgPicker(s.hero, 'image', { onChange: markDirty, empty: 'Нет фото', hint: 'Широкое фото ассортимента: икра, раки, креветки. Фото из архива — временное.', extra: h('button', { class: 'btn sm', type: 'button', text: 'Вернуть временное', onclick: () => { s.hero.image = '/img/hero-default.jpg'; markDirty(); route(); } }) }))),

    card('Блоки на странице', 'Включайте и выключайте разделы.',
      h('div', { class: 'grid2' },
        check(s.sections, 'ticker', 'Красная бегущая строка'), check(s.sections, 'trust', 'Четыре преимущества'),
        check(s.sections, 'featured', 'Список «Сегодня на льду»'), check(s.sections, 'fresh', 'Тёмный блок «Свежая поставка»'),
        check(s.sections, 'steps', 'Как заказать'), check(s.sections, 'delivery', 'Доставка'))),

    card('Бегущая строка', 'Короткие фразы, которые идут по красной ленте.', listEditor(s.ticker, (item, i) => bind(s.ticker, i, { max: 80 }), { max: 10, add: '+ Фраза', blank: () => '' })),

    card('Преимущества', null, listEditor(s.trust, (it) => [bind(it, 'title', { max: 50, ph: 'Заголовок' }), bind(it, 'text', { max: 160, ph: 'Пояснение' })], { max: 4, add: '+ Преимущество', blank: () => ({ title: '', text: '' }) })),

    card('Сегодня на льду и каталог', null,
      h('div', { class: 'grid2' },
        F('Название списка', bind(s, 'featuredTitle', { max: 60 })),
        F('Заголовок каталога', bind(s, 'catalogTitle', { max: 60 })),
        F('Подсказка под заголовком каталога', bind(s, 'catalogHint', { max: 200 }), null, 'span2'),
        F('Свежая поставка: заголовок', bind(s.fresh, 'title', { max: 60 })),
        F('Свежая поставка: кнопка', bind(s.fresh, 'button', { max: 40 })),
        F('Свежая поставка: текст', bind(s.fresh, 'text', { area: true, rows: 2 }), null, 'span2'))),

    card('Как заказать', null, F('Заголовок', bind(s, 'stepsTitle', { max: 60 })), h('div', { style: 'height:12px' }),
      listEditor(s.steps, (it) => [bind(it, 'title', { max: 50, ph: 'Шаг' }), bind(it, 'text', { max: 200, ph: 'Пояснение' })], { max: 5, add: '+ Шаг', blank: () => ({ title: '', text: '' }) })),

    card('Цвета и шрифты', 'Изменения видно справа сразу. Чтобы они появились на сайте, нажмите «Сохранить».',
      h('h3', { text: 'Готовые схемы', style: 'margin-bottom:10px' }), palBox,
      h('h3', { text: 'Свои цвета', style: 'margin:18px 0 10px' }), colorsBox,
      h('div', { class: 'grid2', style: 'margin-top:18px' },
        F('Шрифт заголовков', select(dz, 'fontHead', fontsHead, { onChange: live })),
        F('Шрифт текста', select(dz, 'fontBody', fontsBody, { onChange: live })),
        F('Скругление углов', radius),
        F('Вид карточек', select(dz, 'tagStyle', [['tag', 'Ценник: срезанный угол, дырочка, отрывная часть'], ['card', 'Простая карточка']])))),

    card('Название и логотип', null,
      h('div', { class: 'grid2' },
        F('Название сайта', bind(s.brand, 'name', { max: 60 })),
        F('Подвал: текст', bind(s.footer, 'text', { max: 120 })),
        F('Шапка: первая строка', bind(s.brand, 'line1', { max: 30 })),
        F('Шапка: вторая строка', bind(s.brand, 'line2', { max: 30 }))),
      h('div', { class: 'field', style: 'margin-top:14px' }, h('span', { class: 'lab', text: 'Логотип (вместо значка и названия в шапке)' }), imgPicker(s.brand, 'logo', { onChange: markDirty, empty: 'Нет логотипа', hint: 'Лучше с прозрачным или тёмным фоном.' }))),

    card('Для поисковиков', 'Так сайт выглядит в Яндексе и Google.',
      h('div', { class: 'grid2' },
        F('Заголовок страницы', bind(s.seo, 'title', { max: 120 }), null, 'span2'),
        F('Описание', bind(s.seo, 'description', { area: true, rows: 3 }), null, 'span2'),
        F('Адрес сайта', bind(s.seo, 'siteUrl', { ph: 'https://ваш-сайт.ru' }), 'Нужен для ссылок в Telegram и поисковиков'))));

  const right = h('aside', { class: 'preview-wrap' },
    h('div', { class: 'cap' }, h('span', { text: 'Так выглядит сайт' }), h('button', { class: 'btn sm', type: 'button', text: 'Обновить', onclick: () => frame.contentWindow.location.reload() })),
    h('div', { class: 'frame' }, frame));
  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Вид сайта' }), h('p', { text: 'Тексты, фото, цвета, шрифты и блоки. Справа — живой предпросмотр.' }))),
    h('div', { class: 'editor' }, left, right), saveBar());
}

/* ───── контакты и доставка ───── */
async function pageContacts(main) {
  const s = S.data.settings;
  const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const dateIn = bind(s.order, 'pricesDate', { type: 'date' });
  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Контакты и доставка' }), h('p', { text: 'Это видно на сайте и в письме покупателю.' }))),
    card('Контакты', null, h('div', { class: 'grid2' },
      F('Телефон', bind(s.contacts, 'phone', { type: 'tel', max: 30 }), 'По нему звонят с телефона одним нажатием'),
      F('Подпись под телефоном', bind(s.contacts, 'phoneNote', { max: 120 })),
      F('Адрес / район', bind(s.contacts, 'address', { max: 120 })),
      F('Часы работы', bind(s.contacts, 'hours', { max: 120, ph: 'Ежедневно с 10 до 20' })),
      F('ВКонтакте', bind(s.contacts, 'vk', { ph: 'https://vk.ru/…' })),
      F('Telegram', bind(s.contacts, 'telegram', { ph: '@имя или ссылка' }), 'Для связи покупателей, не для заказов'),
      F('WhatsApp', bind(s.contacts, 'whatsapp', { type: 'tel', ph: '79221169999' }), 'Только цифры, с кодом страны'))),
    card('Доставка', 'Ноль в поле — значит «бесплатно» или «без ограничений».', h('div', { class: 'grid3' },
      F('Заголовок блока', bind(s.delivery, 'title', { max: 80 })),
      F('Стоимость доставки, ₽', bind(s.delivery, 'fee', { type: 'number', step: 50 })),
      F('Бесплатно от суммы, ₽', bind(s.delivery, 'freeFrom', { type: 'number', step: 100 })),
      F('Минимальный заказ, ₽', bind(s.delivery, 'minOrder', { type: 'number', step: 100 })),
      F('Описание', bind(s.delivery, 'text', { area: true, rows: 3 }), null, 'span2'))),
    card('Оформление заказа', null, h('div', { class: 'grid2' },
      F('Цены актуальны на', dateIn, 'Показывается в каталоге. Обновляйте, когда меняете прайс.'),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: ' ' }), h('div', null, h('button', { class: 'btn', type: 'button', text: 'Поставить сегодняшнюю дату', onclick: () => { s.order.pricesDate = today(); dateIn.value = s.order.pricesDate; markDirty(); } }))),
      F('Пояснение под кнопкой «Отправить заказ»', bind(s.order, 'note', { area: true, rows: 3 }), null, 'span2'),
      F('Сообщение после заказа', bind(s.order, 'success', { area: true, rows: 3 }), null, 'span2'))),
    saveBar());
}

/* ───── Telegram ───── */
async function pageTelegram(main) {
  const s = S.data.settings, tg = s.telegram;
  let token = '', clear = false;
  const tokIn = h('input', { type: 'password', autocomplete: 'off', placeholder: tg.tokenSet ? `Сохранён: ${tg.tokenHint}. Чтобы заменить, вставьте новый` : '123456789:AA…', spellcheck: 'false' });
  tokIn.addEventListener('input', () => { token = tokIn.value.trim(); clear = false; markDirty(); });
  const chatIn = bind(tg, 'chatIds', { ph: '123456789 или -1001234567890' });
  const found = h('div', { class: 'chips' });
  const status = h('div', { class: 'tg', role: 'status', style: 'margin-top:10px' });
  const validToken = () => !token || /^\d+:[\w-]{20,}$/.test(token);
  const apply = () => { if (!validToken()) throw new Error('Токен выглядит неправильно. Скопируйте его из @BotFather целиком, вместе с двоеточием.'); tg.token = clear ? '__clear__' : token; };

  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Заказы в Telegram' }), h('p', { text: 'Каждый новый заказ придёт сообщением в ваш чат. Заказ сохраняется на сайте, даже если Telegram недоступен.' }))),
    card('Как подключить', null, h('ol', { class: 'steps' },
      h('li', null, h('b', { text: 'Создайте бота. ' }), 'В Telegram откройте ', h('a', { href: 'https://t.me/BotFather', target: '_blank', rel: 'noopener', text: '@BotFather' }), ', отправьте /newbot, придумайте имя. Он пришлёт токен — длинную строку с двоеточием.'),
      h('li', null, h('b', { text: 'Вставьте токен ниже. ' }), 'Он хранится на сервере и не показывается на сайте.'),
      h('li', null, h('b', { text: 'Напишите боту любое сообщение ' }), '(найдите его по имени и нажмите «Запустить»). Если хотите получать заказы в группу, добавьте бота в группу и напишите там.'),
      h('li', null, h('b', { text: 'Нажмите «Найти мой чат». ' }), 'Выберите свой чат из списка — номер подставится сам.'),
      h('li', null, h('b', { text: 'Нажмите «Отправить тест». ' }), 'Если сообщение пришло, всё работает. Сохраните настройки.'))),
    card('Настройки', null,
      check(tg, 'enabled', 'Присылать заказы в Telegram'), h('div', { style: 'height:12px' }),
      h('div', { class: 'grid2' },
        F('Токен бота', tokIn),
        F('Номер чата (chat_id)', chatIn, 'Можно несколько через запятую — например, вам и менеджеру')),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;margin-top:16px' },
        h('button', { class: 'btn', type: 'button', text: 'Найти мой чат', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; found.replaceChildren(); status.className = 'tg'; status.textContent = 'Ищем…';
          try {
            if (!validToken()) throw new Error('Токен выглядит неправильно.');
            const r = await api('POST', '/api/admin/telegram/detect', { token });
            if (!r.chats.length) { status.className = 'tg bad'; status.textContent = 'Чатов не нашли. Напишите боту любое сообщение в Telegram и нажмите ещё раз.'; }
            else { status.textContent = 'Нажмите на свой чат:'; r.chats.forEach((c) => found.append(h('button', { class: 'btn sm', type: 'button', text: `${c.title} (${c.id})`, onclick: () => { const cur = tg.chatIds.split(/[\s,]+/).filter(Boolean); if (!cur.includes(c.id)) cur.push(c.id); tg.chatIds = cur.join(', '); chatIn.value = tg.chatIds; markDirty(); } }))); }
          } catch (ex) { status.className = 'tg bad'; status.textContent = ex.message; }
          b.disabled = false;
        } }),
        h('button', { class: 'btn', type: 'button', text: 'Отправить тест', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; status.className = 'tg'; status.textContent = 'Отправляем…';
          try {
            if (!validToken()) throw new Error('Токен выглядит неправильно.');
            const r = await api('POST', '/api/admin/telegram/test', { token, chatIds: tg.chatIds });
            status.className = r.ok ? 'tg good' : 'tg bad'; status.textContent = r.ok ? '✓ Тест отправлен. Проверьте Telegram.' : 'Не получилось: ' + r.error;
          } catch (ex) { status.className = 'tg bad'; status.textContent = ex.message; }
          b.disabled = false;
        } }),
        tg.tokenSet ? h('button', { class: 'btn dng', type: 'button', text: 'Удалить токен', onclick: () => { if (!confirmBox('Удалить токен? Заказы перестанут приходить в Telegram.')) return; clear = true; token = ''; tokIn.value = ''; tokIn.placeholder = 'Токен будет удалён после сохранения'; markDirty(); } }) : null),
      status, found),
    saveBar(apply));
}

/* ───── аккаунт ───── */
async function pageAccount(main) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password' });
  const nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'err', role: 'alert' });
  main.append(h('div', { class: 'top' }, h('div', null, h('h1', { text: 'Аккаунт' }))),
    card('Сменить пароль', 'Пароль — не короче 8 символов.', h('div', { class: 'grid3' }, F('Текущий пароль', cur), F('Новый пароль', nw), F('Ещё раз новый', nw2)), err,
      h('button', { class: 'btn pri', type: 'button', text: 'Сменить пароль', onclick: async (e) => {
        err.textContent = '';
        if (nw.value !== nw2.value) { err.textContent = 'Новые пароли не совпадают'; return; }
        e.currentTarget.disabled = true;
        try { await api('POST', '/api/admin/password', { current: cur.value, next: nw.value }); cur.value = nw.value = nw2.value = ''; toast('Пароль изменён'); } catch (ex) { err.textContent = ex.message; }
        e.currentTarget.disabled = false;
      } })),
    card('Резервная копия', 'Каталог, настройки и заказы одним файлом. Токен Telegram в копию не попадает. Фото хранятся в папке data/uploads — копируйте её вместе с файлом.',
      h('a', { class: 'btn', href: '/api/admin/export', download: 'moreprodukty-backup.json', text: 'Скачать резервную копию' })));
}

const PAGES = { orders: pageOrders, products: pageProducts, categories: pageCategories, design: pageDesign, contacts: pageContacts, telegram: pageTelegram, account: pageAccount };

/* ───── старт ───── */
async function start() {
  try { await reload(); } catch (e) { if (e.message.includes('войдите') || e.message.includes('Нужно')) return; fail(e); return; }
  route();
}
(async () => {
  try {
    const me = await api('GET', '/api/admin/me');
    if (me.admin) await start(); else showLogin();
  } catch { showLogin(); }
})();
})();
