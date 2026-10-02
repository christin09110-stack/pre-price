// End-to-end test against REAL PayPal sandbox + REAL DynamoDB, through the Lambda handler (local) or a deployed URL.
// Usage: node scripts/e2e.mjs [baseUrl]
import { handle as handler } from '../lambda/handler.mjs';
const BASE = process.argv[2];
const call = async (method, path, body) => {
  if (BASE) { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { code: r.status, json: await r.json() }; }
  const r = await handler({ requestContext: { http: { method } }, rawPath: path, headers: {}, body: body ? JSON.stringify(body) : undefined });
  return { code: r.statusCode, json: JSON.parse(r.body) };
};
let fails = 0;
const step = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`); if (!ok) fails++; };
const patient = { given: 'Test', surname: 'Patient', email: 'test.patient@example.com' };

let r = await call('GET', '/api/health'); step('health', r.code === 200, JSON.stringify(r.json));
r = await call('GET', '/api/catalog'); step('catalog has 6 seeded extractions', r.json.items?.length === 6, r.json.items?.map((i) => `${i.id}:${i.extraction.status}/${i.extraction.quote.scope}`).join(' '));

// --- refusal paths
r = await call('POST', '/api/quotes', { extractionId: 'brookings-27447', coverage: 'self_pay', patient });
step('REFUSES to quote Brookings knee replacement (file only has professional fees)', r.json.issued === false, r.json.reason);
r = await call('POST', '/api/quotes', { extractionId: 'jhh-470', coverage: 'self_pay', patient });
step('REFUSES self-pay quote at Johns Hopkins DRG 470 (file has no cash price)', r.json.issued === false, r.json.reason);

// --- self-pay, McLaren Flint knee arthroscopy
r = await call('POST', '/api/quotes', { extractionId: 'mclaren-29881', coverage: 'self_pay', patient });
step('INVOICING create+send: McLaren Flint knee arthroscopy', r.json.issued === true && r.json.quote.status === 'SENT', r.json.quote && `invoice ${r.json.quote.invoiceId} #${r.json.quote.invoiceNumber} status=${r.json.quote.status} total=$${r.json.quote.total} lines=${r.json.quote.lines.length} qr=${!!r.json.quote.qr}\n        ${r.json.quote.recipientUrl}`);
const q = r.json.quote; if (!q) process.exit(1);
step('quote total equals grounded file cell ($4,464.93)', q.total === 4464.93);
step('INVOICING QR code generated', !!q.qr);

r = await call('POST', `/api/quotes/${q.id}/remind`); step('INVOICING remind', r.code === 200, r.json.events?.[0]?.what);
r = await call('POST', `/api/quotes/${q.id}/plan`, { months: 12, downPct: 10 });
step('BILLING plan + subscription create (12 months, 10% down)', r.code === 200 && r.json.subscription?.status === 'APPROVAL_PENDING', r.code === 200 ? `plan ${r.json.planId} sub ${r.json.subscription.id} status=${r.json.subscription.status}\n        terms ${JSON.stringify(r.json.planTerms)}\n        approve: ${r.json.subscription.approveUrl}` : JSON.stringify(r.json));
const terms = r.json.planTerms;
r = await call('POST', `/api/quotes/${q.id}/advance`); step('SIMULATED clock tick 1: down payment -> record-payment', r.code === 200 && r.json.status === 'PARTIALLY_PAID', r.code === 200 ? `status=${r.json.status} paid=${r.json.paid} due=${r.json.due}` : JSON.stringify(r.json));
r = await call('POST', `/api/quotes/${q.id}/advance`); step('SIMULATED clock tick 2: instalment 1', r.code === 200 && r.json.payments.length === 2, r.code === 200 ? `paid=${r.json.paid} due=${r.json.due}` : JSON.stringify(r.json));
for (let i = 0; i < terms.months - 1; i++) r = await call('POST', `/api/quotes/${q.id}/advance`);
step('invoice reaches PAID (PayPal reports MARKED_AS_PAID for externally recorded payments) after all instalments', ['PAID','MARKED_AS_PAID'].includes(r.json.status) && Number(r.json.due) === 0, `status=${r.json.status} paid=${r.json.paid} due=${r.json.due} payments=${r.json.payments.length}`);
r = await call('POST', `/api/quotes/${q.id}/advance`); step('no 13th instalment', r.code === 409, r.json.error);

// --- insured, Johns Hopkins DRG 470
const ex = (await call('GET', '/api/extractions/jhh-470')).json;
const rate = ex.negotiated_rates.find((x) => /Aetna/.test(x.payer)) || ex.negotiated_rates[0];
r = await call('POST', '/api/quotes', { extractionId: 'jhh-470', coverage: 'insured', rateKey: `${rate.payer}|${rate.plan || ''}|${rate.row_id}|${rate.field}`, deductibleRemaining: 2000, coinsurancePct: 20, oopRemaining: 3500, patient });
step('INVOICING insured quote at Johns Hopkins (allowed $' + rate.value + ', OOP cap $3,500)', r.json.issued === true && r.json.quote.total === 3500, r.json.quote ? `invoice ${r.json.quote.invoiceId} total=$${r.json.quote.total} lines=${r.json.quote.lines.map((l) => l.name + ' $' + l.amount).join(' | ')}` : r.json.reason);
if (r.json.quote) { const c = await call('POST', `/api/quotes/${r.json.quote.id}/cancel`); step('INVOICING cancel', c.json.status === 'CANCELLED', `status=${c.json.status}`); }

// --- idempotency: same Idempotency-Key must not create a second invoice
const key = 'e2e-' + Date.now();
const a = await call('POST', '/api/quotes', { extractionId: 'mclaren-29881', coverage: 'self_pay', patient, idempotencyKey: key });
const b = await call('POST', '/api/quotes', { extractionId: 'mclaren-29881', coverage: 'self_pay', patient, idempotencyKey: key });
step('IDEMPOTENCY: replayed request returns the same invoice, no duplicate', a.json.quote && b.json.replayed === true && a.json.quote.invoiceId === b.json.quote.invoiceId, `first ${a.json.quote?.invoiceId}  replay ${b.json.quote?.invoiceId} replayed=${b.json.replayed}`);

// --- webhooks
const fake = { id: 'WH-TAMPER-' + Date.now(), event_type: 'INVOICING.INVOICE.PAID', resource: { id: a.json.quote?.invoiceId } };
if (BASE) {
  const w = await fetch(BASE + '/api/webhooks/paypal', { method: 'POST', headers: { 'content-type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270', 'paypal-transmission-id': 'forged-1', 'paypal-transmission-sig': 'AAAA', 'paypal-transmission-time': new Date().toISOString() }, body: JSON.stringify(fake) });
  const wj = await w.json();
  step('WEBHOOK: forged/tampered payload is rejected (HTTP 401)', w.status === 401 && wj.rejected === true, `HTTP ${w.status} ${JSON.stringify(wj)}`);
  // trigger genuine events: cancelling an invoice makes PayPal call our webhook
  const c = await call('POST', `/api/quotes/${a.json.quote.id}/cancel`);
  step('cancel (fires INVOICING.INVOICE.CANCELLED at our webhook)', c.json.status === 'CANCELLED', `status=${c.json.status}`);
  let ev = null;
  for (let i = 0; i < 12 && !ev; i++) { await new Promise((r) => setTimeout(r, 5000)); ev = (await call('GET', '/api/events')).json.events.find((e) => e.type === 'INVOICING.INVOICE.CANCELLED' && e.verified === 'SUCCESS'); }
  step('WEBHOOK: genuine PayPal event arrived and passed verify-webhook-signature', !!ev, ev ? JSON.stringify(ev) : 'no verified event within 60s');
}

// --- agent (Bedrock is shared with other workloads on this account and throttles; retry those, and say so)
const agent = async (body) => { for (let i = 0; i < 5; i++) { const r = await call('POST', '/api/agent', body); if (r.code === 200 || !/Too many requests/.test(JSON.stringify(r.json))) return r; console.log(`        (Bedrock throttled, retry ${i + 1})`); await new Promise((x) => setTimeout(x, 25000)); } return call('POST', '/api/agent', body); };
const ag1 = await agent({ message: 'I need knee surgery', hospitalId: 'mclaren' });
step('AGENT asks a clarifying question for a vague request', ag1.json.status === 'needs_input', ag1.json.question ? ag1.json.question + ' ' + JSON.stringify(ag1.json.options) : 'HTTP ' + ag1.code + ' ' + JSON.stringify(ag1.json).slice(0, 300));
const ag2 = await agent({ message: 'Knee arthroscopy for a torn meniscus', hospitalId: 'mclaren', history: [{ role: 'patient', text: 'I need knee surgery' }, { role: 'agent', text: ag1.json.question }] });
const e2 = ag2.json.extraction;
step('AGENT resolves code, streams the file, records a grounded price', ag2.json.status === 'done' && e2.quote.amount === 4464.93 && e2.grounding.removed.length === 0, e2 && `tools: ${e2.trace.filter((t) => t.kind === 'tool').map((t) => t.name).join(' > ')}\n        ${e2.trace.filter((t) => t.name === 'search_price_file').map((t) => t.summary)}  confidence=${e2.confidenceDetail.level} (${e2.confidenceDetail.reasons.join('; ')})`);
const ag3 = await agent({ message: 'Total knee replacement CPT 27447', hospitalId: 'brookings' });
step('AGENT refuses to invent a price when the file only has professional fees', ag3.json.status === 'done' && ag3.json.extraction.quote.scope !== 'facility_total', ag3.json.extraction && `scope=${ag3.json.extraction.quote.scope} confidence=${ag3.json.extraction.confidenceDetail.level}: ${ag3.json.extraction.quote.basis}`);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
