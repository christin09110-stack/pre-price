// Pure money logic. No network, no model. Everything here is unit-tested.
export const CARD_APR = 26.99; // average medical credit card APR, JAMA Health Forum 2025 (PMID 40215074)
const c = (x) => Math.round(x * 100 + 1e-9) / 100;
export const money = (x) => c(x).toFixed(2);

// Amortised monthly payment on a card at `apr` percent, no deferred-interest promotion.
export function cardPlan(amount, months, apr = CARD_APR) {
  const r = apr / 100 / 12;
  const pay = r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months));
  const monthly = c(pay);
  const total = c(monthly * months);
  return { apr, months, monthly, total, interest: c(total - amount) };
}

// 0% plan: optional down payment, then equal monthly payments. Cents are settled in the down payment,
// so the instalments are identical and the sum is exactly the quote.
export function zeroPlan(amount, months, downPct = 0) {
  if (!(months >= 1 && months <= 36)) throw new Error('months must be 1-36');
  if (!(downPct >= 0 && downPct <= 50)) throw new Error('down payment must be 0-50%');
  const wantDown = c(amount * downPct / 100);
  const monthly = Math.floor(((amount - wantDown) / months) * 100) / 100;
  const down = c(amount - monthly * months);
  return { months, monthly, down, total: c(down + monthly * months), interest: 0, apr: 0 };
}

// Insurance path: patient share of a hospital-stated allowed amount, from the patient's own plan terms.
export function patientShare(allowed, { deductibleRemaining = 0, coinsurancePct = 0, oopRemaining = Infinity }) {
  let ded = Math.min(deductibleRemaining, allowed);
  let coins = c((allowed - ded) * coinsurancePct / 100);
  let capped = false;
  if (ded + coins > oopRemaining) {
    capped = true;
    ded = Math.min(ded, oopRemaining);
    coins = c(oopRemaining - ded);
  }
  return { deductible: c(ded), coinsurance: c(coins), total: c(ded + coins), capped, allowed: c(allowed) };
}

// Turn a grounded extraction into itemised quote lines, or refuse and say why.
export function buildQuote(ex, input = {}) {
  const proc = `${ex.procedure?.description || ex.procedureLabel} (${ex.procedure?.code_system || ''} ${ex.procedure?.code || ''})`.replace(/\s+/g, ' ').trim();
  const where = `${ex.hospital}, file line ${ex.quote?.line ?? ex.self_pay_price?.line ?? ''}`.replace(/, file line $/, '');
  const refuse = (reason) => ({ ok: false, reason });
  if (input.coverage === 'insured') {
    const rate = (ex.negotiated_rates || []).find((r) => `${r.payer}|${r.plan || ''}|${r.row_id}|${r.field}` === input.rateKey);
    if (!rate) return refuse('Choose which plan you have from the rates the hospital published.');
    if (ex.quote?.scope === 'component_only' || ex.quote?.scope === 'none') return refuse(ex.quote.basis);
    const s = patientShare(rate.value, input);
    const lines = [];
    if (s.deductible > 0) lines.push({ name: 'Deductible still to meet', description: `${proc}. Applied to the hospital's stated amount of $${money(rate.value)} for ${rate.payer}${rate.plan ? ' / ' + rate.plan : ''}. Source: ${where}.`, amount: s.deductible });
    if (s.coinsurance > 0) lines.push({ name: `Coinsurance ${input.coinsurancePct}% on the remainder${s.capped ? ' (limited by out-of-pocket maximum)' : ''}`, description: `${input.coinsurancePct}% of the amount above your deductible.`, amount: s.coinsurance });
    if (!lines.length) return refuse('With these plan terms your share of the hospital charge is $0.00.');
    return { ok: true, basis: 'insured', allowed: s.allowed, payer: rate.payer, plan: rate.plan, kind: rate.kind, lines, total: s.total, caveat: rate.kind === 'estimated_allowed_amount' ? 'The hospital publishes this as an estimate of what the plan allows, not a fixed contract price. The patient share is binding at the plan terms entered here; if the plan\'s real terms differ, the quote is re-issued.' : 'Binding at the plan terms entered here; re-issued if the plan\'s real terms differ.' };
  }
  // self-pay
  if (ex.quote?.scope !== 'facility_total' || ex.quote?.amount == null || !ex.quote?.grounded) return refuse(ex.quote?.basis || 'This file does not contain a usable facility price for this procedure.');
  return { ok: true, basis: 'self_pay', lines: [{ name: `Facility charge: ${ex.procedure?.description || ex.procedureLabel}`, description: `${proc}. Self-pay price as published by ${where}. ${ex.quote.basis}`, amount: ex.quote.amount }], total: ex.quote.amount, caveat: null };
}
