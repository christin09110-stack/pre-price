// Proves a duplicate invoice number is treated as success and leaves exactly one invoice.
import * as P from '../lambda/paypal.mjs';
const num = 'DUP' + Date.now().toString(36).toUpperCase();
const body = () => ({ detail: { invoice_number: num, currency_code: 'USD', payment_term: { term_type: 'NET_30' } }, primary_recipients: [{ billing_info: { name: { given_name: 'Dup', surname: 'Test' }, email_address: 'dup.test@example.com' } }], items: [{ name: 'Facility charge', quantity: '1', unit_amount: { currency_code: 'USD', value: '10.00' } }] });
let raw;
try { await P.createInvoice(body()); raw = await P.createInvoice(body()); console.log('raw second create unexpectedly succeeded'); } catch (e) { console.log('raw second create ->', e.status, JSON.stringify(e.body?.details?.[0] || e.body).slice(0, 200)); }
const a = await P.createInvoiceOnce(body(), 'dup-req-1');
console.log('createInvoiceOnce after duplicate ->', a.existing ? 'returned existing invoice' : 'created', a.json.id);
const s = (await P.pp('POST', '/v2/invoicing/search-invoices?page=1&page_size=10', { invoice_number: num })).json;
console.log(`invoices with number ${num}:`, s.total_items ?? s.items?.length);
process.exit(s.items?.length === 1 ? 0 : 1);
