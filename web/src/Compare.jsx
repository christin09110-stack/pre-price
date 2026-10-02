import { money, zeroPlan, cardPlan, CARD_APR } from './util.js';

// The signature panel: the same amount, paid two ways.
export default function Compare({ amount, months, downPct, onMonths, onDown, readOnly }) {
  const z = zeroPlan(amount, months, downPct);
  const k = cardPlan(amount, months);
  const max = k.total;
  const pct = (v) => `${Math.max(0, (v / max) * 100).toFixed(2)}%`;
  const extra = k.total - z.total;
  return (
    <section className="compare" aria-labelledby="cmp-title">
      <div className="compare-head">
        <div>
          <div className="eyebrow">The same {money(amount)}, paid two ways</div>
          <h2 id="cmp-title">0% instalments against a medical credit card</h2>
        </div>
        <p className="small muted" style={{ margin: 0, maxWidth: '36ch' }}>Card figures use the {CARD_APR}% average APR reported in JAMA Health Forum 2025 (PMID 40215074).</p>
      </div>

      {!readOnly && (
        <div className="controls">
          <div className="field">
            <label htmlFor="months">Length of plan: <b className="num">{months} months</b></label>
            <input id="months" type="range" min="3" max="36" step="1" value={months} onChange={(e) => onMonths(+e.target.value)} aria-valuetext={`${months} months`} />
            <span className="hint">3 to 36 months. Both sides use the same length.</span>
          </div>
          <div className="field">
            <label htmlFor="down">Down payment: <b className="num">{downPct}% ({money(z.down)})</b></label>
            <input id="down" type="range" min="0" max="30" step="5" value={downPct} onChange={(e) => onDown(+e.target.value)} aria-valuetext={`${downPct} percent`} />
            <span className="hint">0 to 30%. In a 2023 phone survey, 16 hospitals asked for up to half down before allowing instalments (PMID 38808329). The card side has no down payment.</span>
          </div>
        </div>
      )}

      <div className="compare-cols">
        <div className="col zero">
          <div className="label">This plan: 0% instalments</div>
          <div className="big num">{money(z.monthly)}<small> a month</small></div>
          <dl className="kv">
            <dt>Down payment</dt><dd className="num">{money(z.down)}</dd>
            <dt>Number of payments</dt><dd className="num">{months}</dd>
            <dt>Total paid</dt><dd className="num">{money(z.total)}</dd>
            <dt className="interest">Interest and fees</dt><dd className="num interest">{money(0)}</dd>
          </dl>
        </div>
        <div className="col card-col">
          <div className="label">Medical credit card at {CARD_APR}% APR</div>
          <div className="big num">{money(k.monthly)}<small> a month</small></div>
          <dl className="kv">
            <dt>Down payment</dt><dd className="num">{money(0)}</dd>
            <dt>Number of payments</dt><dd className="num">{months}</dd>
            <dt>Total paid</dt><dd className="num">{money(k.total)}</dd>
            <dt className="interest">Interest</dt><dd className="num interest">{money(k.interest)}</dd>
          </dl>
        </div>
      </div>

      <div className="bars" role="img" aria-label={`Total paid. This plan: ${money(z.total)}, no interest. Card: ${money(k.total)}, of which ${money(k.interest)} is interest. Difference ${money(extra)}.`}>
        <div className="bar-row">
          <span className="bl">This plan</span>
          <div className="bar"><span className="p" style={{ width: pct(z.total) }} /></div>
          <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{money(z.total)}</span>
        </div>
        <div className="bar-row">
          <span className="bl">Card</span>
          <div className="bar"><span className="p" style={{ width: pct(amount) }} /><span className="i" style={{ width: pct(k.interest) }} /></div>
          <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{money(k.total)}</span>
        </div>
        <p className="small" style={{ margin: 0 }}>
          <span className="interest-val" style={{ fontWeight: 700 }}>Hatched section: {money(k.interest)} of interest.</span>{' '}
          The card costs {money(extra)} more than this plan over {months} months.
        </p>
      </div>
      <div className="compare-note">
        Card figures assume equal monthly payments with no promotional period. Many medical cards advertise a deferred-interest promotion of 6 to 18 months that charges back-dated interest if the balance is not cleared in time. The 0% side is a PayPal billing plan whose payments add up exactly to the quote.
      </div>
    </section>
  );
}
