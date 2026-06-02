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
    name: i.name || '', variant: i.variant || '', qty: Number(i.qty) || 1, price: Number(i.price) || 0,
  })) : [];
  const subtotal = norm.reduce((s, i) => s + i.qty * i.price, 0);
  const order = {
    order_id: orderId, status: 'awaiting_payment',
    customer: { name, email },
    items: norm, subtotal, discount: 0, total: Number(total) || subtotal, currency: 'EUR',
    proof: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), status: 'awaiting_payment', note: 'created' }],
  };
  if (env.ORDERS) await env.ORDERS.put(orderId, JSON.stringify(order));

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
  const cfg = await loadConfig(env);
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
        htmlContent: renderEmail({ name, items: order.items || [], total: order.total, cfg, supportEmail: env.SUPPORT_EMAIL || cfg.supportEmail || 'cfvblue@gmail.com' }),
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
  await env.ORDERS.put(CONFIG_KEY, JSON.stringify(cfg));
  return json({ ok: true, config: cfg }, 200, cors);
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

function renderEmail({ name, items, total, supportEmail, cfg }) {
  cfg = cfg || DEFAULT_CONFIG;
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
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="width:32px;height:32px;background:#fff;border-radius:8px;text-align:center;font-weight:700;color:#0a0a0a;font-size:16px">${brand.slice(0, 1) || 'D'}</td>
      <td style="padding-left:10px;color:#fff;font-size:16px;font-weight:700">${brand} — ${esc(cfg.subject || 'Bestellbestätigung')}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px">
    <h1 style="font-size:20px;margin:0 0 14px">Sehr geehrte/r ${esc(name)},</h1>
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
      <a href="mailto:${esc(supportEmail)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-size:14px;padding:11px 26px;border-radius:10px;font-weight:600;letter-spacing:.01em">E-Mail senden</a>
    </div>

    <p style="font-size:14px;color:#3f3f46;margin:0">Mit freundlichen Grüßen,<br><strong>${esc(cfg.signature || 'Ihr DigitalStore-Team')}</strong></p>
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
  return json({ order_id: o.order_id, status: o.status, total: o.total, currency: o.currency, created_at: o.created_at, updated_at: o.updated_at, proof: !!o.proof }, 200, cors);
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
