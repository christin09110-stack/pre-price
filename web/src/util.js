export const API = import.meta.env.VITE_API || '';
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n) => (n == null || Number.isNaN(Number(n)) ? '' : fmt.format(Number(n)));
export const money0 = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n));
export const mb = (b) => (b / 1e6).toFixed(b > 99e6 ? 0 : 1);
export const dt = (s) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function j(r) {
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) { const e = new Error(body?.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return body;
}
export const get = (p) => fetch(API + p).then(j);
export const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(j);

// newline-delimited JSON stream from /api/agent/stream
export async function streamAgent(body, { onProgress, onStep, signal }) {
  const r = await fetch(API + '/api/agent/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) throw new Error(`The agent could not be reached (${r.status}). Try again in a moment.`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      if (m.type === 'progress') onProgress?.(m); else if (m.type === 'step') onStep?.(m.step); else if (m.type === 'error') throw new Error(m.error); else if (m.type === 'result') result = m;
    }
  }
  if (!result) throw new Error('The agent stopped before finishing. Run it again.');
  return result;
}

export const SAVED = 'pp-quotes';
export const savedIds = () => { try { return JSON.parse(localStorage.getItem(SAVED) || '[]'); } catch { return []; } };
export const saveId = (id) => { try { const a = savedIds().filter((x) => x !== id); a.unshift(id); localStorage.setItem(SAVED, JSON.stringify(a.slice(0, 30))); } catch { /* storage blocked */ } };

export const statusWord = (s) => ({ SENT: 'Sent, unpaid', PARTIALLY_PAID: 'Partly paid', PAID: 'Paid in full', MARKED_AS_PAID: 'Paid in full', CANCELLED: 'Cancelled', DRAFT: 'Draft', UNPAID: 'Unpaid' }[s] || s);
export const statusTone = (s) => ({ PAID: 'ok', MARKED_AS_PAID: 'ok', PARTIALLY_PAID: 'warn', CANCELLED: 'risk' }[s] || 'neutral');
export const rateKey = (r) => `${r.payer}|${r.plan || ''}|${r.row_id}|${r.field}`;

// Same formulas as lambda/policy.mjs (kept in sync by the unit tests there).
export const CARD_APR = 26.99;
const c2 = (x) => Math.round(x * 100 + 1e-9) / 100;
export function cardPlan(amount, months, apr = CARD_APR) {
  const r = apr / 100 / 12;
  const monthly = c2((amount * r) / (1 - Math.pow(1 + r, -months)));
  const total = c2(monthly * months);
  return { apr, months, monthly, total, interest: c2(total - amount) };
}
export function zeroPlan(amount, months, downPct = 0) {
  const wantDown = c2((amount * downPct) / 100);
  const monthly = Math.floor(((amount - wantDown) / months) * 100) / 100;
  const down = c2(amount - monthly * months);
  return { months, monthly, down, total: c2(down + monthly * months), interest: 0 };
}
