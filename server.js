'use strict';
/*
  Сервер сайта «Морепродукты Нягань».
  Без внешних зависимостей: нужен только Node.js 18+.
  Запуск:  node server.js
*/
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const D = require('./defaults');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const TG_API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');

fs.mkdirSync(UPLOADS, { recursive: true });

/* ───────────── утилиты ───────────── */
const log = (...a) => console.log(new Date().toISOString(), ...a);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
const clientIp = (req) => {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
};
const isHttps = (req) => !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (b.length >= max) { buckets.set(key, b); return false; }
  b.push(now); buckets.set(key, b); return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 3600e3) buckets.delete(k);
  for (const [k, v] of loginFails) if (!v.length || now - v[v.length - 1] > 900e3) loginFails.delete(k);
}, 600e3).unref();

/* ───────────── хранилище ───────────── */
const DB_FILE = path.join(DATA, 'db.json');
const ORDERS_FILE = path.join(DATA, 'orders.json');
const AUTH_FILE = path.join(DATA, 'auth.json');

function writeJsonAtomic(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Приводит значение к форме шаблона: лишнее выкидывает, недостающее берёт из шаблона. */
function sanitize(value, tpl) {
  if (typeof tpl === 'string') return typeof value === 'string' ? value.trim().slice(0, 3000) : (typeof value === 'number' ? String(value) : tpl);
  if (typeof tpl === 'number') { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(10_000_000, n)) : tpl; }
  if (typeof tpl === 'boolean') return typeof value === 'boolean' ? value : tpl;
  if (Array.isArray(tpl)) {
    if (!Array.isArray(value)) return tpl;
    const item = tpl[0];
    return value.slice(0, 30).map((v) => sanitize(v, item === undefined ? '' : item));
  }
  if (tpl && typeof tpl === 'object') {
    const out = {};
    const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    for (const k of Object.keys(tpl)) out[k] = sanitize(src[k], tpl[k]);
    return out;
  }
  return tpl;
}

const isSafeUrl = (u) => !u || /^(\/[^\s]*|https?:\/\/[^\s]+)$/i.test(u);
const HEX = /^#[0-9a-f]{6}$/i;

function normalizeSettings(raw, prev) {
  const tpl = D.settingsTemplate();
  const s = sanitize(raw, tpl);
  // цвета
  for (const k of Object.keys(tpl.design.colors)) if (!HEX.test(s.design.colors[k])) s.design.colors[k] = tpl.design.colors[k];
  if (!D.PALETTES[s.design.palette] && s.design.palette !== 'custom') s.design.palette = 'custom';
  if (!D.FONTS_HEAD[s.design.fontHead]) s.design.fontHead = tpl.design.fontHead;
  if (!D.FONTS_BODY[s.design.fontBody]) s.design.fontBody = tpl.design.fontBody;
  s.design.radius = Math.max(0, Math.min(28, Math.round(s.design.radius)));
  if (!['tag', 'card'].includes(s.design.tagStyle)) s.design.tagStyle = 'tag';
  // ссылки
  for (const [obj, key] of [[s.hero, 'image'], [s.brand, 'logo'], [s.contacts, 'vk'], [s.seo, 'siteUrl']]) {
    if (!isSafeUrl(obj[key])) obj[key] = '';
  }
  s.seo.siteUrl = s.seo.siteUrl.replace(/\/+$/, '');
  s.contacts.whatsapp = s.contacts.whatsapp.replace(/[^\d]/g, '');
  s.delivery.fee = Math.round(s.delivery.fee); s.delivery.freeFrom = Math.round(s.delivery.freeFrom); s.delivery.minOrder = Math.round(s.delivery.minOrder);
  try { new Intl.DateTimeFormat('ru-RU', { timeZone: s.timezone }); } catch { s.timezone = tpl.timezone; }
  // Telegram: токен не затираем пустой строкой
  const old = (prev && prev.telegram) || { token: '' };
  const incomingToken = raw && raw.telegram && typeof raw.telegram.token === 'string' ? raw.telegram.token.trim() : '';
  if (incomingToken === '__clear__') s.telegram.token = '';
  else if (incomingToken && /^\d+:[\w-]{20,}$/.test(incomingToken)) s.telegram.token = incomingToken;
  else s.telegram.token = old.token || '';
  s.telegram.chatIds = s.telegram.chatIds.replace(/[^\d,\-\s@\w]/g, '').slice(0, 200);
  s.ticker = s.ticker.filter(Boolean).slice(0, 20);
  return s;
}

function loadDb() {
  let db = readJson(DB_FILE, null);
  if (!db) {
    db = { settings: D.settingsTemplate(), categories: D.categoriesSeed(), products: D.productsSeed() };
    writeJsonAtomic(DB_FILE, db);
    log('Создана база с каталогом из архива VK:', db.products.length, 'позиций');
  }
  db.settings = normalizeSettings(db.settings, db.settings);
  db.categories = Array.isArray(db.categories) ? db.categories : [];
  db.products = Array.isArray(db.products) ? db.products : [];
  return db;
}
const db = loadDb();
const orders = readJson(ORDERS_FILE, { counter: 0, list: [] });
const saveDb = () => writeJsonAtomic(DB_FILE, db);
const saveOrders = () => writeJsonAtomic(ORDERS_FILE, orders);

/* ───────────── пароль и сессии ───────────── */
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function createAuth(password) {
  const salt = rid(16);
  const a = { salt, hash: hashPassword(password, salt), secret: rid(32) };
  writeJsonAtomic(AUTH_FILE, a);
  return a;
}
let auth = readJson(AUTH_FILE, null);
if (process.argv.includes('--reset-password') || !auth) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  auth = createAuth(pw);
  const line = '═'.repeat(52);
  console.log(`\n${line}\n  Пароль администратора: ${pw}\n  Войти: /admin   (смените пароль в разделе «Аккаунт»)\n${line}\n`);
  if (process.argv.includes('--reset-password')) process.exit(0);
}
const SESSION_MS = 14 * 24 * 3600e3;
const sign = (payload) => crypto.createHmac('sha256', auth.secret).update(payload).digest('base64url');
function makeToken() { const p = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString('base64url'); return p + '.' + sign(p); }
function checkToken(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const [p, s] = tok.split('.');
  if (!p || !s) return false;
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter((x) => x[0]));
const isAdmin = (req) => checkToken(parseCookies(req).adm);
const loginFails = new Map();

/* ───────────── Telegram ───────────── */
function tgRequest(token, method, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${TG_API}/bot${token}/${method}`);
    const body = JSON.stringify(payload || {});
    const lib = u.protocol === 'http:' ? http : https;
    const r = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 12000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; if (buf.length > 1e6) res.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Telegram вернул не JSON')); } });
    });
    r.on('timeout', () => r.destroy(new Error('Telegram не ответил за 12 секунд')));
    r.on('error', reject);
    r.end(body);
  });
}
const chatList = (s) => String(s || '').split(/[\s,]+/).filter(Boolean);
async function tgSend(text, settings = db.settings) {
  const { token, chatIds, enabled } = settings.telegram;
  if (!enabled) return { ok: false, error: 'Уведомления выключены' };
  if (!token) return { ok: false, error: 'Не указан токен бота' };
  const chats = chatList(chatIds);
  if (!chats.length) return { ok: false, error: 'Не указан chat_id' };
  const errors = [];
  let okCount = 0;
  for (const chat_id of chats) {
    try {
      const r = await tgRequest(token, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true });
      if (r.ok) okCount++; else errors.push(`${chat_id}: ${r.description || 'ошибка'}`);
    } catch (e) { errors.push(`${chat_id}: ${e.message}`); }
  }
  return okCount ? { ok: true, error: errors.join('; ') } : { ok: false, error: errors.join('; ') };
}
function fmtDate(iso, tz) {
  try { return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return iso; }
}
function orderText(o) {
  const s = db.settings;
  const lines = [];
  lines.push(`🛒 <b>Новый заказ №${o.number}</b>`);
  lines.push(fmtDate(o.createdAt, s.timezone));
  lines.push('');
  lines.push(`👤 <b>${esc(o.customer.name)}</b>`);
  lines.push(`📞 ${esc(o.customer.phone)}`);
  if (o.customer.address) lines.push(`📍 ${esc(o.customer.address)}`);
  if (o.customer.comment) lines.push(`💬 ${esc(o.customer.comment)}`);
  lines.push('');
  lines.push('<b>Состав:</b>');
  for (const it of o.items) {
    lines.push(`• ${esc(it.name)} — ${it.qty} × ${esc(it.qtyLabel || 'шт')} (${money(it.price)} ${esc(it.unit || '')}) = <b>${money(it.price * it.qty)}</b>${it.approx ? ' ≈' : ''}`);
  }
  lines.push('');
  if (o.fee) lines.push(`Доставка: ${money(o.fee)}`);
  lines.push(`<b>Итого: ${money(o.total)}</b>${o.approx ? '\n⚠️ Есть товары с плавающим весом — сумма ориентировочная.' : ''}`);
  if (s.seo.siteUrl) lines.push(`\n<a href="${esc(s.seo.siteUrl)}/admin">Открыть в админке</a>`);
  return lines.join('\n').slice(0, 4000);
}

/* ───────────── ответы / ввод ───────────── */
function secHeaders(res, req, extra = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}
function sendBuf(req, res, status, buf, type, headers = {}) {
  secHeaders(res, req);
  res.setHeader('Content-Type', type);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  const ae = String(req.headers['accept-encoding'] || '');
  if (buf.length > 1024 && /gzip/.test(ae) && /^(text\/|application\/(json|javascript)|image\/svg)/.test(type)) {
    buf = zlib.gzipSync(buf); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
  }
  res.statusCode = status;
  res.setHeader('Content-Length', buf.length);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const sendJson = (req, res, status, obj) => sendBuf(req, res, status, Buffer.from(JSON.stringify(obj)), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req, limit = 300_000) {
  const ct = String(req.headers['content-type'] || '');
  if (!/^application\/json/i.test(ct)) throw new HttpError(415, 'Ожидается JSON');
  const buf = await readBody(req, limit);
  try { const v = JSON.parse(buf.toString('utf8') || '{}'); if (v === null || typeof v !== 'object') throw 0; return v; } catch { throw new HttpError(400, 'Некорректный JSON'); }
}
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intIn = (v, min, max, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };

/* ───────────── публичные данные ───────────── */
function publicState() {
  const s = JSON.parse(JSON.stringify(db.settings));
  delete s.telegram;
  return {
    settings: s,
    categories: db.categories,
    products: db.products.filter((p) => !p.hidden).sort((a, b) => a.sort - b.sort),
  };
}
function themeCss(design) {
  const c = design.colors;
  const head = { bitter: ["'Bitter', Georgia, serif", 800], fira: ["'Fira Sans', Arial, sans-serif", 900], lora: ["'Lora', Georgia, serif", 700], montserrat: ["'Montserrat', Arial, sans-serif", 800] }[design.fontHead];
  const body = { fira: "'Fira Sans', Arial, sans-serif", sourcesans: "'Source Sans 3', Arial, sans-serif", montserrat: "'Montserrat', Arial, sans-serif" }[design.fontBody];
  return `:root{--navy:${c.navy};--ocean:${c.ocean};--cyan:${c.cyan};--ice:${c.ice};--red:${c.red};--gold:${c.gold};--ink:${c.ink};--paper:${c.paper};--r:${design.radius}px;--f-head:${head[0]};--w-head:${head[1]};--f-body:${body}}`;
}

/* ───────────── главная страница (SSR-вставка данных) ───────────── */
const fileCache = new Map();
function readCached(file) {
  const st = fs.statSync(file);
  const c = fileCache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.data;
  const data = fs.readFileSync(file);
  fileCache.set(file, { mtime: st.mtimeMs, data });
  return data;
}
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function renderIndex(req) {
  const tpl = readCached(path.join(PUBLIC, 'index.html')).toString('utf8');
  const st = publicState();
  const s = st.settings;
  const base = s.seo.siteUrl;
  const img = s.hero.image ? (base && s.hero.image.startsWith('/') ? base + s.hero.image : s.hero.image) : '';
  const meta = [
    `<title>${esc(s.seo.title)}</title>`,
    `<meta name="description" content="${esc(s.seo.description)}">`,
    `<meta property="og:type" content="website"><meta property="og:locale" content="ru_RU">`,
    `<meta property="og:title" content="${esc(s.seo.title)}">`,
    `<meta property="og:description" content="${esc(s.seo.description)}">`,
    img ? `<meta property="og:image" content="${esc(img)}">` : '',
    base ? `<link rel="canonical" href="${esc(base)}/">` : '',
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org', '@type': 'Store', name: s.brand.name, description: s.seo.description,
    telephone: s.contacts.phone, areaServed: 'Нягань', address: { '@type': 'PostalAddress', addressLocality: s.contacts.address },
    ...(base ? { url: base } : {}),
  };
  const noscript = `<noscript><div style="padding:24px;font:16px/1.5 sans-serif;max-width:720px;margin:auto"><h1>${esc(s.hero.title)}</h1><p>${esc(s.hero.subtitle)}</p><p><b>Телефон: <a href="tel:${esc(telHref(s.contacts.phone))}">${esc(s.contacts.phone)}</a></b></p><p>Для оформления заказа на сайте включите JavaScript или позвоните нам.</p><ul>${st.products.map((p) => `<li>${esc(p.name)} — ${money(p.price)} ${esc(p.unit)}</li>`).join('')}</ul></div></noscript>`;
  return Buffer.from(tpl
    .replace('<!--META-->', () => meta)
    .replace('/*THEME*/', () => themeCss(s.design))
    .replace('<!--BOOT-->', () => `<script type="application/json" id="boot">${safeJson(st)}</script><script type="application/ld+json">${safeJson(ld)}</script>${noscript}`), 'utf8');
}
function telHref(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
  return '+' + d;
}

/* ───────────── загрузки ───────────── */
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 4).toString() === 'GIF8') return 'gif';
  return null;
}
function gcUploads() {
  const used = new Set();
  const add = (u) => { if (typeof u === 'string' && u.startsWith('/uploads/')) used.add(u.slice(9)); };
  db.products.forEach((p) => add(p.photo));
  add(db.settings.hero.image); add(db.settings.brand.logo);
  for (const f of fs.readdirSync(UPLOADS)) {
    if (used.has(f)) continue;
    const full = path.join(UPLOADS, f);
    try { if (Date.now() - fs.statSync(full).mtimeMs > 3600e3) fs.unlinkSync(full); } catch { /* ignore */ }
  }
}
setInterval(() => { try { gcUploads(); } catch { /* ignore */ } }, 6 * 3600e3).unref();

/* ───────────── статика ───────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
function serveFile(req, res, file, { immutable = false, noStore = false } = {}) {
  let st;
  try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { return false; }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext];
  if (!type) return false;
  const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
  const cache = noStore ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60, must-revalidate';
  if (req.headers['if-none-match'] === etag) { secHeaders(res, req); res.statusCode = 304; res.setHeader('ETag', etag); res.setHeader('Cache-Control', cache); res.end(); return true; }
  sendBuf(req, res, 200, readCached(file), type, { ETag: etag, 'Cache-Control': cache });
  return true;
}
function safeJoin(dir, rel) {
  const p = path.normalize(path.join(dir, rel));
  return p.startsWith(dir + path.sep) || p === dir ? p : null;
}

/* ───────────── API: публичное ───────────── */
async function publicApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/site') return sendJson(req, res, 200, publicState());

  if (req.method === 'POST' && p === '/api/orders') {
    const ip = clientIp(req);
    if (!rateLimit('order:' + ip, 6, 10 * 60e3)) throw new HttpError(429, 'Слишком много заказов подряд. Подождите немного или позвоните нам.');
    const b = await readJsonBody(req, 60_000);
    if (b.website) return sendJson(req, res, 200, { ok: true, number: 0 }); // ловушка для ботов
    const name = str(b.name, 80), phone = str(b.phone, 30), address = str(b.address, 250), comment = str(b.comment, 600);
    if (name.length < 2) throw new HttpError(400, 'Укажите имя');
    if (phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Укажите телефон с кодом, например 8-922-000-00-00');
    if (!address) throw new HttpError(400, 'Укажите адрес доставки');
    if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Корзина пуста');
    const items = []; const seen = new Set(); let approx = false;
    for (const it of b.items.slice(0, 60)) {
      const prod = db.products.find((x) => x.id === it.id && !x.hidden);
      if (!prod || seen.has(prod.id)) continue;
      if (!prod.available) throw new HttpError(409, `«${prod.name}» сейчас нет в наличии. Уберите из корзины.`);
      const qty = intIn(it.qty, 1, 99);
      if (qty < prod.qtyMin) throw new HttpError(400, `«${prod.name}»: минимум ${prod.qtyMin} ${prod.qtyLabel || 'шт'}`);
      seen.add(prod.id);
      if (prod.approx) approx = true;
      items.push({ id: prod.id, name: prod.name, price: prod.price, unit: prod.unit, qtyLabel: prod.qtyLabel, qty, approx: prod.approx });
    }
    if (!items.length) throw new HttpError(400, 'Корзина пуста');
    const sum = items.reduce((a, i) => a + i.price * i.qty, 0);
    const dl = db.settings.delivery;
    if (dl.minOrder && sum < dl.minOrder) throw new HttpError(400, `Минимальная сумма заказа — ${money(dl.minOrder)}`);
    const fee = dl.fee && !(dl.freeFrom && sum >= dl.freeFrom) ? dl.fee : 0;
    orders.counter += 1;
    const order = {
      id: rid(6), number: orders.counter, createdAt: new Date().toISOString(), status: 'new',
      customer: { name, phone, address, comment }, items, fee, total: sum + fee, approx, tg: { sent: false, error: '' },
    };
    orders.list.unshift(order);
    if (orders.list.length > 2000) orders.list.length = 2000;
    saveOrders();
    // Ответ клиенту не ждёт Telegram — заказ уже сохранён.
    tgSend(orderText(order)).then((r) => { order.tg = { sent: r.ok, error: r.error || '' }; saveOrders(); if (!r.ok) log('Telegram не отправлен:', r.error); }).catch((e) => log('Telegram ошибка', e.message));
    return sendJson(req, res, 200, { ok: true, number: order.number, total: order.total });
  }
  return false;
}

/* ───────────── API: админка ───────────── */
async function adminApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (m === 'POST' && p === '/api/admin/login') {
    const ip = clientIp(req);
    const fails = (loginFails.get(ip) || []).filter((t) => Date.now() - t < 900e3);
    if (fails.length >= 8) throw new HttpError(429, 'Слишком много попыток. Подождите 15 минут.');
    const b = await readJsonBody(req, 2000);
    const pw = typeof b.password === 'string' ? b.password : '';
    const good = Buffer.from(auth.hash, 'hex'), got = Buffer.from(hashPassword(pw, auth.salt), 'hex');
    if (good.length === got.length && crypto.timingSafeEqual(good, got)) {
      loginFails.delete(ip);
      res.setHeader('Set-Cookie', `adm=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`);
      return sendJson(req, res, 200, { ok: true });
    }
    fails.push(Date.now()); loginFails.set(ip, fails);
    await new Promise((r) => setTimeout(r, 500));
    throw new HttpError(401, 'Неверный пароль');
  }
  if (m === 'GET' && p === '/api/admin/me') return sendJson(req, res, 200, { admin: isAdmin(req) });

  if (!isAdmin(req)) throw new HttpError(401, 'Нужно войти');
  if (m !== 'GET') {
    const origin = req.headers.origin;
    if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch { /* */ } if (!ok) throw new HttpError(403, 'Запрос с чужого сайта'); }
  }

  if (m === 'POST' && p === '/api/admin/logout') {
    res.setHeader('Set-Cookie', 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return sendJson(req, res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/data') {
    const s = JSON.parse(JSON.stringify(db.settings));
    const t = s.telegram.token;
    s.telegram.token = '';
    s.telegram.tokenSet = !!t;
    s.telegram.tokenHint = t ? t.slice(0, 4) + '…' + t.slice(-4) : '';
    return sendJson(req, res, 200, {
      settings: s, categories: db.categories, products: [...db.products].sort((a, b) => a.sort - b.sort),
      palettes: D.PALETTES, fontsHead: D.FONTS_HEAD, fontsBody: D.FONTS_BODY, artKeys: D.ART_KEYS, badges: D.BADGES,
      newOrders: orders.list.filter((o) => o.status === 'new').length,
    });
  }

  if (m === 'PUT' && p === '/api/admin/settings') {
    const b = await readJsonBody(req, 200_000);
    db.settings = normalizeSettings(b, db.settings);
    saveDb(); gcUploads();
    return sendJson(req, res, 200, { ok: true });
  }

  /* категории */
  if (m === 'PUT' && p === '/api/admin/categories') {
    const b = await readJsonBody(req);
    if (!Array.isArray(b.categories)) throw new HttpError(400, 'Нет списка категорий');
    const next = [];
    const seen = new Set();
    for (const c of b.categories.slice(0, 40)) {
      const name = str(c.name, 60);
      if (!name) continue;
      let id = /^[a-z0-9_-]{1,40}$/i.test(c.id || '') ? c.id : 'c' + rid(4);
      if (seen.has(id)) id = 'c' + rid(4);
      seen.add(id);
      next.push({ id, name, art: D.ART_KEYS.includes(c.art) ? c.art : 'fish', accent: HEX.test(c.accent || '') ? c.accent : '#0B5E8E' });
    }
    const orphan = db.products.filter((pr) => !seen.has(pr.cat));
    if (orphan.length) throw new HttpError(409, `Нельзя удалить категорию, в которой есть позиции («${orphan[0].name}» и ещё ${orphan.length - 1}). Сначала перенесите их.`);
    db.categories = next; saveDb();
    return sendJson(req, res, 200, { ok: true, categories: db.categories });
  }

  /* товары */
  const prodNorm = (b, old) => {
    const name = str(b.name, 120);
    if (!name) throw new HttpError(400, 'Укажите название');
    const cat = db.categories.find((c) => c.id === b.cat) ? b.cat : (old ? old.cat : (db.categories[0] || {}).id);
    if (!cat) throw new HttpError(400, 'Сначала создайте категорию');
    const photo = str(b.photo, 300);
    return {
      id: old ? old.id : 'p' + rid(5), cat, name, desc: str(b.desc, 600),
      price: intIn(b.price, 0, 10_000_000), oldPrice: intIn(b.oldPrice, 0, 10_000_000),
      unit: str(b.unit, 40), qtyLabel: str(b.qtyLabel, 20), note: str(b.note, 120),
      badge: Object.prototype.hasOwnProperty.call(D.BADGES, b.badge) ? b.badge : '',
      featured: !!b.featured, approx: !!b.approx,
      art: D.ART_KEYS.includes(b.art) ? b.art : '',
      qtyMin: intIn(b.qtyMin, 1, 99, 1), qtyStep: 1,
      photo: isSafeUrl(photo) ? photo : '', available: b.available !== false, hidden: !!b.hidden,
      sort: old ? old.sort : (db.products.reduce((a, x) => Math.max(a, x.sort), -1) + 1),
      updated: new Date().toISOString(),
    };
  };
  if (m === 'POST' && p === '/api/admin/products') {
    const b = await readJsonBody(req);
    const prod = prodNorm(b, null);
    db.products.push(prod); saveDb();
    return sendJson(req, res, 200, { ok: true, product: prod });
  }
  let mm;
  if ((mm = p.match(/^\/api\/admin\/products\/([\w-]+)$/))) {
    const i = db.products.findIndex((x) => x.id === mm[1]);
    if (i < 0) throw new HttpError(404, 'Позиция не найдена');
    if (m === 'PUT') {
      const b = await readJsonBody(req);
      db.products[i] = prodNorm(b, db.products[i]); saveDb(); gcUploads();
      return sendJson(req, res, 200, { ok: true, product: db.products[i] });
    }
    if (m === 'DELETE') { db.products.splice(i, 1); saveDb(); gcUploads(); return sendJson(req, res, 200, { ok: true }); }
  }
  if (m === 'POST' && p === '/api/admin/products/reorder') {
    const b = await readJsonBody(req);
    if (!Array.isArray(b.ids)) throw new HttpError(400, 'Нет списка');
    b.ids.forEach((id, idx) => { const pr = db.products.find((x) => x.id === id); if (pr) pr.sort = idx; });
    // позиции, не попавшие в список (другая категория), уходят следом, сохраняя порядок
    const rest = db.products.filter((x) => !b.ids.includes(x.id)).sort((a, b2) => a.sort - b2.sort);
    rest.forEach((pr, idx) => { pr.sort = b.ids.length + idx; });
    saveDb();
    return sendJson(req, res, 200, { ok: true });
  }

  /* загрузка фото */
  if (m === 'POST' && p === '/api/admin/upload') {
    const b = await readJsonBody(req, 12_000_000);
    const m2 = /^data:image\/[\w+.-]+;base64,(.+)$/s.exec(String(b.data || ''));
    if (!m2) throw new HttpError(400, 'Ожидается изображение');
    const buf = Buffer.from(m2[1], 'base64');
    if (buf.length > 8_000_000) throw new HttpError(413, 'Файл больше 8 МБ');
    const ext = sniffImage(buf);
    if (!ext) throw new HttpError(400, 'Поддерживаются JPG, PNG, WebP и GIF');
    const name = rid(12) + '.' + ext;
    fs.writeFileSync(path.join(UPLOADS, name), buf);
    return sendJson(req, res, 200, { ok: true, url: '/uploads/' + name });
  }

  /* заказы */
  if (m === 'GET' && p === '/api/admin/orders') return sendJson(req, res, 200, { orders: orders.list.slice(0, 300), tz: db.settings.timezone });
  if ((mm = p.match(/^\/api\/admin\/orders\/(\w+)$/))) {
    const o = orders.list.find((x) => x.id === mm[1]);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    if (m === 'PUT') {
      const b = await readJsonBody(req, 2000);
      if (!['new', 'confirmed', 'done', 'cancelled'].includes(b.status)) throw new HttpError(400, 'Неверный статус');
      o.status = b.status; saveOrders();
      return sendJson(req, res, 200, { ok: true });
    }
    if (m === 'DELETE') { orders.list = orders.list.filter((x) => x !== o); saveOrders(); return sendJson(req, res, 200, { ok: true }); }
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/admin\/orders\/(\w+)\/resend$/))) {
    const o = orders.list.find((x) => x.id === mm[1]);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    const r = await tgSend(orderText(o));
    o.tg = { sent: r.ok, error: r.error || '' }; saveOrders();
    return sendJson(req, res, 200, r);
  }

  /* Telegram */
  if (m === 'POST' && p === '/api/admin/telegram/test') {
    const b = await readJsonBody(req, 5000);
    const s = JSON.parse(JSON.stringify(db.settings));
    if (typeof b.token === 'string' && /^\d+:[\w-]{20,}$/.test(b.token.trim())) s.telegram.token = b.token.trim();
    if (typeof b.chatIds === 'string') s.telegram.chatIds = b.chatIds.replace(/[^\d,\-\s@\w]/g, '');
    s.telegram.enabled = true;
    const r = await tgSend(`✅ <b>Связь с сайтом настроена</b>\nСюда будут приходить новые заказы с сайта «${esc(s.brand.name)}».`, s);
    return sendJson(req, res, 200, r);
  }
  if (m === 'POST' && p === '/api/admin/telegram/detect') {
    const b = await readJsonBody(req, 5000);
    const token = (typeof b.token === 'string' && /^\d+:[\w-]{20,}$/.test(b.token.trim())) ? b.token.trim() : db.settings.telegram.token;
    if (!token) throw new HttpError(400, 'Сначала вставьте токен бота');
    let r;
    try { r = await tgRequest(token, 'getUpdates', { limit: 100, timeout: 0 }); } catch (e) { throw new HttpError(502, 'Не удалось связаться с Telegram: ' + e.message); }
    if (!r.ok) throw new HttpError(400, r.description || 'Telegram отклонил токен');
    const chats = new Map();
    for (const u of r.result || []) {
      const c = (u.message && u.message.chat) || (u.channel_post && u.channel_post.chat) || (u.my_chat_member && u.my_chat_member.chat);
      if (c) chats.set(String(c.id), { id: String(c.id), title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id), type: c.type });
    }
    return sendJson(req, res, 200, { ok: true, chats: [...chats.values()] });
  }

  /* пароль и бэкап */
  if (m === 'POST' && p === '/api/admin/password') {
    const b = await readJsonBody(req, 2000);
    const cur = Buffer.from(hashPassword(String(b.current || ''), auth.salt), 'hex'), good = Buffer.from(auth.hash, 'hex');
    if (!crypto.timingSafeEqual(cur, good)) throw new HttpError(403, 'Текущий пароль неверен');
    const next = String(b.next || '');
    if (next.length < 8) throw new HttpError(400, 'Новый пароль — не короче 8 символов');
    auth = createAuth(next);
    res.setHeader('Set-Cookie', `adm=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`);
    return sendJson(req, res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/admin/export') {
    const copy = JSON.parse(JSON.stringify({ settings: db.settings, categories: db.categories, products: db.products, orders: orders.list }));
    copy.settings.telegram.token = '';
    sendBuf(req, res, 200, Buffer.from(JSON.stringify(copy, null, 2)), 'application/json; charset=utf-8', { 'Content-Disposition': 'attachment; filename="moreprodukty-backup.json"', 'Cache-Control': 'no-store' });
    return true;
  }
  throw new HttpError(404, 'Не найдено');
}

/* ───────────── маршрутизатор ───────────── */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Плохой адрес'); }
    url.pathname = p;
    if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается');

    if (p.startsWith('/api/')) {
      if (p.startsWith('/api/admin/')) { await adminApi(req, res, url); return; }
      const r = await publicApi(req, res, url);
      if (r === false) throw new HttpError(404, 'Не найдено');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');

    if (p === '/' || p === '/index.html') { sendBuf(req, res, 200, renderIndex(req), 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' }); return; }
    if (p === '/robots.txt') { sendBuf(req, res, 200, Buffer.from(`User-agent: *\nDisallow: /admin\nDisallow: /api/\n${db.settings.seo.siteUrl ? `Sitemap: ${db.settings.seo.siteUrl}/sitemap.xml\n` : ''}`), 'text/plain; charset=utf-8'); return; }
    if (p === '/sitemap.xml' && db.settings.seo.siteUrl) { sendBuf(req, res, 200, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(db.settings.seo.siteUrl)}/</loc></url></urlset>`), 'application/xml; charset=utf-8'); return; }
    if (p === '/admin') { res.statusCode = 302; res.setHeader('Location', '/admin/'); res.end(); return; }
    if (p === '/admin/') { if (serveFile(req, res, path.join(PUBLIC, 'admin', 'index.html'), { noStore: true })) return; }

    if (p.startsWith('/uploads/')) {
      const name = p.slice(9);
      if (/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(name) && serveFile(req, res, path.join(UPLOADS, name), { immutable: true })) return;
      throw new HttpError(404, 'Не найдено');
    }
    const file = safeJoin(PUBLIC, p);
    if (file && !file.endsWith('index.html') && serveFile(req, res, file, { immutable: p.startsWith('/fonts/'), noStore: p.startsWith('/admin/') })) return;
    throw new HttpError(404, 'Страница не найдена');
  } catch (e) {
    const status = e.status || 500;
    if (!e.status) log('Ошибка', req.method, req.url, e.stack || e);
    if (res.headersSent) { res.end(); return; }
    if ((req.url || '').startsWith('/api/')) return sendJson(req, res, status, { ok: false, error: e.status ? e.message : 'Ошибка сервера' });
    sendBuf(req, res, status, Buffer.from(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${status}</title><body style="font:18px/1.5 sans-serif;padding:48px;max-width:560px;margin:auto"><h1>${status === 404 ? 'Такой страницы нет' : 'Что-то пошло не так'}</h1><p><a href="/">Вернуться на главную</a></p>`), 'text/html; charset=utf-8');
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => log(`Сайт запущен: http://localhost:${PORT}   Админка: http://localhost:${PORT}/admin/`));
gcUploads();

/* Повтор отправки в Telegram: если связь моргнула, заказ не остаётся без уведомления.
   Повторяем только сбои связи (не «не настроено») и только для свежих заказов. */
const TG_CONFIG_ERR = /выключен|токен|chat_id|Unauthorized|chat not found|Forbidden|Bad Request/i;
let retrying = false;
setInterval(async () => {
  if (retrying) return;
  const t = db.settings.telegram;
  if (!t.enabled || !t.token) return;
  retrying = true;
  try {
    for (const o of orders.list.slice(0, 50)) {
      if (!o.tg || o.tg.sent || !o.tg.error || TG_CONFIG_ERR.test(o.tg.error)) continue;
      if ((o.tg.tries || 0) >= 8 || Date.now() - Date.parse(o.createdAt) > 24 * 3600e3) continue;
      const r = await tgSend(orderText(o));
      o.tg = { sent: r.ok, error: r.error || '', tries: (o.tg.tries || 0) + 1 };
      saveOrders();
      if (r.ok) log(`Telegram: заказ №${o.number} доставлен с повтором`);
    }
  } catch (e) { log('Повтор Telegram:', e.message); } finally { retrying = false; }
}, 60e3).unref();
