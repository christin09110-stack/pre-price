import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as P from './paypal.mjs';
import * as S from './store.mjs';
import { extract } from './extract.mjs';
import { runAgent } from './agent.mjs';
import { HOSPITALS, SEEDS, reviveTarget } from './catalog.mjs';
import { buildQuote, zeroPlan, cardPlan, money, CARD_APR } from './policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = Object.fromEntries(readdirSync(path.join(here, 'seed')).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(readFileSync(path.join(here, 'seed', f), 'utf8')); return [j.id, j]; }));
const SITE = process.env.SITE_URL || 'https://example.com';
const uid = () => Math.random().toString(36).slice(2, 10);
const res = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }

const getExtraction = async (id) => (await S.get(`EXTRACTION#${id}`)) || SEED[id] || null;
const slim = (e) => ({ id: e.id, seed: e.seed, hospitalInfo: e.hospitalInfo, extractedAt: e.extractedAt, status: e.status, quote: e.quote, procedure: e.procedure, self_pay_price: e.self_pay_price, gross_charge: e.gross_charge, min_rate: e.min_rate, max_rate: e.max_rate, negotiated_rates: e.negotiated_rates, not_in_file: e.not_in_file, problems: e.problems, confidence: e.confidence, grounding: e.grounding, scan: e.scan, usage: e.usage, trace: e.trace, confidenceDetail: e.confidenceDetail, live: e.live, model: e.model, hospital: e.hospital, procedureLabel: e.procedureLabel });
const withRows = (e) => ({ ...slim(e), rows: e.rows, common: e.common, header: e.header });

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/health', async () => ({ ok: true, time: new Date().toISOString(), paypal: process.env.PAYPAL_API, model: process.env.BEDROCK_MODEL, clock: 'Subscription clock is simulated in demos: PayPal sandbox has no clock control.' }));

const LIMITS = { agent: 150, quote: 300, plan: 300 };
route('GET', '/api/budget', async () => Object.fromEntries(await Promise.all(Object.entries(LIMITS).map(async ([k, lim]) => [k, { used: await S.peek(k), limit: lim }]))));
route('GET', '/api/catalog', async () => ({ cardApr: CARD_APR, hospitals: HOSPITALS, items: SEEDS.map((s) => ({ ...s, extraction: slim(SEED[s.id]) })) }));
route('GET', '/api/extractions/:id', async ({ params }) => { const e = await getExtraction(params.id); if (!e) throw new HttpError(404, 'No such extraction'); return withRows(e); });

route('POST', '/api/extract', async ({ body }) => {
  const seed = SEEDS.find((s) => s.id === body.seedId);
  if (!seed) throw new HttpError(400, 'Live extraction is limited to the catalogued hospital files. Pass seedId.');
  if (await S.bump('extract', 40) === null) throw new HttpError(429, 'Daily live-extraction budget reached. The stored extraction is still available.');
  const h = HOSPITALS[seed.hospital];
  const r = await extract({ url: h.url, target: reviveTarget(seed.target), procedureLabel: `${seed.label} (${seed.codeLabel})`, hospital: h.name });
  const id = `${seed.id}-live-${uid()}`;
  const out = { id, seed, hospitalInfo: h, extractedAt: new Date().toISOString(), live: true, ...r };
  await S.put(`EXTRACTION#${id}`, 'META', out);
  return withRows(out);
});

route('POST', '/api/agent', async ({ body }) => {
  if (!body.message || String(body.message).length > 600) throw new HttpError(400, 'Describe the operation in a sentence (under 600 characters).');
  if (!HOSPITALS[body.hospitalId]) throw new HttpError(400, 'Pick one of the catalogued hospital files.');
  if (await S.bump('agent', 150) === null) throw new HttpError(429, 'Daily live-agent budget reached. The stored extractions still work.');
  const r = await runAgent({ message: String(body.message), hospitalId: body.hospitalId, history: (body.history || []).slice(-6).map((h) => ({ role: h.role === 'agent' ? 'agent' : 'patient', text: String(h.text).slice(0, 300) })) });
  if (r.status === 'needs_input') return r;
  const id = `live-${uid()}`;
  const ex = { id, seed: null, extractedAt: new Date().toISOString(), live: true, ...r.extraction };
  await S.put(`EXTRACTION#${id}`, 'META', ex);
  return { status: 'done', extraction: withRows(ex) };
});

route('POST', '/api/compare', async ({ body }) => {
  const amount = Number(body.amount), months = Number(body.months), down = Number(body.downPct || 0);
  return { zero: zeroPlan(amount, months, down), card: cardPlan(amount, months) };
});

// One-time account setup using the deeper Invoicing endpoints (spec 2.12.0): a reusable template and scheduled auto-reminders.
async function ensureInvoicing() {
  let cfg = await S.get('CONFIG#invoicing');
  if (cfg) return cfg;
  const found = ((await P.pp('GET', '/v2/invoicing/templates?fields=all&page=1&page_size=50')).json.templates || []).find((t) => t.name === 'Pre-Price binding quote');
  const tpl = found || (await P.pp('POST', '/v2/invoicing/templates', { name: 'Pre-Price binding quote', default_template: false,
    template_info: { detail: { currency_code: 'USD', note: 'Binding quote. The price is fixed for 30 days.', terms_and_conditions: 'Priced from the hospital\'s own published price file. Sandbox demonstration.', payment_term: { term_type: 'NET_30' } },
      configuration: { partial_payment: { allow_partial_payment: true, minimum_amount_due: { currency_code: 'USD', value: '25.00' } }, allow_tip: false } } })).json;
  let rem = (await P.pp('GET', '/v2/invoicing/reminders')).json;
  if (!rem.configurations?.length) rem = (await P.pp('POST', '/v2/invoicing/setup-reminders', { configurations: [
    { type: 'BEFORE_DUE', interval: { unit: 'DAY', value: 3 }, repetition: 1, notification: { send_to_invoicer: false } },
    { type: 'AFTER_DUE', interval: { unit: 'DAY', value: 2 }, repetition: 2, notification: { send_to_invoicer: false } }] })).json;
  cfg = { templateId: tpl.id, reminderIds: rem.configurations.map((c) => c.id) };
  await S.put('CONFIG#invoicing', 'META', cfg);
  return cfg;
}

route('POST', '/api/quotes', async ({ body, headers }) => {
  const idem = String(headers['idempotency-key'] || body.idempotencyKey || '').slice(0, 64);
  if (idem) { const prev = await S.get(`IDEM#${idem}`); if (prev) { const q = await S.get(`QUOTE#${prev.quoteId}`); if (q) return { issued: true, quote: q, replayed: true }; } }
  const ex = await getExtraction(body.extractionId);
  if (!ex) throw new HttpError(404, 'No such extraction');
  const pt = body.patient || {};
  if (!pt.given || !pt.surname || !/^\S+@\S+\.\S+$/.test(pt.email || '')) throw new HttpError(400, 'Patient name and a valid email are needed on the quote.');
  const q = buildQuote(ex, body);
  if (!q.ok) return { issued: false, reason: q.reason };
  if (await S.bump('quote', 300) === null) throw new HttpError(429, 'Daily sandbox quote budget reached.');
  const inv0 = await ensureInvoicing();
  const num = idem ? createHash('sha256').update(idem).digest('hex').slice(0, 10).toUpperCase() : `${new Date().toISOString().slice(5,10).replace('-','')}-${uid().toUpperCase().slice(0,6)}`; // PayPal's generate-next-invoice-number returned a 26+ char value that its own create call rejects
  const validUntil = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const notInFile = (ex.not_in_file || []).slice(0, 8).join('; ');
  const invoice = await P.createInvoiceOnce({
    detail: {
      invoice_number: `PP-${num}`, currency_code: 'USD', reference: ex.id.slice(0, 60),
      note: `Binding quote for ${ex.procedure?.description || ex.procedureLabel}. This amount is fixed until ${validUntil}.`,
      memo: `pre-price extraction ${ex.id}; sandbox demonstration, not a real medical bill`,
      terms_and_conditions: `Source: ${ex.hospital}'s own published machine-readable price file, ${ex.hospitalInfo?.url || ''}. ${q.caveat ? q.caveat + ' ' : ''}NOT included in this quote because the file does not contain them: ${notInFile || 'professional fees'}. SANDBOX DEMONSTRATION: no real patient, no real money.`.slice(0, 4000),
      payment_term: { term_type: 'NET_30' },
    },
    primary_recipients: [{ billing_info: { name: { given_name: pt.given, surname: pt.surname }, email_address: pt.email } }],
    items: q.lines.map((l) => ({ name: l.name.slice(0, 200), description: l.description.slice(0, 1000), quantity: '1', unit_amount: { currency_code: 'USD', value: money(l.amount) } })),
    configuration: { template_id: inv0.templateId, partial_payment: { allow_partial_payment: true, minimum_amount_due: { currency_code: 'USD', value: money(Math.min(q.total, 25)) } }, allow_tip: false },
  }, idem ? `pp-${idem}` : undefined);
  const id = invoice.json.id;
  await P.sendInvoice(id, { subject: `Your binding quote from ${ex.hospital}`, note: 'Your itemised quote. Instalment plans at 0% are available.', send_to_recipient: true });
  let qr = null;
  try {
    const r = await fetch(`${process.env.PAYPAL_API}/v2/invoicing/invoices/${id}/generate-qr-code`, { method: 'POST', headers: { Authorization: `Bearer ${await P.token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ width: 240, height: 240 }) });
    const t = await r.text(); const m = t.match(/\r\n\r\n([A-Za-z0-9+/=]{100,})/) || (/^[A-Za-z0-9+/=]{100,}$/.test(t.trim()) ? [0, t.trim()] : null);
    if (r.ok && m) qr = 'data:image/png;base64,' + m[1];
  } catch { /* QR is optional */ }
  const inv = (await P.getInvoice(id)).json;
  const quote = { id: uid(), procedureTitle: ex.seed?.label, invoiceId: id, invoiceNumber: inv.detail.invoice_number, status: inv.status, extractionId: ex.id, hospital: ex.hospital, procedure: ex.procedure, patient: pt, lines: q.lines, total: q.total, basis: q.basis, payer: q.payer, plan: q.plan, caveat: q.caveat, validUntil, recipientUrl: inv.detail.metadata.recipient_view_url, invoicerUrl: inv.detail.metadata.invoicer_view_url, qr, createdAt: new Date().toISOString(), payments: [], events: [{ at: new Date().toISOString(), what: `Invoice created from template ${inv0.templateId} and sent (POST /v2/invoicing/invoices, /send); auto-reminders ${inv0.reminderIds.length} configured`, ref: id }] };
  await S.put(`QUOTE#${quote.id}`, 'META', quote);
  await S.put(`INV#${id}`, 'META', { quoteId: quote.id });
  if (idem) await S.put(`IDEM#${idem}`, 'META', { quoteId: quote.id });
  return { issued: true, quote };
});

const loadQuote = async (id) => { const q = await S.get(`QUOTE#${id}`); if (!q) throw new HttpError(404, 'No such quote'); return q; };
const refresh = async (q) => {
  const inv = (await P.getInvoice(q.invoiceId)).json;
  q.status = inv.status; q.paid = inv.payments?.paid_amount?.value || '0.00'; q.due = inv.due_amount?.value || q.due;
  q.payments = (inv.payments?.transactions || []).map((t) => ({ id: t.payment_id, date: t.payment_date, amount: t.amount.value, method: t.method, note: t.note }));
  if (q.subscriptionId) { try { q.subscription = { ...q.subscription, status: (await P.getSubscription(q.subscriptionId)).json.status }; } catch { /* keep last */ } }
  return q;
};
const log = (q, what, ref) => q.events.unshift({ at: new Date().toISOString(), what, ref });

route('GET', '/api/quotes/:id', async ({ params }) => { const q = await refresh(await loadQuote(params.id)); await S.put(`QUOTE#${q.id}`, 'META', q); return q; });

route('POST', '/api/quotes/:id/remind', async ({ params }) => {
  const q = await loadQuote(params.id);
  await P.remindInvoice(q.invoiceId, { subject: 'Reminder: your instalment plan', note: 'Your next instalment on the quote is coming up.', send_to_recipient: true });
  log(q, 'Reminder sent via POST /v2/invoicing/invoices/{id}/remind', q.invoiceId);
  await S.put(`QUOTE#${q.id}`, 'META', q); return q;
});

route('POST', '/api/quotes/:id/plan', async ({ params, body }) => {
  const q = await loadQuote(params.id);
  if (q.subscriptionId) throw new HttpError(409, 'This quote already has a plan.');
  const plan = zeroPlan(q.total, Number(body.months), Number(body.downPct || 0));
  if (plan.months < 2) throw new HttpError(400, 'A plan needs at least 2 months.');
  if (await S.bump('plan', 300) === null) throw new HttpError(429, 'Daily sandbox plan budget reached.');
  let prod = await S.get('CONFIG#product');
  if (!prod) { prod = { id: (await P.createProduct({ name: 'Pre-Price 0% instalment plan', description: 'Interest-free instalments on a binding hospital quote', type: 'SERVICE', category: 'SERVICES' })).json.id }; await S.put('CONFIG#product', 'META', prod); }
  const cur = 'USD';
  const pl = (await P.createPlan({
    product_id: prod.id, name: `0% plan ${q.invoiceNumber}: ${plan.months} x $${money(plan.monthly)}`.slice(0, 120), description: `Instalments on quote ${q.invoiceNumber}. 0% interest, no fees.`,
    billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: plan.months, pricing_scheme: { fixed_price: { value: money(plan.monthly), currency_code: cur } } }],
    payment_preferences: { auto_bill_outstanding: true, setup_fee: plan.down > 0 ? { value: money(plan.down), currency_code: cur } : undefined, setup_fee_failure_action: 'CANCEL', payment_failure_threshold: 2 },
  })).json;
  const sub = (await P.createSubscription({ plan_id: pl.id, custom_id: q.id, subscriber: { name: { given_name: q.patient.given, surname: q.patient.surname }, email_address: q.patient.email }, application_context: { brand_name: 'Pre-Price', user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING', return_url: `${SITE}/?approved=${q.id}`, cancel_url: `${SITE}/?cancelled=${q.id}` } })).json;
  q.planTerms = plan; q.planId = pl.id; q.subscriptionId = sub.id;
  q.subscription = { id: sub.id, status: sub.status, approveUrl: sub.links.find((l) => l.rel === 'approve')?.href };
  q.schedule = { paid: 0, simulated: true };
  log(q, `Billing plan ${pl.id} and subscription ${sub.id} created; waiting for the patient to approve once in PayPal`, sub.id);
  await S.put(`QUOTE#${q.id}`, 'META', q); await S.put(`SUB#${sub.id}`, 'META', { quoteId: q.id });
  return q;
});

// Demo clock. PayPal's sandbox has no clock control for subscriptions, so we cannot make a real renewal
// happen on demand. This does what the PAYMENT.SALE.COMPLETED webhook would do: record the instalment on the invoice.
const reconcile = async (q, amount, note) => {
  await P.recordPayment(q.invoiceId, { method: 'BANK_TRANSFER', payment_date: new Date().toISOString().slice(0, 10), amount: { currency_code: 'USD', value: money(amount) }, note: note.slice(0, 250) });
};
route('POST', '/api/quotes/:id/advance', async ({ params }) => {
  const q = await loadQuote(params.id);
  if (!q.planTerms) throw new HttpError(400, 'Create a plan first.');
  const t = q.planTerms; const k = q.schedule.paid; // instalments recorded so far (down payment counts as the first when present)
  const steps = (t.down > 0 ? 1 : 0) + t.months;
  if (k >= steps) throw new HttpError(409, 'Plan already complete.');
  const isDown = t.down > 0 && k === 0;
  const amt = isDown ? t.down : t.monthly;
  const label = isDown ? 'down payment' : `instalment ${k - (t.down > 0 ? 1 : 0) + 1} of ${t.months}`;
  await reconcile(q, amt, `SIMULATED CLOCK: ${label}. PayPal sandbox cannot advance subscription time.`);
  q.schedule.paid = k + 1;
  log(q, `SIMULATED clock tick: ${label} ($${money(amt)}) recorded with POST /v2/invoicing/invoices/{id}/payments`, q.invoiceId);
  const r = await refresh(q); await S.put(`QUOTE#${q.id}`, 'META', r); return r;
});

route('POST', '/api/quotes/:id/cancel', async ({ params }) => {
  const q = await refresh(await loadQuote(params.id));
  if (Number(q.paid) > 0) throw new HttpError(409, 'Payments are already recorded on this quote, so it can no longer be cancelled. To stop further instalments, cancel the subscription in PayPal; any refund is arranged with the hospital.');
  await P.cancelInvoice(q.invoiceId, { subject: 'Quote withdrawn', note: 'Quote cancelled by the patient.', send_to_recipient: false, send_to_invoicer: false });
  if (q.subscriptionId) { try { await P.cancelSubscription(q.subscriptionId, 'Patient cancelled'); } catch { /* may be unapproved */ } }
  log(q, 'Quote cancelled (POST /v2/invoicing/invoices/{id}/cancel)', q.invoiceId);
  const r = await refresh(q); await S.put(`QUOTE#${q.id}`, 'META', r); return r;
});

route('GET', '/api/events', async () => ({ events: await S.list('EVENTS', { limit: 30 }) }));

route('POST', '/api/webhooks/paypal', async ({ rawBody, headers }) => {
  let evt; try { evt = JSON.parse(rawBody); } catch { return { __status: 400, rejected: 'not json' }; }
  const cfg = await S.get('CONFIG#webhook');
  let verified = 'no-webhook-configured';
  if (cfg?.id) {
    try {
      const v = await P.verifyWebhook({ auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'], transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'], webhook_id: cfg.id, webhook_event: evt });
      verified = v.json.verification_status;
    } catch (e) { verified = 'verify-error'; }
  }
  const rec = { at: new Date().toISOString(), id: evt.id, type: evt.event_type, summary: evt.summary, resource: evt.resource?.invoice?.id || evt.resource?.id, verified };
  if (verified !== 'SUCCESS') { await S.put('EVENTS', `${Date.now()}-rej-${uid()}`, { ...rec, rejected: true }); return { __status: 401, rejected: true, verified }; }
  if (evt.id && await S.get(`EVT#${evt.id}`)) return { received: true, duplicate: true }; // idempotent replay
  if (evt.id) await S.put(`EVT#${evt.id}`, 'META', { at: rec.at });
  await S.put('EVENTS', `${Date.now()}-${evt.id}`, rec);
  const after = async () => { try {
    if (evt.event_type.startsWith('INVOICING.INVOICE.')) {
      const m = await S.get(`INV#${evt.resource?.invoice?.id || evt.resource?.id}`);
      if (m) { const q = await loadQuote(m.quoteId); log(q, `Verified webhook ${evt.event_type}`, evt.id); await refresh(q); await S.put(`QUOTE#${q.id}`, 'META', q); }
    } else if (evt.event_type.startsWith('BILLING.SUBSCRIPTION.')) {
      const m = await S.get(`SUB#${evt.resource?.id}`);
      if (m) { const q = await loadQuote(m.quoteId); log(q, `Verified webhook ${evt.event_type}`, evt.id); q.subscription = { ...q.subscription, status: evt.resource.status || q.subscription.status }; await S.put(`QUOTE#${q.id}`, 'META', q); }
    }
  } catch (e) { console.error('webhook follow-up failed', e.message); } };
  return { received: true, verified, __after: after };
});

// ---------- entry ----------
export const handle = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
  const p = (event.rawPath || event.path || '/').replace(/\/+$/, '') || '/';
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = p.match(r.re); if (!m) continue;
    try {
      let body = {}; if (rawBody && !p.includes('/webhooks/')) { try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, 'Body must be JSON'); } }
      const out = await r.fn({ params: m.groups || {}, body, rawBody, headers });
      if (out && out.__status) { const { __status, ...rest } = out; return res(__status, rest); }
      if (out && out.__after) { const { __after, ...rest } = out; const r2 = res(200, rest); r2.after = __after; return r2; }
      return res(200, out);
    } catch (e) {
      if (e instanceof HttpError) return res(e.code, { error: e.message });
      console.error(e.stack || e);
      return res(e.status && e.status >= 400 && e.status < 500 ? 502 : 500, { error: String(e.message).slice(0, 500), paypalDebugId: e.debugId });
    }
  }
  return res(404, { error: 'Not found', path: p });
};

// ---------- streaming entry (Lambda Function URL, InvokeMode RESPONSE_STREAM) ----------
// /api/agent/stream sends newline-delimited JSON: real byte progress while the price file is read, each tool call as it
// happens, then the result. Every other route is buffered and sent in one write.
const agentStream = async (event, write) => {
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch { return write({ type: 'error', error: 'Body must be JSON' }); }
  try {
    if (!body.message || String(body.message).length > 600) throw new HttpError(400, 'Describe the operation in a sentence (under 600 characters).');
    if (!HOSPITALS[body.hospitalId]) throw new HttpError(400, 'Pick one of the catalogued hospital files.');
    if (await S.bump('agent', 150) === null) throw new HttpError(429, 'The daily limit on live agent runs has been reached. Stored results still open.');
    let lastP = 0;
    const r = await runAgent({
      message: String(body.message), hospitalId: body.hospitalId,
      history: (body.history || []).slice(-6).map((h) => ({ role: h.role === 'agent' ? 'agent' : 'patient', text: String(h.text).slice(0, 300) })),
      onStep: (s) => write({ type: 'step', step: s }),
      onProgress: (p) => { const now = Date.now(); if (now - lastP > 200) { lastP = now; write({ type: 'progress', ...p }); } },
    });
    if (r.status === 'needs_input') return write({ type: 'result', ...r });
    const id = `live-${uid()}`;
    const ex = { id, seed: null, extractedAt: new Date().toISOString(), live: true, ...r.extraction };
    await S.put(`EXTRACTION#${id}`, 'META', ex);
    write({ type: 'result', status: 'done', extraction: withRows(ex) });
  } catch (e) {
    write({ type: 'error', error: e instanceof HttpError ? e.message : String(e.message).slice(0, 300) });
  }
};

const sl = globalThis.awslambda;
export const handler = sl?.streamifyResponse
  ? sl.streamifyResponse(async (event, stream) => {
      const p = (event.rawPath || '').replace(/\/+$/, '');
      if (p === '/api/agent/stream' && event.requestContext?.http?.method === 'POST') {
        stream = sl.HttpResponseStream.from(stream, { statusCode: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
        await agentStream(event, (o) => stream.write(JSON.stringify(o) + '\n'));
        return stream.end();
      }
      const r = await handle(event);
      stream = sl.HttpResponseStream.from(stream, { statusCode: r.statusCode, headers: r.headers });
      stream.write(r.body || ''); stream.end();
      if (r.after) await r.after(); // PayPal gets its 200 first; follow-up work happens after the response is sent
    })
  : handle;
