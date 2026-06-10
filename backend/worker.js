/**
 * DigitalStore — Cloudflare Worker (order automation)
 * URL: https://store.tdh1812.workers.dev
 *
 * Endpoints:
 *   POST   /order                 → tạo đơn, lưu KV, gửi Brevo (khách) + Web3Forms (admin)
 *   POST   /order/:id/proof       → upload bằng chứng (multipart), status → proof_uploaded
 *   GET    /order/:id             → khách tra cứu trạng thái (public, dữ liệu tối thiểu)
 *   GET    /orders                → admin liệt kê (cần header x-admin-token)
 *   POST   /order/:id/status      → admin đổi trạng thái (cần x-admin-token)
 *   DELETE /order/:id             → admin xoá đơn (cần x-admin-token)
 *
 * Secrets (đặt qua `wrangler secret put`, KHÔNG ghi vào wrangler.toml):
 *   BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME,
 *   WEB3FORMS_KEY, ADMIN_TOKEN, ADMIN_EMAIL, SUPPORT_EMAIL
 * Binding KV: ORDERS   |   var: ALLOWED_ORIGIN
 */

const STATUSES = ['created', 'awaiting_payment', 'proof_uploaded', 'verified', 'credentials_sent', 'completed', 'cancelled'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      if (url.pathname === '/order' && request.method === 'POST') return createOrder(request, env, cors);

      // Email-Template / Shop-Texte (online editierbar über Admin)
      if (url.pathname === '/config') {
        if (request.method === 'GET') return getConfig(env, cors);
        if (request.method === 'POST') return requireAdmin(request, env, cors, () => saveConfig(request, env, cors));
      }
      if (url.pathname === '/translate' && request.method === 'POST') return requireAdmin(request, env, cors, () => translatePreview(request, env, cors));
      // Coupons
      if (url.pathname === '/coupon/validate' && request.method === 'POST') return validateCouponReq(request, env, cors);
      if (url.pathname === '/admin/coupons') {
        if (request.method === 'GET') return requireAdmin(request, env, cors, () => listCoupons(request, env, cors));
        if (request.method === 'POST') return requireAdmin(request, env, cors, () => createCoupons(request, env, cors));
        if (request.method === 'DELETE') return requireAdmin(request, env, cors, () => deleteCoupons(request, env, cors));
      }
      // Analytics
      if (url.pathname === '/event' && request.method === 'POST') return logEvent(request, env, cors);
      if (url.pathname === '/admin/stats') {
        if (request.method === 'GET') return requireAdmin(request, env, cors, () => getStats(request, env, cors));
        if (request.method === 'DELETE') return requireAdmin(request, env, cors, () => deleteStats(request, env, cors));
      }
      // Online sync for admin GitHub connection/token (password-hash auth)
      if (url.pathname === '/admin-sync' && request.method === 'POST') return adminSync(request, env, cors);

      const m = url.pathname.match(/^\/order\/([^\/]+)(\/proof|\/status|\/confirm)?$/);
      if (m) {
        const id = decodeURIComponent(m[1]); const sub = m[2];
        if (sub === '/proof' && request.method === 'POST') return uploadProof(request, env, cors, id);
        if (sub === '/proof' && request.method === 'GET') return requireAdmin(request, env, cors, () => getProofFile(request, env, cors, id));
        if (sub === '/confirm' && request.method === 'POST') return confirmOrder(request, env, cors, id);
        if (sub === '/status' && request.method === 'POST') return requireAdmin(request, env, cors, () => updateStatus(request, env, cors, id));
        if (!sub && request.method === 'GET') return lookupOrder(env, cors, id);
        if (!sub && request.method === 'DELETE') return requireAdmin(request, env, cors, () => deleteOrder(env, cors, id));
      }
      if (url.pathname === '/orders' && request.method === 'GET') return requireAdmin(request, env, cors, () => listOrders(env, cors));

      return json({ error: 'not_found', path: url.pathname }, 404, cors);
    } catch (e) {
      return json({ error: 'server_error', message: String(e && e.message || e) }, 500, cors);
    }
  },
};

// ───────── helpers ─────────
function corsHeaders(request, env) {
  const reqOrigin = request.headers.get('Origin') || '';
  const raw = String(env.ALLOWED_ORIGIN || '*').trim();
  const allowList = raw.split(',').map(s => s.trim()).filter(Boolean);
  let allowed = '*';
  if (allowList.length && !allowList.includes('*')) {
    allowed = (reqOrigin && allowList.includes(reqOrigin)) ? reqOrigin : allowList[0];
  }
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
    'Access-Control-Max-Age': '86400',
  };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function requireAdmin(request, env, cors, fn) {
  const tok = request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401, cors);
  return fn();
}
function genOrderId() {
  const d = new Date(), y = String(d.getFullYear()).slice(-2), m = String(d.getMonth() + 1).padStart(2, '0'),
    day = String(d.getDate()).padStart(2, '0'), rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DS-${y}${m}${day}-${rnd}`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function num(n) { return (Number(n) || 0).toFixed(2); }

// ───────── POST /order ─────────
async function createOrder(request, env, cors) {
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const { name, email, items, total } = b || {};
  if (!name || !email || !email.includes('@')) return json({ error: 'missing_fields' }, 400, cors);

  const orderId = (b.orderId && /^DS-/.test(b.orderId)) ? b.orderId : genOrderId();
  const norm = Array.isArray(items) ? items.map(i => ({
    product_id: (i.product_id ?? i.id ?? null), name: i.name || '', variant: i.variant || '', qty: Number(i.qty) || 1, price: Number(i.price) || 0,
  })) : [];
  const subtotal = norm.reduce((s, i) => s + i.qty * i.price, 0);
  // Coupon: re-validate + consume server-side (authoritative pricing)
  let discount = 0, couponCode = null, serverSubtotal = subtotal;
  if (b.coupon && env.DB) {
    const applied = await applyCouponForOrder(env, String(b.coupon).toUpperCase().trim(), norm.map(i => ({ product_id: i.product_id, variant: i.variant, qty: i.qty })), orderId);
    if (applied && applied.ok) { discount = applied.discount; couponCode = String(b.coupon).toUpperCase().trim(); serverSubtotal = applied.subtotal; }
  }
  const finalTotal = couponCode ? Math.max(0, Math.round((serverSubtotal - discount) * 100) / 100) : (Number(total) || subtotal);
  const lang = (b.lang === 'en' || b.lang === 'ru') ? b.lang : 'de';
  const order = {
    order_id: orderId, status: 'awaiting_payment', lang,
    customer: { name, email },
    items: norm, subtotal: couponCode ? serverSubtotal : subtotal, discount, coupon: couponCode, total: finalTotal, currency: 'EUR',
    proof: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), status: 'awaiting_payment', note: 'created' }],
  };
  if (env.ORDERS) await env.ORDERS.put(orderId, JSON.stringify(order));
  if (env.DB) { try { await logSale(env, order); } catch (e) {} }

  // skipBrevo=true → chỉ lưu đơn, KHÔNG gửi email (email gửi ở bước /confirm sau khi upload chứng từ).
  if (b.skipBrevo) {
    return json({ ok: true, order_id: orderId, status: order.status, brevo: { skipped: true } }, 200, cors);
  }

  // Brevo — email xác nhận cho khách (dùng cấu hình online editierbar).
  const brevo = await sendBrevoEmail(env, order);
  return json({ ok: true, order_id: orderId, status: order.status, brevo }, 200, cors);
}

// ───────── POST /order/:id/confirm (gửi Brevo email xác nhận sau khi khách upload chứng từ) ─────────
async function confirmOrder(request, env, cors, id) {
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  const order = await env.ORDERS.get(id, { type: 'json' });
  if (!order) return json({ error: 'order_not_found' }, 404, cors);
  const brevo = await sendBrevoEmail(env, order);
  return json({ ok: true, order_id: id, brevo }, 200, cors);
}

// ───────── Brevo helper ─────────
async function sendBrevoEmail(env, order) {
  let brevo = { skipped: true };
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return brevo;
  const rawCfg = await loadConfig(env);
  const lang = (order && (order.lang === 'en' || order.lang === 'ru')) ? order.lang : 'de';
  const cfg = localizeConfig(rawCfg, lang);
  const { name, email } = order.customer || {};
  if (!email) return brevo;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: env.BREVO_SENDER_NAME || cfg.brandName || 'DigitalStore', email: env.BREVO_SENDER_EMAIL },
        to: [{ email, name }],
        replyTo: env.ADMIN_EMAIL ? { email: env.ADMIN_EMAIL } : undefined,
        subject: `${cfg.subject || 'Bestellbestätigung'} — ${cfg.brandName || 'DigitalStore'}`,
        htmlContent: renderEmail({ name, items: order.items || [], total: order.total, cfg, supportEmail: env.SUPPORT_EMAIL || cfg.supportEmail || 'cfvblue@gmail.com', lang }),
      }),
    });
    brevo = { ok: res.ok, status: res.status };
    if (!res.ok) brevo.body = (await res.text().catch(() => '')).slice(0, 300);
  } catch (e) { brevo = { ok: false, error: String(e && e.message || e) }; }
  return brevo;
}

// ───────── Email-/Shop-Konfiguration (KV) ─────────
const CONFIG_KEY = '__email_config';
const DEFAULT_CONFIG = {
  brandName: 'DigitalStore',
  subject: 'Bestellbestätigung',
  intro: 'vielen herzlichen Dank für Ihren Einkauf bei DigitalStore! Wir freuen uns sehr über Ihr Vertrauen.',
  deliveryNote: 'Ihre Zugangsdaten bzw. Ihren Aktivierungscode erhalten Sie innerhalb von 5–30 Minuten per E-Mail. Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.',
  orderTitle: 'Ihre Bestellung',
  totalLabel: 'Gesamtsumme',
  upsellTitle: 'Das könnte Sie auch interessieren',
  upsell: [
    { n: 'Google One (Gemini Pro + 5TB)', d: 'Gemini 3.1 KI mit 1M Kontext, 5 TB Cloud, Dream Lab, Lyria 3 & Jules Agent', p: '25.00', t: '12 Monate' },
    { n: 'Microsoft 365 Premium', d: 'Word, Excel, PowerPoint, Teams, 1 TB OneDrive, Copilot KI — bis zu 5 Geräte', p: '32.00', t: '1 Jahr' },
    { n: 'Cursor Pro', d: 'Führender KI-Code-Editor mit Claude Opus 4.7, GPT-5.5, Gemini 2.5 Pro', p: '55.00', t: '1 Jahr' },
    { n: 'ChatGPT Team', d: 'Unbegrenzt GPT-5, 60+ App-Integrationen, voller Datenschutz', p: '72.00', t: '6 Monate' },
    { n: 'Claude Team Standard', d: 'KI-Codierung, Datenanalyse, Berichte & Geschäftsanwendungen', p: '72.00', t: '6 Monate' },
    { n: 'Claude Team Premium', d: 'Claude Opus 4.7, erweiterte Limits, voller Funktionsumfang', p: '360.00', t: '6 Monate' },
    { n: 'Adobe Acrobat Pro', d: 'PDF erstellen, bearbeiten, signieren & konvertieren', p: '170.00', t: '12 Monate' },
    { n: 'NordVPN', d: '6 Geräte gleichzeitig, Threat Protection, No-Logs', p: '7.00', t: 'Trial 3M' },
  ],
  upsellNote: 'Alle genannten Produkte sind bei uns zu einem stark reduzierten Preis erhältlich — wesentlich günstiger als der offizielle Preis, mit vollem Funktionsumfang.',
  supportTitle: 'Persönlicher Support',
  supportText: 'Bei Fragen oder Problemen antworten wir meist innerhalb weniger Minuten. Schreiben Sie uns jederzeit.',
  supportEmail: 'cfvblue@gmail.com',
  signature: 'Ihr DigitalStore-Team',
  // Bản dịch sẵn (chuyên nghiệp) — dùng ngay kể cả khi chưa cấu hình DeepL.
  // Khi bạn Lưu trong admin và đã có DEEPL_API_KEY, các bản này sẽ được cập nhật tự động.
  translations: {
    en: {
      subject: 'Order confirmation',
      intro: 'thank you very much for your purchase at DigitalStore! We truly appreciate your trust.',
      deliveryNote: 'You will receive your access credentials or activation code by email within 5–30 minutes. If you have any questions, we are always happy to help.',
      orderTitle: 'Your order',
      totalLabel: 'Total',
      upsellTitle: 'You might also be interested in',
      upsellNote: 'All listed products are available from us at a heavily reduced price — significantly cheaper than the official price, with the full range of features.',
      supportTitle: 'Personal support',
      supportText: 'If you have any questions or problems, we usually reply within a few minutes. Feel free to write to us anytime.',
      signature: 'Your DigitalStore team',
      upsell: [
        { d: 'Gemini 3.1 AI with 1M context, 5 TB cloud, Dream Lab, Lyria 3 & Jules Agent', t: '12 months' },
        { d: 'Word, Excel, PowerPoint, Teams, 1 TB OneDrive, Copilot AI — up to 5 devices', t: '1 year' },
        { d: 'Leading AI code editor with Claude Opus 4.7, GPT-5.5, Gemini 2.5 Pro', t: '1 year' },
        { d: 'Unlimited GPT-5, 60+ app integrations, full data privacy', t: '6 months' },
        { d: 'AI coding, data analysis, reports & business applications', t: '6 months' },
        { d: 'Claude Opus 4.7, extended limits, full feature set', t: '6 months' },
        { d: 'Create, edit, sign & convert PDFs', t: '12 months' },
        { d: '6 devices at once, Threat Protection, no-logs', t: 'Trial 3M' }
      ]
    },
    ru: {
      subject: 'Подтверждение заказа',
      intro: 'большое спасибо за вашу покупку в DigitalStore! Мы очень ценим ваше доверие.',
      deliveryNote: 'Вы получите данные для доступа или код активации по электронной почте в течение 5–30 минут. Если у вас возникнут вопросы, мы всегда готовы помочь.',
      orderTitle: 'Ваш заказ',
      totalLabel: 'Итого',
      upsellTitle: 'Вам также может быть интересно',
      upsellNote: 'Все перечисленные продукты доступны у нас по сильно сниженной цене — значительно дешевле официальной, с полным набором функций.',
      supportTitle: 'Персональная поддержка',
      supportText: 'При любых вопросах или проблемах мы обычно отвечаем в течение нескольких минут. Пишите нам в любое время.',
      signature: 'Ваша команда DigitalStore',
      upsell: [
        { d: 'ИИ Gemini 3.1 с контекстом 1M, 5 ТБ облака, Dream Lab, Lyria 3 и агент Jules', t: '12 месяцев' },
        { d: 'Word, Excel, PowerPoint, Teams, 1 ТБ OneDrive, ИИ Copilot — до 5 устройств', t: '1 год' },
        { d: 'Ведущий ИИ-редактор кода с Claude Opus 4.7, GPT-5.5, Gemini 2.5 Pro', t: '1 год' },
        { d: 'Безлимитный GPT-5, более 60 интеграций, полная конфиденциальность данных', t: '6 месяцев' },
        { d: 'ИИ-программирование, анализ данных, отчёты и бизнес-приложения', t: '6 месяцев' },
        { d: 'Claude Opus 4.7, расширенные лимиты, полный набор функций', t: '6 месяцев' },
        { d: 'Создание, редактирование, подпись и конвертация PDF', t: '12 месяцев' },
        { d: '6 устройств одновременно, Threat Protection, без логов', t: 'Пробный 3 мес' }
      ]
    }
  },
};
async function loadConfig(env) {
  if (!env.ORDERS) return { ...DEFAULT_CONFIG };
  try { const c = await env.ORDERS.get(CONFIG_KEY, { type: 'json' }); return c ? { ...DEFAULT_CONFIG, ...c } : { ...DEFAULT_CONFIG }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
async function getConfig(env, cors) {
  const cfg = await loadConfig(env);
  return json({ ok: true, config: cfg }, 200, cors);
}
async function saveConfig(request, env, cors) {
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  const cfg = { ...DEFAULT_CONFIG, ...(b && b.config ? b.config : b) };
  // chỉ giữ các trường hợp lệ của upsell
  if (Array.isArray(cfg.upsell)) cfg.upsell = cfg.upsell.map(u => ({ n: String(u.n || ''), d: String(u.d || ''), p: String(u.p || ''), t: String(u.t || '') })).filter(u => u.n);
  // Auto-translate German content -> EN/RU (DeepL) so customer emails match their language
  await translateConfig(cfg, env);
  await env.ORDERS.put(CONFIG_KEY, JSON.stringify(cfg));
  return json({ ok: true, config: cfg }, 200, cors);
}

// Admin: dịch thử (preview) — không lưu, trả về translations cho admin xem trước
async function translatePreview(request, env, cors) {
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const cfg = (b && b.config) ? b.config : b || {};
  const tr = await buildTranslations(cfg, env);
  if (!tr) return json({ ok: false, error: 'deepl_unavailable', translations: null }, 200, cors);
  return json({ ok: true, translations: tr }, 200, cors);
}

// ───────── Admin online sync (GitHub cfg/token) ─────────
const ADMIN_SYNC_KEY = '__admin_sync';
async function adminSync(request, env, cors) {
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  // Password-hash auth: requires ADMIN_PASS_HASH secret in Worker.
  if (!env.ADMIN_PASS_HASH) return json({ error: 'sync_not_configured' }, 403, cors);
  if (!b || String(b.pass_hash || '') !== String(env.ADMIN_PASS_HASH)) return json({ error: 'unauthorized' }, 401, cors);

  if (b.action === 'get') {
    const data = await env.ORDERS.get(ADMIN_SYNC_KEY, { type: 'json' });
    return json({ ok: true, data: data || null }, 200, cors);
  }
  if (b.action === 'set') {
    const payload = b.data && typeof b.data === 'object' ? b.data : null;
    if (!payload) return json({ error: 'missing_data' }, 400, cors);
    await env.ORDERS.put(ADMIN_SYNC_KEY, JSON.stringify({
      ...payload,
      updated_at: new Date().toISOString(),
    }));
    return json({ ok: true }, 200, cors);
  }
  return json({ error: 'bad_action' }, 400, cors);
}

// ───────── i18n cho email (DE mặc định → EN/RU) ─────────
const EMAIL_UI = {
  de: { greeting: 'Sehr geehrte/r {name},', sendEmail: 'E-Mail senden', regards: 'Mit freundlichen Grüßen,', team: 'Ihr DigitalStore-Team' },
  en: { greeting: 'Dear {name},', sendEmail: 'Send email', regards: 'Kind regards,', team: 'Your DigitalStore team' },
  ru: { greeting: 'Уважаемый(ая) {name},', sendEmail: 'Написать email', regards: 'С уважением,', team: 'Команда DigitalStore' },
};
const TR_FIELDS = ['subject','intro','deliveryNote','orderTitle','totalLabel','upsellTitle','upsellNote','supportTitle','supportText','signature'];

function localizeConfig(cfg, lang){
  if (!cfg || lang === 'de' || !cfg.translations || !cfg.translations[lang]) return cfg;
  const tr = cfg.translations[lang];
  const out = { ...cfg };
  for (const f of TR_FIELDS) if (tr[f]) out[f] = tr[f];
  if (Array.isArray(tr.upsell) && Array.isArray(cfg.upsell)) {
    out.upsell = cfg.upsell.map((u, i) => ({ ...u, d: (tr.upsell[i] && tr.upsell[i].d) || u.d, t: (tr.upsell[i] && tr.upsell[i].t) || u.t }));
  }
  return out;
}

async function deeplTranslate(texts, target, env){
  if (!env.DEEPL_API_KEY || !texts.length) return null;
  try {
    const host = String(env.DEEPL_API_KEY).endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const params = new URLSearchParams();
    for (const t of texts) params.append('text', t == null ? '' : String(t));
    params.append('source_lang', 'DE');
    params.append('target_lang', target);
    const r = await fetch(host + '/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + env.DEEPL_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.translations || []).map(x => x.text);
  } catch (e) { return null; }
}

async function buildTranslations(cfg, env){
  if (!env.DEEPL_API_KEY) return null;
  const ups = Array.isArray(cfg.upsell) ? cfg.upsell : [];
  const base = TR_FIELDS.map(f => String(cfg[f] || ''));
  ups.forEach(u => { base.push(String(u.d || '')); base.push(String(u.t || '')); });
  const result = {};
  for (const target of ['EN','RU']) {
    const out = await deeplTranslate(base, target, env);
    if (!out) continue;
    const obj = {};
    TR_FIELDS.forEach((f, i) => { obj[f] = out[i] != null ? out[i] : cfg[f]; });
    obj.upsell = ups.map((u, i) => ({ n: u.n, p: u.p, d: out[TR_FIELDS.length + i*2] || u.d, t: out[TR_FIELDS.length + i*2 + 1] || u.t }));
    result[target.toLowerCase()] = obj;
  }
  return Object.keys(result).length ? result : null;
}

async function translateConfig(cfg, env){
  const tr = await buildTranslations(cfg, env);
  if (tr) cfg.translations = tr;
  return cfg;
}

// ───────── D1: coupons + analytics ─────────
let __schemaReady = false;
async function ensureSchema(env){
  if (!env.DB || __schemaReady) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY, type TEXT, value REAL, scope TEXT, target_product TEXT, target_variant TEXT, usage_mode TEXT, max_uses INTEGER DEFAULT 1, used_count INTEGER DEFAULT 0, active INTEGER DEFAULT 1, expires_at TEXT, batch_id TEXT, label TEXT, created_at TEXT)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS coupon_uses(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, order_id TEXT, amount REAL, used_at TEXT)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, product_id TEXT, variant TEXT, session_id TEXT, day TEXT, created_at TEXT)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sales(order_id TEXT PRIMARY KEY, revenue REAL, items_count INTEGER, coupon_code TEXT, day TEXT, created_at TEXT)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sale_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, product_id TEXT, name TEXT, variant TEXT, qty INTEGER, line_total REAL, day TEXT)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS customers(email TEXT PRIMARY KEY, first_seen TEXT, orders_count INTEGER DEFAULT 0, total_spent REAL DEFAULT 0, last_order_at TEXT)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_day ON sales(day)`),
    ]);
    __schemaReady = true;
  } catch (e) { /* retry next call */ }
}

// Authoritative price map from the public products.json (cached ~5 min) — never trust client prices
let __priceCache = { at: 0, map: null };
async function getPriceMap(env){
  const now = Date.now();
  if (__priceCache.map && (now - __priceCache.at) < 300000) return __priceCache.map;
  const url = env.PRODUCTS_URL || 'https://digitalstoregin.github.io/Premium-Software-Subscriptions/products.json';
  try {
    const r = await fetch(url, { cf: { cacheTtl: 300 } });
    if (!r.ok) return __priceCache.map || {};
    const arr = await r.json();
    const map = {};
    (Array.isArray(arr) ? arr : []).forEach(p => {
      (p.variants || []).forEach(v => {
        map[p.id + '|' + (v.label || '')] = { price: Number(v.price) || 0, name: p.name, vstatus: v.status || 'available', pstatus: p.status || 'available' };
      });
    });
    __priceCache = { at: now, map };
    return map;
  } catch (e) { return __priceCache.map || {}; }
}

// Compute authoritative subtotal for a cart [{product_id, variant, qty}] using server prices
async function priceCart(env, items){
  const map = await getPriceMap(env);
  let subtotal = 0; const lines = [];
  for (const it of (items || [])) {
    const key = it.product_id + '|' + (it.variant || '');
    const info = map[key];
    if (!info) continue;
    const qty = Math.max(1, Number(it.qty) || 1);
    const lt = info.price * qty;
    subtotal += lt;
    lines.push({ product_id: it.product_id, name: info.name, variant: it.variant || '', qty, price: info.price, line_total: lt });
  }
  return { subtotal: Math.round(subtotal * 100) / 100, lines };
}

// ───────── Coupons logic ─────────
function genCouponCode(prefix){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i=0;i<6;i++) s += alphabet[Math.floor(Math.random()*alphabet.length)];
  return (prefix ? (String(prefix).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8) + '-') : '') + s;
}
function couponLive(c){
  if (!c || !c.active) return false;
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return false;
  const max = c.usage_mode === 'multi' ? (c.max_uses || 1) : 1;
  return (c.used_count || 0) < max;
}
function couponBase(c, priced){
  if (c.scope === 'product') return priced.lines.filter(l => String(l.product_id) === String(c.target_product)).reduce((s,l)=>s+l.line_total,0);
  if (c.scope === 'variant') return priced.lines.filter(l => String(l.product_id) === String(c.target_product) && (l.variant||'') === (c.target_variant||'')).reduce((s,l)=>s+l.line_total,0);
  return priced.subtotal;
}
function couponDiscount(c, priced){
  const base = couponBase(c, priced);
  if (base <= 0) return 0;
  let d = c.type === 'percent' ? base * (Number(c.value)||0) / 100 : Math.min(Number(c.value)||0, base);
  d = Math.min(d, priced.subtotal);
  return Math.round(d * 100) / 100;
}

async function validateCouponReq(request, env, cors){
  if (!env.DB) return json({ ok:false, reason:'unavailable' }, 200, cors);
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch { return json({ ok:false, reason:'bad_json' }, 400, cors); }
  const code = String(b.code||'').toUpperCase().trim();
  if (!code) return json({ ok:false, reason:'empty' }, 200, cors);
  const c = await env.DB.prepare('SELECT * FROM coupons WHERE code=?').bind(code).first();
  if (!c) return json({ ok:false, reason:'not_found' }, 200, cors);
  if (!couponLive(c)) return json({ ok:false, reason: (c.expires_at && new Date(c.expires_at).getTime()<Date.now()) ? 'expired' : 'used' }, 200, cors);
  const items = (b.items||[]).map(i => ({ product_id: i.product_id ?? i.id, variant: i.variant, qty: i.qty }));
  const priced = await priceCart(env, items);
  const discount = couponDiscount(c, priced);
  if (discount <= 0) {
    let target_name = null;
    if (c.scope !== 'order' && c.target_product != null) {
      const map = await getPriceMap(env);
      for (const k in map) { if (k.indexOf(String(c.target_product) + '|') === 0) { target_name = map[k].name; break; } }
    }
    return json({ ok:false, reason:'not_applicable', scope:c.scope, target_product:c.target_product, target_variant:c.target_variant, target_name }, 200, cors);
  }
  return json({ ok:true, code, type:c.type, value:c.value, scope:c.scope, discount, subtotal:priced.subtotal, total: Math.round((priced.subtotal-discount)*100)/100 }, 200, cors);
}

// Re-validate + atomically consume a coupon for an order. Returns {discount, ok} or null.
async function applyCouponForOrder(env, code, items, orderId){
  if (!env.DB || !code) return null;
  await ensureSchema(env);
  const c = await env.DB.prepare('SELECT * FROM coupons WHERE code=?').bind(code).first();
  if (!c || !couponLive(c)) return null;
  const priced = await priceCart(env, items);
  const discount = couponDiscount(c, priced);
  if (discount <= 0) return null;
  const max = c.usage_mode === 'multi' ? (c.max_uses || 1) : 1;
  const upd = await env.DB.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code=? AND active=1 AND used_count < ?').bind(code, max).run();
  const changed = (upd.meta && upd.meta.changes) || upd.changes || 0;
  if (!changed) return null; // lost the race / already consumed
  await env.DB.prepare('INSERT INTO coupon_uses(code, order_id, amount, used_at) VALUES(?,?,?,?)').bind(code, orderId, discount, new Date().toISOString()).run();
  return { ok:true, discount, subtotal: priced.subtotal };
}

async function createCoupons(request, env, cors){
  if (!env.DB) return json({ error:'d1_unavailable' }, 200, cors);
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch { return json({ error:'bad_json' }, 400, cors); }
  const type = b.type === 'fixed' ? 'fixed' : 'percent';
  const value = Number(b.value) || 0;
  const scope = ['order','product','variant'].includes(b.scope) ? b.scope : 'order';
  const usage_mode = b.usage_mode === 'multi' ? 'multi' : 'single';
  const max_uses = usage_mode === 'multi' ? Math.max(1, Number(b.max_uses)||1) : 1;
  const count = Math.min(500, Math.max(1, Number(b.count)||1));
  const expires_at = b.expires_at ? String(b.expires_at) : null;
  const prefix = b.prefix || '';
  const batch_id = 'B' + Date.now().toString(36).toUpperCase();
  const label = String(b.label||'');
  const now = new Date().toISOString();
  const created = [];
  for (let i=0;i<count;i++){
    let code = (b.code && count===1) ? String(b.code).toUpperCase().trim() : genCouponCode(prefix);
    try {
      await env.DB.prepare('INSERT INTO coupons(code,type,value,scope,target_product,target_variant,usage_mode,max_uses,used_count,active,expires_at,batch_id,label,created_at) VALUES(?,?,?,?,?,?,?,?,0,1,?,?,?,?)')
        .bind(code, type, value, scope, b.target_product?String(b.target_product):null, b.target_variant?String(b.target_variant):null, usage_mode, max_uses, expires_at, batch_id, label, now).run();
      created.push(code);
    } catch (e) { /* collision, skip */ }
  }
  return json({ ok:true, batch_id, created }, 200, cors);
}

async function listCoupons(request, env, cors){
  if (!env.DB) return json({ coupons:[] }, 200, cors);
  await ensureSchema(env);
  const u = new URL(request.url);
  const days = Number(u.searchParams.get('days')) || 0;
  let sql = 'SELECT * FROM coupons'; const binds = [];
  if (days > 0) { sql += ' WHERE created_at >= ?'; binds.push(new Date(Date.now()-days*86400000).toISOString()); }
  sql += ' ORDER BY created_at DESC LIMIT 2000';
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  return json({ ok:true, coupons: rows }, 200, cors);
}

async function deleteCoupons(request, env, cors){
  if (!env.DB) return json({ error:'d1_unavailable' }, 200, cors);
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch { b = {}; }
  if (b.code) { await env.DB.prepare('DELETE FROM coupons WHERE code=?').bind(String(b.code).toUpperCase()).run(); return json({ ok:true }, 200, cors); }
  if (b.batch_id) { await env.DB.prepare('DELETE FROM coupons WHERE batch_id=?').bind(b.batch_id).run(); return json({ ok:true }, 200, cors); }
  if (b.olderThanDays) { await env.DB.prepare('DELETE FROM coupons WHERE created_at < ?').bind(new Date(Date.now()-Number(b.olderThanDays)*86400000).toISOString()).run(); return json({ ok:true }, 200, cors); }
  if (b.all === true) { await env.DB.prepare('DELETE FROM coupons').run(); await env.DB.prepare('DELETE FROM coupon_uses').run(); return json({ ok:true }, 200, cors); }
  return json({ error:'no_target' }, 400, cors);
}

// ───────── Analytics logic ─────────
async function logEvent(request, env, cors){
  if (!env.DB) return json({ ok:false }, 200, cors);
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch { return json({ ok:false }, 200, cors); }
  const evs = Array.isArray(b.events) ? b.events : [b];
  const now = new Date(); const day = now.toISOString().slice(0,10); const iso = now.toISOString();
  const valid = ['impression','click','add_cart','begin_checkout','checkout'];
  const stmts = [];
  for (const e of evs.slice(0,60)) {
    if (!valid.includes(e.type)) continue;
    stmts.push(env.DB.prepare('INSERT INTO events(type,product_id,variant,session_id,day,created_at) VALUES(?,?,?,?,?,?)')
      .bind(e.type, e.product_id!=null?String(e.product_id):null, e.variant?String(e.variant):null, e.session_id?String(e.session_id):null, day, iso));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok:true, n: stmts.length }, 200, cors);
}

async function logSale(env, order){
  await ensureSchema(env);
  const day = (order.created_at || new Date().toISOString()).slice(0,10);
  const itemsCount = (order.items || []).reduce((s,i)=>s+(Number(i.qty)||0),0);
  await env.DB.prepare('INSERT OR REPLACE INTO sales(order_id,revenue,items_count,coupon_code,day,created_at) VALUES(?,?,?,?,?,?)')
    .bind(order.order_id, Number(order.total)||0, itemsCount, order.coupon||null, day, order.created_at||new Date().toISOString()).run();
  const stmts = (order.items || []).map(i => env.DB.prepare('INSERT INTO sale_items(order_id,product_id,name,variant,qty,line_total,day) VALUES(?,?,?,?,?,?,?)')
    .bind(order.order_id, i.product_id!=null?String(i.product_id):null, i.name||'', i.variant||'', Number(i.qty)||1, (Number(i.qty)||1)*(Number(i.price)||0), day));
  if (stmts.length) await env.DB.batch(stmts);
  // Customer (by email) for New/Returning/LTV
  const email = (order.customer && order.customer.email) ? String(order.customer.email).toLowerCase().trim() : null;
  if (email) {
    const rev = Number(order.total)||0; const at = order.created_at||new Date().toISOString();
    const ex = await env.DB.prepare('SELECT email FROM customers WHERE email=?').bind(email).first();
    if (ex) await env.DB.prepare('UPDATE customers SET orders_count=orders_count+1, total_spent=total_spent+?, last_order_at=? WHERE email=?').bind(rev, at, email).run();
    else await env.DB.prepare('INSERT INTO customers(email,first_seen,orders_count,total_spent,last_order_at) VALUES(?,?,1,?,?)').bind(email, at, rev, at).run();
  }
}

async function getStats(request, env, cors){
  if (!env.DB) return json({ ok:false, stats:null }, 200, cors);
  await ensureSchema(env);
  const u = new URL(request.url);
  const days = Math.max(1, Number(u.searchParams.get('days')) || 7);
  const since = new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const today = new Date().toISOString().slice(0,10);
  const md = new Date(); md.setDate(1); const mStart = md.toISOString().slice(0,10);
  const q = (sql,...b) => env.DB.prepare(sql).bind(...b).first();
  const all = (sql,...b) => env.DB.prepare(sql).bind(...b).all().then(r=>r.results||[]);
  const revTotal = await q('SELECT COALESCE(SUM(revenue),0) v, COUNT(*) n FROM sales');
  const revToday = await q('SELECT COALESCE(SUM(revenue),0) v, COUNT(*) n FROM sales WHERE day=?', today);
  const revMonth = await q('SELECT COALESCE(SUM(revenue),0) v FROM sales WHERE day>=?', mStart);
  const revRange = await q('SELECT COALESCE(SUM(revenue),0) v, COUNT(*) n FROM sales WHERE day>=?', since);
  const ordersRange = revRange.n || 0;
  const aov = ordersRange ? revRange.v/ordersRange : 0;
  const sess = await q('SELECT COUNT(DISTINCT session_id) n FROM events WHERE day>=? AND session_id IS NOT NULL', since);
  const conversion = sess.n ? (ordersRange/sess.n*100) : 0;
  const topClicks = await all("SELECT product_id, COUNT(*) c FROM events WHERE type='click' AND day>=? GROUP BY product_id ORDER BY c DESC LIMIT 10", since);
  const topCart = await all("SELECT product_id, COUNT(*) c FROM events WHERE type='add_cart' AND day>=? GROUP BY product_id ORDER BY c DESC LIMIT 10", since);
  const topSold = await all("SELECT product_id, name, SUM(qty) q, COALESCE(SUM(line_total),0) rev FROM sale_items WHERE day>=? GROUP BY product_id ORDER BY q DESC LIMIT 10", since);
  const revByProduct = await all("SELECT product_id, name, COALESCE(SUM(line_total),0) rev, SUM(qty) q FROM sale_items WHERE day>=? GROUP BY product_id ORDER BY rev DESC LIMIT 50", since);
  const series = await all("SELECT day, COALESCE(SUM(revenue),0) rev, COUNT(*) orders FROM sales WHERE day>=? GROUP BY day ORDER BY day", since);
  const seriesSessions = await all("SELECT day, COUNT(DISTINCT session_id) s FROM events WHERE day>=? AND session_id IS NOT NULL GROUP BY day ORDER BY day", since);
  const custTotal = await q('SELECT COUNT(*) n, COALESCE(SUM(total_spent),0) s FROM customers');
  const custNew = await q('SELECT COUNT(*) n FROM customers WHERE first_seen>=?', since+'T00:00:00');
  const custRet = await q('SELECT COUNT(*) n FROM customers WHERE orders_count>1');
  const totalCust = custTotal.n||0;
  const customers = { total: totalCust, new: custNew.n||0, returning: custRet.n||0, repeatRate: totalCust ? (custRet.n/totalCust*100) : 0, ltv: totalCust ? (custTotal.s/totalCust) : 0 };
  const eventTotals = await all("SELECT type, COUNT(*) c FROM events WHERE day>=? GROUP BY type", since);
  const prodEvents = await all("SELECT product_id, type, COUNT(*) c FROM events WHERE day>=? AND product_id IS NOT NULL GROUP BY product_id, type", since);
  const unitsRange = await q('SELECT COALESCE(SUM(qty),0) q FROM sale_items WHERE day>=?', since);
  // Previous period (same length) for trend arrows
  const prevSinceD = new Date(Date.now()-days*2*86400000).toISOString().slice(0,10);
  const prevRev = await q('SELECT COALESCE(SUM(revenue),0) v, COUNT(*) n FROM sales WHERE day>=? AND day<?', prevSinceD, since);
  const prevSess = await q('SELECT COUNT(DISTINCT session_id) n FROM events WHERE day>=? AND day<? AND session_id IS NOT NULL', prevSinceD, since);
  const prevUnits = await q('SELECT COALESCE(SUM(qty),0) q FROM sale_items WHERE day>=? AND day<?', prevSinceD, since);
  const prevAov = prevRev.n ? prevRev.v/prevRev.n : 0;
  const prevConv = prevSess.n ? (prevRev.n/prevSess.n*100) : 0;
  // Coupon usage summary
  const cpUses = await q('SELECT COUNT(*) n, COALESCE(SUM(amount),0) d FROM coupon_uses WHERE used_at>=?', since+'T00:00:00');
  const cpTop = await all('SELECT code, COUNT(*) c, COALESCE(SUM(amount),0) d FROM coupon_uses WHERE used_at>=? GROUP BY code ORDER BY c DESC LIMIT 10', since+'T00:00:00');
  return json({ ok:true, days,
    kpi:{ revenueTotal:revTotal.v, ordersTotal:revTotal.n, revenueToday:revToday.v, ordersToday:revToday.n, revenueMonth:revMonth.v, revenueRange:revRange.v, ordersRange, aov, sessions:sess.n, conversion, unitsRange:unitsRange.q },
    prev:{ revenue:prevRev.v, orders:prevRev.n, aov:prevAov, conversion:prevConv, sessions:prevSess.n, units:prevUnits.q },
    coupons:{ uses:cpUses.n, discount:cpUses.d, top:cpTop },
    topClicks, topCart, topSold, revByProduct, series, seriesSessions, eventTotals, prodEvents, customers }, 200, cors);
}

async function deleteStats(request, env, cors){
  if (!env.DB) return json({ error:'d1_unavailable' }, 200, cors);
  await ensureSchema(env);
  let b; try { b = await request.json(); } catch { b = {}; }
  if (b.all === true) { await env.DB.batch([env.DB.prepare('DELETE FROM events'), env.DB.prepare('DELETE FROM sales'), env.DB.prepare('DELETE FROM sale_items')]); return json({ ok:true }, 200, cors); }
  const d = Math.max(1, Number(b.olderThanDays) || 7);
  const cut = new Date(Date.now()-d*86400000).toISOString().slice(0,10);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE day < ?').bind(cut),
    env.DB.prepare('DELETE FROM sales WHERE day < ?').bind(cut),
    env.DB.prepare('DELETE FROM sale_items WHERE day < ?').bind(cut),
  ]);
  return json({ ok:true, cutoff:cut }, 200, cors);
}

function renderEmail({ name, items, total, supportEmail, cfg, lang }) {
  cfg = cfg || DEFAULT_CONFIG;
  lang = (lang === 'en' || lang === 'ru') ? lang : 'de';
  const U = EMAIL_UI[lang] || EMAIL_UI.de;
  const brand = esc(cfg.brandName || 'DigitalStore');
  const boughtRows = (items.length ? items : [{ name: '—', variant: '', qty: 1, price: 0 }]).map(i => `
    <tr>
      <td style="font-size:14px;color:#0a0a0a;padding:10px 14px;border-bottom:1px solid #e7e7ea">
        <strong>${esc(i.name)}</strong>${i.variant ? ` <span style="color:#71717a">· ${esc(i.variant)}</span>` : ''}${i.qty > 1 ? ` <span style="color:#71717a">× ${i.qty}</span>` : ''}
      </td>
      <td style="font-size:14px;font-weight:bold;color:#0a0a0a;padding:10px 14px;border-bottom:1px solid #e7e7ea;text-align:right;white-space:nowrap">€${num(i.qty * i.price)}</td>
    </tr>`).join('');

  const upsellRows = (cfg.upsell || []).map(u => `
    <tr><td style="padding:0 0 8px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;border-radius:8px">
        <tr>
          <td style="padding:12px 14px">
            <div style="font-size:14px;font-weight:600;color:#0a0a0a">${esc(u.n)}</div>
            <div style="font-size:12px;color:#71717a;margin-top:2px">${esc(u.d)}</div>
          </td>
          <td style="padding:12px 14px;text-align:right;white-space:nowrap;vertical-align:top">
            <div style="font-size:14px;font-weight:700;color:#0a0a0a">€${esc(u.p)}</div>
            <div style="font-size:12px;color:#a1a1aa">${esc(u.t)}</div>
          </td>
        </tr>
      </table>
    </td></tr>`).join('');

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0a0a0a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#0a0a0a;padding:18px 24px">
    <span style="color:#fff;font-size:16px;font-weight:700;letter-spacing:-.02em">${brand}</span>
    <span style="color:#a1a1aa;font-size:14px;font-weight:400;margin-left:6px">— ${esc(cfg.subject || 'Bestellbestätigung')}</span>
  </td></tr>
  <tr><td style="padding:24px">
    <h1 style="font-size:20px;margin:0 0 14px">${U.greeting.replace('{name}', esc(name))}</h1>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 12px">${esc(cfg.intro || '')}</p>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 18px">${esc(cfg.deliveryNote || '')}</p>

    <div style="font-size:11px;font-weight:700;color:#71717a;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px">${esc(cfg.orderTitle || 'Ihre Bestellung')}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ea;border-radius:8px;overflow:hidden;margin-bottom:6px">
      ${boughtRows}
      <tr>
        <td style="font-size:15px;font-weight:bold;color:#0a0a0a;padding:12px 14px;background:#fafafa">${esc(cfg.totalLabel || 'Gesamtsumme')}</td>
        <td style="font-size:15px;font-weight:bold;color:#0a0a0a;padding:12px 14px;background:#fafafa;text-align:right">€${num(total)}</td>
      </tr>
    </table>

    ${upsellRows ? `<hr style="border:none;border-top:1px solid #e7e7ea;margin:22px 0">
    <div style="font-size:11px;font-weight:700;color:#71717a;letter-spacing:.08em;text-transform:uppercase;margin:0 0 12px">${esc(cfg.upsellTitle || 'Das könnte Sie auch interessieren')}</div>
    <table width="100%" cellpadding="0" cellspacing="0">${upsellRows}</table>
    ${cfg.upsellNote ? `<p style="font-size:12px;color:#a1a1aa;line-height:1.5;margin:6px 0 18px">${esc(cfg.upsellNote)}</p>` : ''}` : ''}

    <div style="background:#f4f4f5;border-radius:10px;padding:16px 18px;margin:18px 0 12px">
      <p style="font-size:13px;font-weight:600;color:#0a0a0a;margin:0 0 6px">✉ ${esc(cfg.supportTitle || 'Persönlicher Support')}</p>
      <p style="font-size:13px;color:#52525b;line-height:1.6;margin:0">${esc(cfg.supportText || '')}</p>
    </div>
    <div style="text-align:center;margin:0 0 18px">
      <a href="mailto:${esc(supportEmail)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-size:14px;padding:11px 26px;border-radius:10px;font-weight:600;letter-spacing:.01em">${U.sendEmail}</a>
    </div>

    <p style="font-size:14px;color:#3f3f46;margin:0">${U.regards}<br><strong>${esc(cfg.signature || U.team)}</strong></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// ───────── POST /order/:id/proof ─────────
async function uploadProof(request, env, cors, id) {
  let form; try { form = await request.formData(); } catch { return json({ error: 'bad_form' }, 400, cors); }
  const proof = form.get('proof');
  if (!proof || typeof proof === 'string') return json({ error: 'no_file' }, 400, cors);
  if (proof.size > 4 * 1024 * 1024) return json({ error: 'file_too_large' }, 413, cors);
  if (!env.PROOFS) return json({ error: 'r2_unavailable' }, 500, cors);
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);

  const order = await env.ORDERS.get(id, { type: 'json' });
  if (!order) return json({ error: 'order_not_found', order_id: id }, 404, cors);

  const ext = (proof.name || 'proof').split('.').pop() || 'bin';
  const r2Key = `${id}/${Date.now()}.${ext}`;

  // Upload file vào R2 (dùng ArrayBuffer để tương thích tốt hơn).
  let r2ok = false;
  let r2Err = '';
  try {
    const buf = await proof.arrayBuffer();
    await env.PROOFS.put(r2Key, buf, {
      httpMetadata: { contentType: proof.type || 'application/octet-stream' },
      customMetadata: { orderId: id, originalName: proof.name || 'proof', uploadedAt: new Date().toISOString() },
    });
    r2ok = true;
  } catch (e) {
    r2Err = String(e && e.message || e);
    r2ok = false;
  }
  if (!r2ok) return json({ error: 'r2_upload_failed', message: r2Err || 'unknown_error' }, 500, cors);

  // Cập nhật đơn hàng trong KV
  order.proof = { name: proof.name || 'proof', size: proof.size, r2Key, at: new Date().toISOString() };
  order.status = (order.status === 'awaiting_payment' || order.status === 'created') ? 'proof_uploaded' : order.status;
  order.updated_at = new Date().toISOString();
  order.history.push({ at: order.updated_at, status: order.status, note: 'proof uploaded to R2' });
  await env.ORDERS.put(id, JSON.stringify(order));
  return json({ ok: true, order_id: id, r2: r2ok, key: r2Key }, 200, cors);
}

// ───────── GET /order/:id/proof (admin — tải file chứng từ từ R2) ─────────
async function getProofFile(request, env, cors, id) {
  if (!env.PROOFS || !env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  const o = await env.ORDERS.get(id, { type: 'json' });
  if (!o || !o.proof || !o.proof.r2Key) return json({ error: 'no_proof' }, 404, cors);
  const obj = await env.PROOFS.get(o.proof.r2Key);
  if (!obj) return json({ error: 'file_not_found' }, 404, cors);
  const headers = { ...cors, 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${o.proof.name || 'proof'}"` };
  return new Response(obj.body, { headers });
}

// ───────── GET /order/:id (public) ─────────
async function lookupOrder(env, cors, id) {
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  const o = await env.ORDERS.get(id, { type: 'json' });
  if (!o) return json({ error: 'not_found' }, 404, cors);
  return json({ order_id: o.order_id, status: o.status, lang: o.lang || 'de', total: o.total, currency: o.currency, created_at: o.created_at, updated_at: o.updated_at, proof: !!o.proof }, 200, cors);
}

// ───────── GET /orders (admin) ─────────
async function listOrders(env, cors) {
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  const list = await env.ORDERS.list({ limit: 1000 });
  const orders = [];
  for (const k of list.keys) { const o = await env.ORDERS.get(k.name, { type: 'json' }); if (o) orders.push(o); }
  orders.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return json({ ok: true, count: orders.length, orders }, 200, cors);
}

// ───────── POST /order/:id/status (admin) ─────────
async function updateStatus(request, env, cors, id) {
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (!STATUSES.includes(b.status)) return json({ error: 'bad_status', allowed: STATUSES }, 400, cors);
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  const o = await env.ORDERS.get(id, { type: 'json' });
  if (!o) return json({ error: 'not_found' }, 404, cors);
  o.status = b.status; o.updated_at = new Date().toISOString();
  o.history.push({ at: o.updated_at, status: b.status, note: b.note || '' });
  await env.ORDERS.put(id, JSON.stringify(o));
  return json({ ok: true, order_id: id, status: o.status }, 200, cors);
}

// ───────── DELETE /order/:id (admin) ─────────
async function deleteOrder(env, cors, id) {
  if (!env.ORDERS) return json({ error: 'storage_unavailable' }, 500, cors);
  await env.ORDERS.delete(id);
  return json({ ok: true, deleted: id }, 200, cors);
}
