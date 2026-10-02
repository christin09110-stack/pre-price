import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPlan, zeroPlan, patientShare, buildQuote } from '../policy.mjs';

test('zero plan sums exactly to quote and has equal instalments', () => {
  for (const [amt, m, d] of [[4464.93, 12, 10], [3333.33, 7, 0], [100, 3, 50], [26612.02, 36, 20]]) {
    const p = zeroPlan(amt, m, d);
    assert.equal(Math.round((p.down + p.monthly * m) * 100), Math.round(amt * 100));
    assert.equal(p.interest, 0);
  }
});
test('card plan at 26.99% costs more than the principal', () => {
  const p = cardPlan(4464.93, 12);
  assert.ok(p.interest > 600 && p.interest < 700, `interest ${p.interest}`);
});
test('patient share respects deductible, coinsurance and OOP max', () => {
  assert.deepEqual(patientShare(10000, { deductibleRemaining: 1000, coinsurancePct: 20, oopRemaining: 5000 }), { deductible: 1000, coinsurance: 1800, total: 2800, capped: false, allowed: 10000 });
  const cap = patientShare(80000, { deductibleRemaining: 2000, coinsurancePct: 20, oopRemaining: 3500 });
  assert.equal(cap.total, 3500); assert.ok(cap.capped);
});
test('refuses component-only and ungrounded extractions', () => {
  assert.equal(buildQuote({ quote: { scope: 'component_only', basis: 'prof fee' } }, { coverage: 'self_pay' }).ok, false);
  assert.equal(buildQuote({ quote: { scope: 'facility_total', amount: 5, grounded: false } }, { coverage: 'self_pay' }).ok, false);
});
test('self-pay quote from grounded facility total', () => {
  const q = buildQuote({ hospital: 'H', procedure: { description: 'Knee arthroscopy', code: '29881', code_system: 'CPT' }, quote: { scope: 'facility_total', amount: 4464.93, grounded: true, basis: 'b', line: 9 } }, { coverage: 'self_pay' });
  assert.equal(q.ok, true); assert.equal(q.total, 4464.93);
});
