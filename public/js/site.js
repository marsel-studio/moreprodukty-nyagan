/* Морепродукты Нягань — витрина: каталог, корзина, заказ. Без библиотек. */
(() => {
'use strict';

const boot = JSON.parse(document.getElementById('boot').textContent);
const S = boot.settings;
const cats = boot.categories;
const products = boot.products;
const byId = new Map(products.map((p) => [p.id, p]));
const catById = new Map(cats.map((c) => [c.id, c]));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVG = 'http://www.w3.org/2000/svg';

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
function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}
const icon = (id, cls = 'ico') => svgEl('svg', { class: cls, 'aria-hidden': 'true' }, svgEl('use', { href: '/img/sprite.svg#' + id }));
const ART = { caviar: 'i-caviar', crab: 'i-crab', shrimp: 'i-shrimp', fish: 'i-fish', squid: 'i-squid', shell: 'i-mussel', dish: 'i-bowl', sweet: 'i-snack' };
function art(key, accent) {
  const s = svgEl('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' }, svgEl('use', { href: '/img/sprite.svg#' + (ART[key] || 'i-fish') }));
  s.style.setProperty('--a', accent);
  s.style.setProperty('--b', `color-mix(in srgb, ${accent} 45%, #fff)`);
  s.style.setProperty('--c', `color-mix(in srgb, ${accent} 40%, #000)`);
  return s;
}
const rub = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/[\s ]/g, ' ') + ' ₽';
const telHref = (phone) => { let d = String(phone).replace(/\D/g, ''); if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1); return 'tel:+' + d; };
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const BADGES = { new: 'Новинка', fresh: 'Свежая партия', hit: 'Хит', order: 'Под заказ', premium: 'Премиум' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const phone = S.contacts.phone;
const dateLabel = (() => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(S.order.pricesDate || '');
  if (!m) return '';
  try { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))); } catch { return ''; }
})();
function accentOf(p) { const c = catById.get(p.cat); return c ? c.accent : '#0B5E8E'; }
function artOf(p) { const c = catById.get(p.cat); return art(p.art && ART[p.art] ? p.art : (c ? c.art : 'fish'), accentOf(p)); }

/* ───── корзина (состояние) ───── */
let cart = {};
for (const [id, q] of Object.entries(store.get('mn_cart', {}))) {
  const p = byId.get(id);
  if (p && p.available && q > 0) cart[id] = Math.min(99, Math.max(p.qtyMin || 1, q | 0));
}
const saveCart = () => store.set('mn_cart', cart);
const cartItems = () => Object.keys(cart).map((id) => ({ p: byId.get(id), qty: cart[id] })).filter((x) => x.p);
const cartSum = () => cartItems().reduce((a, x) => a + x.p.price * x.qty, 0);
const cartCount = () => cartItems().length;

function ctlFill(el) {
  const p = byId.get(el.dataset.pid);
  el.replaceChildren();
  if (!p) return;
  if (!p.available) { el.append(h('span', { class: 'off-label', text: 'Нет в наличии' })); return; }
  const q = cart[p.id];
  if (!q) {
    el.append(h('button', { class: 'btn btn-red add', type: 'button', 'data-add': '', 'data-pid': p.id, 'aria-label': 'В корзину: ' + p.name }, icon('u-plus'), 'В корзину'));
  } else {
    el.append(h('div', { class: 'step', role: 'group', 'aria-label': p.name },
      h('button', { type: 'button', 'data-dec': '', 'data-pid': p.id, 'aria-label': 'Меньше' }, icon('u-minus')),
      h('output', { text: `${q} ${p.qtyLabel || 'шт'}` }),
      h('button', { type: 'button', 'data-inc': '', 'data-pid': p.id, 'aria-label': 'Больше' }, icon('u-plus'))));
  }
}
const ctl = (p) => { const el = h('div', { class: 'ctl', 'data-pid': p.id }); ctlFill(el); return el; };

function setQty(id, q) {
  const p = byId.get(id);
  if (!p || !p.available) return;
  q = Math.min(99, q | 0);
  if (q < (p.qtyMin || 1)) delete cart[id]; else cart[id] = q;
  saveCart();
  $$('.ctl[data-pid="' + id + '"]').forEach(ctlFill);
  paintBadges(true);
  if (!cart_el.hidden) renderLines();
}
function paintBadges(bump) {
  const n = cartCount(), sum = cartSum();
  const cc = $('#cartCount');
  cc.hidden = !n; cc.textContent = n;
  $('#cartSum').textContent = n ? rub(sum) : 'Корзина';
  $('#mbarCart').textContent = n ? `Корзина · ${rub(sum)}` : 'Корзина';
  if (bump) for (const b of [$('#cartBtn'), $('#mbarCart')]) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-del]');
  if (!t) return;
  const id = t.dataset.pid, p = byId.get(id);
  if (!p) return;
  if ('add' in t.dataset) setQty(id, p.qtyMin || 1);
  else if ('inc' in t.dataset) setQty(id, (cart[id] || 0) + 1);
  else if ('dec' in t.dataset) setQty(id, (cart[id] || 0) - 1);
  else if ('del' in t.dataset) setQty(id, 0);
});

/* ───── шапка и первый экран ───── */
function renderTop() {
  const b = S.brand;
  const brand = $('#brand');
  brand.setAttribute('aria-label', b.name + ' — наверх');
  if (b.logo) brand.append(h('img', { src: b.logo, alt: b.name }));
  else {
    const mark = h('span', { class: 'brand-mark' }, art('crab', '#D9342B'));
    brand.append(mark, h('span', { class: 'brand-text' }, h('span', { class: 'brand-1', text: b.line1 || b.name }), b.line2 ? h('span', { class: 'brand-2', text: b.line2 }) : null));
  }
  const tp = $('#topPhone'); tp.textContent = phone; tp.href = telHref(phone);
}

function stampEl(text) {
  let t = text.trim();
  if (!t) return null;
  while (t.length < 34) t += ' ' + text.trim();
  const circ = 2 * Math.PI * 70;
  const path = svgEl('path', { id: 'stampPath', d: 'M100,100 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0', fill: 'none' });
  const tx = svgEl('text', { class: 'stamp-text' });
  const tp = svgEl('textPath', { href: '#stampPath', textLength: String(Math.round(circ - 6)), lengthAdjust: 'spacing' });
  tp.textContent = t;
  tx.append(tp);
  const mark = svgEl('svg', { x: '60', y: '60', width: '80', height: '80', viewBox: '0 0 120 120', class: 'stamp-mark' }, svgEl('use', { href: '/img/sprite.svg#i-crab' }));
  const ring = svgEl('circle', { cx: '100', cy: '100', r: '98', class: 'stamp-ring' });
  const dash = svgEl('circle', { cx: '100', cy: '100', r: '86', fill: 'none', stroke: '#1a1405', 'stroke-width': '1.5', 'stroke-dasharray': '3 4', opacity: '.55' });
  return h('div', { class: 'stamp', 'aria-hidden': 'true' }, svgEl('svg', { viewBox: '0 0 200 200' }, ring, dash, path, tx, mark));
}

function renderHero() {
  const hero = S.hero;
  $('#heroTitle').textContent = hero.title;
  $('#heroLead').textContent = hero.subtitle;
  const hc = $('#heroCatalog'); hc.textContent = hero.btnPrimary || 'Смотреть каталог';
  const call = $('#heroCall'); call.href = telHref(phone); call.replaceChildren(icon('u-phone'), `${hero.btnSecondary || 'Позвонить'} ${phone}`);
  const vis = $('#heroVisual');
  const photo = h('div', { class: 'hero-photo' + (hero.image ? '' : ' hero-art') });
  if (hero.image) photo.append(h('img', { src: hero.image, alt: '', fetchpriority: 'high' }));
  else photo.append(art('crab', '#D9342B'));
  vis.append(photo);
  const tagP = byId.get(hero.tagProductId) || products.find((p) => p.featured && p.available) || products.find((p) => p.available);
  if (tagP) {
    vis.append(h('div', { class: 'hang' }, h('div', { class: 'hang-card' },
      h('div', { class: 'hang-name', text: tagP.name }),
      h('div', { class: 'hang-price', text: rub(tagP.price) }),
      h('div', { class: 'hang-unit', text: tagP.unit }),
      ctl(tagP))));
  }
  const st = stampEl(hero.stamp || '');
  if (st) vis.append(st);
}

function renderTicker() {
  const items = S.ticker.filter(Boolean);
  if (!S.sections.ticker || !items.length) { $('#ticker').hidden = true; return; }
  let half = [...items];
  while (half.length < 9) half = half.concat(items);
  const track = $('#tickerTrack');
  for (let i = 0; i < 2; i++) half.forEach((t) => track.append(h('span', { text: t })));
}

function renderTrust() {
  const list = S.trust.filter((t) => t.title);
  if (!S.sections.trust || !list.length) { $('#trust').hidden = true; return; }
  const ul = $('#trustList');
  list.forEach((t) => ul.append(h('li', null, h('b', { text: t.title }), t.text ? h('span', { text: t.text }) : null)));
}

function renderToday() {
  const featured = S.sections.featured ? products.filter((p) => p.featured).slice(0, 8) : [];
  const showFresh = S.sections.fresh && S.fresh.title;
  const root = $('#todayIn');
  if (!featured.length && !showFresh) { $('#today').hidden = true; return; }
  if (!featured.length || !showFresh) root.classList.add('solo');
  if (featured.length) {
    const led = h('div', { class: 'ledger' }, h('div', { class: 'ledger-head' },
      h('h2', { text: S.featuredTitle || 'Сегодня на льду' }),
      dateLabel ? h('p', { text: 'Цены на ' + dateLabel }) : null));
    for (const p of featured) {
      const ac = accentOf(p);
      const ra = h('span', { class: 'row-art' }, p.photo ? h('img', { src: p.photo, alt: '', loading: 'lazy' }) : artOf(p));
      ra.style.setProperty('--acc', ac);
      led.append(h('div', { class: 'row' }, ra,
        h('div', { class: 'row-name' }, p.name, p.note ? h('span', { class: 'row-sub', text: p.note }) : null),
        h('div', { class: 'row-price' }, rub(p.price), h('small', { text: p.unit })),
        ctl(p)));
    }
    root.append(led);
  }
  if (showFresh) {
    root.append(h('div', { class: 'fresh' },
      dateLabel ? h('span', { class: 'date', text: 'Обновлено ' + dateLabel }) : null,
      h('h2', { text: S.fresh.title }),
      S.fresh.text ? h('p', { text: S.fresh.text }) : null,
      h('a', { class: 'btn btn-gold', href: telHref(phone) }, icon('u-phone'), S.fresh.button || 'Узнать наличие')));
  }
}

/* ───── каталог ───── */
const state = { cat: 'all', q: '' };
const tagStyle = S.design.tagStyle === 'card' ? '' : ' tag';

function card(p) {
  const ac = accentOf(p);
  const media = h('div', { class: 'media' }, p.photo ? h('img', { src: p.photo, alt: p.name, loading: 'lazy' }) : artOf(p), p.badge && BADGES[p.badge] ? h('span', { class: 'badge ' + p.badge, text: BADGES[p.badge] }) : null);
  const note = p.note || (p.approx ? 'Вес плавающий — итог по факту' : '');
  const el = h('article', { class: 'card' + tagStyle + (p.available ? '' : ' off') },
    media,
    h('div', { class: 'card-b' },
      h('h4', { text: p.name }),
      note ? h('div', { class: 'note', text: note }) : null,
      p.desc ? h('p', { class: 'desc', text: p.desc }) : null),
    h('div', { class: 'stub' },
      h('div', null,
        h('div', { class: 'price' }, p.oldPrice > p.price ? h('s', { text: rub(p.oldPrice) }) : null, rub(p.price)),
        h('span', { class: 'unit', text: p.unit })),
      ctl(p)));
  el.style.setProperty('--acc', ac);
  return el;
}

function matches(p) {
  if (state.cat !== 'all' && p.cat !== state.cat) return false;
  const q = norm(state.q).trim();
  if (!q) return true;
  const c = catById.get(p.cat);
  const hay = norm([p.name, p.desc, p.note, c && c.name].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function renderGroups() {
  const root = $('#groups');
  root.replaceChildren();
  let shown = 0;
  for (const c of cats) {
    const items = products.filter((p) => p.cat === c.id && matches(p));
    if (!items.length) continue;
    shown += items.length;
    const g = h('section', { class: 'group', id: 'cat-' + c.id, 'aria-labelledby': 'h-' + c.id });
    g.style.setProperty('--acc', c.accent);
    g.append(h('h3', { id: 'h-' + c.id }, h('span', { class: 'g-ico' }, art(c.art, c.accent)), c.name),
      h('div', { class: 'grid' }, items.map(card)));
    root.append(g);
  }
  const empty = $('#empty');
  empty.hidden = shown > 0;
  if (!shown) {
    empty.replaceChildren(h('b', { text: 'Ничего не нашли' }), h('span', { text: 'Попробуйте другое слово или ' }), h('a', { href: telHref(phone), text: 'позвоните ' + phone }), h('span', { text: ' — подскажем, что есть.' }));
  }
}

function renderChips() {
  const root = $('#chips');
  root.replaceChildren();
  const mk = (id, name, n) => h('button', {
    class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(state.cat === id),
    onclick: () => {
      state.cat = id; renderChips(); renderGroups();
      const top = $('#catalog').offsetTop;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
    },
  }, name, h('i', { text: n }));
  root.append(mk('all', 'Все', products.length));
  for (const c of cats) { const n = products.filter((p) => p.cat === c.id).length; if (n) root.append(mk(c.id, c.name, n)); }
  const sel = $('.chip[aria-selected=true]', root);
  if (sel && root.scrollWidth > root.clientWidth) root.scrollTo({ left: Math.max(0, sel.offsetLeft - 40), behavior: 'auto' });
}

function renderCatalog() {
  $('#catTitle').textContent = S.catalogTitle || 'Каталог';
  $('#catHint').textContent = [S.catalogHint, dateLabel ? `Цены актуальны на ${dateLabel}.` : ''].filter(Boolean).join(' ');
  renderChips();
  renderGroups();
  let t;
  $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; renderGroups(); }, 120); });
}

/* ───── как заказать, доставка, контакты, подвал ───── */
function renderSteps() {
  const list = S.steps.filter((s) => s.title);
  if (!S.sections.steps || !list.length) { $('#steps').hidden = true; return; }
  $('#stepsIn').append(h('h2', { text: S.stepsTitle || 'Как заказать' }),
    h('ol', null, list.map((s) => h('li', null, h('b', { text: s.title }), s.text ? h('p', { text: s.text }) : null))));
}

function renderDelivery() {
  const d = S.delivery, c = S.contacts;
  if (!S.sections.delivery) { $('#delivery').hidden = true; return; }
  const rows = [['Доставка по городу', d.fee ? rub(d.fee) : 'бесплатно']];
  if (d.fee && d.freeFrom) rows.push(['Бесплатно от', rub(d.freeFrom)]);
  if (d.minOrder) rows.push(['Минимальный заказ', rub(d.minOrder)]);
  if (c.hours) rows.push(['Часы работы', c.hours]);
  rows.push(['Телефон', phone]);
  $('#deliveryIn').append(h('div', { class: 'delivery-in' },
    h('div', null, h('h2', { text: d.title }), d.text ? h('p', { text: d.text }) : null),
    h('div', { class: 'facts' }, rows.map(([k, v]) => h('div', null, h('span', { text: k }), h('b', { text: v }))))));
}

function renderContacts() {
  const c = S.contacts;
  const links = [];
  if (c.vk) links.push(h('a', { href: c.vk, target: '_blank', rel: 'noopener' }, icon('u-vk'), 'ВКонтакте'));
  if (c.telegram) {
    const u = /^https?:\/\//i.test(c.telegram) ? c.telegram : 'https://t.me/' + c.telegram.replace(/^@/, '');
    links.push(h('a', { href: u, target: '_blank', rel: 'noopener' }, icon('u-tg'), 'Telegram'));
  }
  if (c.whatsapp) links.push(h('a', { href: 'https://wa.me/' + c.whatsapp, target: '_blank', rel: 'noopener' }, icon('u-wa'), 'WhatsApp'));
  const meta = [];
  if (c.address) meta.push(h('div', null, h('b', { text: 'Где мы' }), c.address));
  if (c.hours) meta.push(h('div', null, h('b', { text: 'Когда отвечаем' }), c.hours));
  $('#contactsIn').append(h('div', { class: 'contacts-in' },
    h('div', null, h('h2', { text: 'Контакты' }),
      h('a', { class: 'big-phone', href: telHref(phone), text: phone }),
      c.phoneNote ? h('p', { class: 'sub', text: c.phoneNote }) : null,
      meta.length ? h('div', { class: 'meta' }, meta) : null),
    h('div', { class: 'links' }, links)));
}

function renderFoot() {
  $('#footIn').append(h('div', { class: 'foot-in' },
    h('span', { text: `© ${new Date().getFullYear()} ${S.brand.name}` }),
    S.footer.text ? h('span', { text: S.footer.text }) : null));
  const mc = $('#mbarCall'); mc.href = telHref(phone); mc.replaceChildren(icon('u-phone'), 'Позвонить');
}

/* ───── корзина-чек ───── */
const cart_el = $('#cart'), scrim = $('#scrim'), cartBody = $('#cartBody');
let opener = null, linesEl, formEl, doneEl, emptyEl;
const draft = store.get('mn_draft', { name: '', phone: '', address: '' });

function feeFor(sum) { const d = S.delivery; return d.fee && !(d.freeFrom && sum >= d.freeFrom) ? d.fee : 0; }

function buildCart() {
  linesEl = h('div', { id: 'lines' });
  emptyEl = h('div', { class: 'cart-empty' }, h('b', { text: 'Корзина пуста' }), 'Добавьте что-нибудь из каталога — цена написана на каждом ценнике.');
  const err = h('div', { class: 'err', role: 'alert' });
  const mk = (id, label, attrs, area) => h('div', { class: 'field' }, h('label', { for: id, text: label }), area ? h('textarea', { id, name: id, rows: 3, ...attrs }) : h('input', { id, name: id, ...attrs }));
  const submit = h('button', { class: 'btn btn-red', type: 'submit', id: 'submit', text: 'Отправить заказ' });
  formEl = h('form', { class: 'form', novalidate: '', autocomplete: 'on' },
    mk('f-name', 'Как вас зовут', { type: 'text', autocomplete: 'name', maxlength: 80, required: '' }),
    mk('f-phone', 'Телефон', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 30, placeholder: '8-922-000-00-00', required: '' }),
    mk('f-address', 'Адрес доставки', { type: 'text', autocomplete: 'street-address', maxlength: 250, placeholder: 'Улица, дом, квартира', required: '' }),
    mk('f-comment', 'Комментарий к заказу', { maxlength: 600, placeholder: 'Например: удобное время или вес' }, true),
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' })),
    err, submit,
    S.order.note ? h('p', { class: 'fine', text: S.order.note }) : null);
  doneEl = h('div', { class: 'done', hidden: '' });
  cartBody.replaceChildren(linesEl, emptyEl, formEl, doneEl);
  $('#f-name').value = draft.name || ''; $('#f-phone').value = draft.phone || ''; $('#f-address').value = draft.address || '';
  formEl.addEventListener('input', (e) => {
    draft.name = $('#f-name').value; draft.phone = $('#f-phone').value; draft.address = $('#f-address').value; store.set('mn_draft', draft);
    e.target.closest('.field')?.classList.remove('bad'); err.textContent = '';
  });
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const val = (id) => $(id).value.trim();
    const bad = [];
    if (val('#f-name').length < 2) bad.push(['#f-name', 'Укажите имя']);
    if (val('#f-phone').replace(/\D/g, '').length < 10) bad.push(['#f-phone', 'Укажите телефон с кодом, например 8-922-000-00-00']);
    if (!val('#f-address')) bad.push(['#f-address', 'Укажите адрес доставки']);
    $$('.field', formEl).forEach((f) => f.classList.remove('bad'));
    if (bad.length) { bad.forEach(([id]) => $(id).closest('.field').classList.add('bad')); err.textContent = bad[0][1]; $(bad[0][0]).focus(); return; }
    const sum = cartSum(), min = S.delivery.minOrder;
    if (min && sum < min) { err.textContent = `Минимальная сумма заказа — ${rub(min)}`; return; }
    submit.disabled = true; submit.textContent = 'Отправляем…';
    try {
      const r = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: val('#f-name'), phone: val('#f-phone'), address: val('#f-address'), comment: val('#f-comment'), website: formEl.website.value, items: cartItems().map((x) => ({ id: x.p.id, qty: x.qty })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Не удалось отправить заказ');
      showDone(j.number);
    } catch (ex) {
      err.textContent = ex instanceof TypeError ? `Нет связи с сайтом. Проверьте интернет или позвоните: ${phone}` : ex.message;
    } finally { submit.disabled = false; submit.textContent = 'Отправить заказ'; }
  });
}

function renderLines() {
  const items = cartItems();
  linesEl.replaceChildren();
  emptyEl.hidden = items.length > 0;
  formEl.hidden = !items.length;
  if (!items.length) return;
  let approx = false;
  for (const { p, qty } of items) {
    if (p.approx) approx = true;
    linesEl.append(h('div', { class: 'line' },
      h('b', { text: p.name }), h('span', { class: 'sum', text: (p.approx ? '≈ ' : '') + rub(p.price * qty) }),
      h('span', { class: 'per', text: `${rub(p.price)} ${p.unit}` }),
      h('div', { class: 'step', role: 'group', 'aria-label': p.name },
        h('button', { type: 'button', 'data-dec': '', 'data-pid': p.id, 'aria-label': 'Меньше' }, icon('u-minus')),
        h('output', { text: `${qty} ${p.qtyLabel || 'шт'}` }),
        h('button', { type: 'button', 'data-inc': '', 'data-pid': p.id, 'aria-label': 'Больше' }, icon('u-plus'))),
      h('button', { class: 'del', type: 'button', 'data-del': '', 'data-pid': p.id, text: 'Убрать' })));
  }
  const sum = cartSum(), fee = feeFor(sum), min = S.delivery.minOrder;
  linesEl.append(h('div', { class: 'sums' },
    h('div', null, h('span', { text: 'Товары' }), h('span', { text: rub(sum) })),
    h('div', null, h('span', { text: 'Доставка' }), h('span', { text: fee ? rub(fee) : 'бесплатно' })),
    h('div', { class: 'total' }, h('span', { text: 'Итого' }), h('span', { text: (approx ? '≈ ' : '') + rub(sum + fee) }))));
  if (approx) linesEl.append(h('p', { class: 'warn', text: 'В заказе есть товары с плавающим весом. Точную сумму назовём по факту взвешивания.' }));
  if (min && sum < min) linesEl.append(h('p', { class: 'warn', text: `До минимального заказа не хватает ${rub(min - sum)}.` }));
}

function showDone(number) {
  cart = {}; saveCart(); paintBadges(false);
  $$('.ctl[data-pid]').forEach(ctlFill);
  linesEl.replaceChildren(); emptyEl.hidden = true; formEl.hidden = true; doneEl.hidden = false;
  $('#f-comment').value = '';
  doneEl.replaceChildren(h('p', { class: 'fine', text: 'Заказ принят' }), h('div', { class: 'no', text: '№' + number }), h('p', { text: S.order.success }),
    h('button', { class: 'btn btn-red', type: 'button', text: 'Вернуться в каталог', onclick: closeCart }));
  cartBody.scrollTop = 0;
}

function openCart(from) {
  opener = from || document.activeElement;
  if (!linesEl) buildCart();
  doneEl.hidden = true;
  renderLines();
  cart_el.hidden = false; scrim.hidden = false;
  document.body.classList.add('lock');
  $('#cartClose').focus();
}
function closeCart() {
  cart_el.hidden = true; scrim.hidden = true;
  document.body.classList.remove('lock');
  if (opener && opener.focus) opener.focus();
}
$('#cartBtn').addEventListener('click', (e) => openCart(e.currentTarget));
$('#mbarCart').addEventListener('click', (e) => openCart(e.currentTarget));
$('#cartClose').addEventListener('click', closeCart);
scrim.addEventListener('click', closeCart);
document.addEventListener('keydown', (e) => {
  if (cart_el.hidden) return;
  if (e.key === 'Escape') { closeCart(); return; }
  if (e.key === 'Tab') {
    const f = $$('button,input,textarea,a[href]', cart_el).filter((x) => !x.disabled && x.offsetParent && !x.closest('.hp'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ───── старт ───── */
renderTop(); renderHero(); renderTicker(); renderTrust(); renderToday(); renderCatalog();
renderSteps(); renderDelivery(); renderContacts(); renderFoot(); paintBadges(false);
})();
