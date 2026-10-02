// Thin PayPal REST client (sandbox or live, set by PAYPAL_API). No dependencies.
const API = () => process.env.PAYPAL_API || 'https://api-m.sandbox.paypal.com';
let cached = { token: null, exp: 0 };

export async function token() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const r = await fetch(`${API()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status} ${JSON.stringify(j)}`);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export async function pp(method, path, body, extraHeaders = {}) {
  const t = await token();
  const r = await fetch(`${API()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!r.ok) {
    const err = new Error(`PayPal ${method} ${path} -> ${r.status}: ${text.slice(0, 600)}`);
    err.status = r.status; err.body = json; err.debugId = r.headers.get('paypal-debug-id');
    throw err;
  }
  return { status: r.status, json, headers: r.headers };
}

// ---- Invoicing ----
export const nextInvoiceNumber = async () => (await pp('POST', '/v2/invoicing/generate-next-invoice-number')).json.invoice_number;
export const createInvoice = (body, requestId) => pp('POST', '/v2/invoicing/invoices', body, requestId ? { 'PayPal-Request-Id': requestId } : {});
export const getInvoice = (id) => pp('GET', `/v2/invoicing/invoices/${id}`);
export const sendInvoice = (id, o = {}) => pp('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: false, send_to_invoicer: false, ...o });
export const remindInvoice = (id, o) => pp('POST', `/v2/invoicing/invoices/${id}/remind`, o);
export const recordPayment = (id, o) => pp('POST', `/v2/invoicing/invoices/${id}/payments`, o);
export const cancelInvoice = (id, o) => pp('POST', `/v2/invoicing/invoices/${id}/cancel`, o);
export const qrCode = (id, o = { width: 300, height: 300 }) => pp('POST', `/v2/invoicing/invoices/${id}/generate-qr-code`, o);

// ---- Subscriptions ----
export const createProduct = (body) => pp('POST', '/v1/catalogs/products', body);
export const createPlan = (body) => pp('POST', '/v1/billing/plans', body);
export const getPlan = (id) => pp('GET', `/v1/billing/plans/${id}`);
export const createSubscription = (body) => pp('POST', '/v1/billing/subscriptions', body);
export const getSubscription = (id) => pp('GET', `/v1/billing/subscriptions/${id}`);
export const cancelSubscription = (id, reason) => pp('POST', `/v1/billing/subscriptions/${id}/cancel`, { reason });

// ---- Webhooks ----
export const verifyWebhook = (body) => pp('POST', '/v1/notifications/verify-webhook-signature', body);
export const listWebhooks = () => pp('GET', '/v1/notifications/webhooks');
export const createWebhook = (url, types) => pp('POST', '/v1/notifications/webhooks', { url, event_types: types.map((name) => ({ name })) });

// Creating an invoice twice with the same invoice_number is a 422 from PayPal. When the number is derived from an
// idempotency key that means "already created": find the existing invoice and return it instead of failing.
export async function createInvoiceOnce(body, requestId) {
  try { return await createInvoice(body, requestId); } catch (e) {
    const dup = e.status === 422 && JSON.stringify(e.body || '').includes('DUPLICATE_INVOICE_NUMBER');
    if (!dup) throw e;
    const found = (await pp('POST', '/v2/invoicing/search-invoices?page=1&page_size=5', { invoice_number: body.detail.invoice_number })).json.items?.[0];
    if (!found) throw e;
    return { status: 200, json: found, existing: true };
  }
}
