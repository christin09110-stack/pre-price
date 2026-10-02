import { useCallback, useEffect, useState } from 'react';
import { Icon, Badge, Modal } from './ui.jsx';
import Compare from './Compare.jsx';
import { get, post, money, dt, statusWord, statusTone, zeroPlan } from './util.js';

export default function QuotePage({ id, toast }) {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState(null);
  const [months, setMonths] = useState(12);
  const [down, setDown] = useState(10);
  const [confirm, setConfirm] = useState(null); // 'plan' | 'cancel'
  const [busy, setBusy] = useState(null);
  const [events, setEvents] = useState([]);
  const [actErr, setActErr] = useState(null);

  const load = useCallback(() => get(`/api/quotes/${id}`).then((x) => { setQ(x); setErr(null); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setQ(null); load(); get('/api/events').then((r) => setEvents(r.events)).catch(() => {}); }, [load]);
  useEffect(() => { if (q?.planTerms) { setMonths(q.planTerms.months); setDown(Math.round((q.planTerms.down / q.total) * 100)); } }, [q?.planTerms?.months]); // eslint-disable-line

  async function act(kind, path, body, okMsg) {
    setBusy(kind); setActErr(null);
    try { const r = await post(path, body); setQ(r); toast(okMsg); } catch (e) { setActErr(`${e.message}`); } finally { setBusy(null); setConfirm(null); }
  }

  if (err) return <div className="wrap"><div className="callout risk" role="alert"><Icon n="alert" /><div><b>This quote could not be loaded.</b><p className="small">{err} The link may be wrong, or the quote belongs to a different browser session. Open your saved quotes to find it.</p><a className="btn" href="#/quotes">Saved quotes</a></div></div></div>;
  if (!q) return <div className="wrap" aria-busy="true"><div className="skeleton" style={{ height: 36, width: '50%', marginBottom: 16 }} /><div className="skeleton" style={{ height: 320 }} /></div>;

  const mine = events.filter((e) => e.resource && (e.resource === q.invoiceId || e.resource === q.subscriptionId));
  const planned = !!q.planTerms;
  const preview = zeroPlan(q.total, months, down);
  const steps = planned ? (q.planTerms.down > 0 ? 1 : 0) + q.planTerms.months : 0;
  const paidSteps = q.schedule?.paid || 0;
  const cancelled = q.status === 'CANCELLED';
  const paidFull = q.status === 'PAID' || q.status === 'MARKED_AS_PAID';

  return (
    <div className="wrap">
      <a href="#/quotes" className="small">← Saved quotes</a>
      <div className="row between" style={{ margin: '8px 0 var(--s5)' }}>
        <h1 className="serif" style={{ fontSize: 'clamp(1.75rem,1.2rem + 2vw,2.5rem)', fontWeight: 600, letterSpacing: '-.015em', lineHeight: 1.15 }}>Your binding quote</h1>
        <Badge tone={statusTone(q.status)}>{statusWord(q.status)}</Badge>
      </div>

      <article className="doc" aria-labelledby="doc-t">
        <div className="eyebrow">Itemised quote · PayPal invoice {q.invoiceNumber}</div>
        <h2 id="doc-t">{q.procedureTitle || q.procedure?.description}</h2>
        <dl className="meta">
          <div><dt>Hospital</dt><dd>{q.hospital}</dd></div>
          <div><dt>Code</dt><dd>{q.procedure?.code_system} {q.procedure?.code}</dd></div>
          <div><dt>Patient</dt><dd>{q.patient.given} {q.patient.surname}</dd></div>
          <div><dt>Price fixed until</dt><dd className="num">{q.validUntil}</dd></div>
        </dl>
        {q.lines.map((l, i) => (
          <div key={i} className="line-item"><div><b>{l.name}</b><div className="small muted">{l.description}</div></div><div className="amt num">{money(l.amount)}</div></div>
        ))}
        <div className="total"><span className="eyebrow" style={{ margin: 0 }}>Total due</span><span className="figure num">{money(q.total)}</span></div>
        {q.caveat && <div className="callout warn" style={{ marginTop: 16 }}><Icon n="alert" /><p className="small" style={{ margin: 0 }}>{q.caveat}</p></div>}
        <div className="row" style={{ marginTop: 20 }}>
          <a className="btn" href={q.recipientUrl} target="_blank" rel="noreferrer"><Icon n="link" size={18} /> Open the invoice in PayPal<span className="visually-hidden"> (new tab)</span></a>
          <button className="btn" onClick={() => act('remind', `/api/quotes/${q.id}/remind`, {}, 'Reminder sent through PayPal.')} disabled={busy || cancelled || paidFull}>{busy === 'remind' ? <span className="spin" /> : <Icon n="bell" size={18} />} Send a reminder</button>
          <button className="btn" onClick={() => window.print()}>Print this quote</button>
        </div>
        {q.qr && <div className="row" style={{ marginTop: 16, alignItems: 'flex-start' }}><img src={q.qr} alt="QR code that opens this invoice in PayPal" width="120" height="120" style={{ border: '1px solid var(--line)', borderRadius: 6 }} /><p className="small muted" style={{ maxWidth: '38ch' }}>Scan to open the same invoice on a phone. PayPal generated this code for invoice {q.invoiceId}.</p></div>}
      </article>

      {!cancelled && (
        <div style={{ marginTop: 'var(--s6)' }}>
          <Compare amount={q.total} months={months} downPct={down} onMonths={setMonths} onDown={setDown} readOnly={planned} />
        </div>
      )}

      {!cancelled && !planned && (
        <div className="panel tint" style={{ marginTop: 16 }}>
          <div className="eyebrow">Next step</div>
          <p style={{ fontWeight: 600, fontSize: '1.0625rem' }}>{months} payments of {money(preview.monthly)} after a {money(preview.down)} down payment. Total {money(preview.total)}, interest {money(0)}.</p>
          <p className="small muted">PayPal asks the patient to approve the plan once. After that, payments are taken automatically without a browser.</p>
          <button className="btn primary" onClick={() => setConfirm('plan')} disabled={!!busy}>Start the instalment plan <Icon n="arrow" size={18} /></button>
          {actErr && <div className="err" role="alert" style={{ marginTop: 12 }}>{actErr}</div>}
        </div>
      )}

      {planned && (
        <section aria-labelledby="plan-h">
          <h2 className="h2" id="plan-h">The instalment plan</h2>
          <div className="stack">
            {q.subscription?.status === 'APPROVAL_PENDING' && (
              <div className="callout warn"><Icon n="alert" /><div><b>Waiting for the patient to approve the plan in PayPal.</b>
                <p className="small">PayPal requires a person in a browser to approve a new recurring payment once. Everything after that is automatic.</p>
                <a className="btn primary sm" href={q.subscription.approveUrl} target="_blank" rel="noreferrer">Approve in PayPal<span className="visually-hidden"> (new tab)</span></a></div></div>
            )}
            {q.subscription?.status && q.subscription.status !== 'APPROVAL_PENDING' && <Badge tone={q.subscription.status === 'ACTIVE' ? 'ok' : 'neutral'}>Subscription {q.subscription.status.toLowerCase()}</Badge>}

            <div className="sim-banner" role="note"><b>Simulated clock.</b> Renewals, retries and dunning cannot be triggered on demand. The button below records each payment on the invoice itself, standing in for the webhook a real billing cycle would send.</div>

            <div className="sched" aria-label="Payment schedule">
              {q.planTerms.down > 0 && <div className={paidSteps >= 1 ? 'done' : ''}><b>Down payment</b><span className="num">{money(q.planTerms.down)}</span><br /><span className="xs">{paidSteps >= 1 ? 'Recorded' : 'Upcoming'}</span></div>}
              {Array.from({ length: q.planTerms.months }, (_, i) => {
                const idx = (q.planTerms.down > 0 ? 1 : 0) + i; const done = paidSteps > idx;
                return <div key={i} className={done ? 'done' : ''}><b>Payment {i + 1}</b><span className="num">{money(q.planTerms.monthly)}</span><br /><span className="xs">{done ? 'Recorded' : 'Upcoming'}</span></div>;
              })}
            </div>
            <div className="row">
              <button className="btn primary" onClick={() => act('adv', `/api/quotes/${q.id}/advance`, {}, 'One payment recorded on the invoice (simulated).')} disabled={busy || paidSteps >= steps || cancelled}>{busy === 'adv' ? <span className="spin" /> : <Icon n="clock" size={18} />} Record the next payment (simulated)</button>
              <span className="small muted num">Paid {money(q.paid || 0)} of {money(q.total)}. Left to pay {money(q.due ?? q.total)}.</span>
            </div>
            {actErr && <div className="err" role="alert">{actErr}</div>}
          </div>
        </section>
      )}

      <h2 className="h2">Activity</h2>
      <div className="grid2">
        <div className="panel"><h3 className="h3">This quote</h3>
          <ol className="timeline" aria-label="Quote activity">
            {q.events.map((e, i) => <li key={i}><span>{e.what}<time>{dt(e.at)}</time></span></li>)}
          </ol>
        </div>
        <div className="panel"><h3 className="h3">Webhook events received</h3>
          {mine.length ? <ol className="timeline">{mine.slice(0, 8).map((e, i) => <li key={i}><span><span className="mono">{e.type}</span> <Badge tone={e.verified === 'SUCCESS' ? 'ok' : 'risk'}>{e.verified === 'SUCCESS' ? 'signature verified' : 'rejected'}</Badge><time>{dt(e.at)}</time></span></li>)}</ol> : <p className="small muted">None for this quote yet. PayPal sends an event when an invoice is paid or cancelled; each is checked against PayPal's signature before anything changes.</p>}
        </div>
      </div>

      {!cancelled && !paidFull && Number(q.paid) === 0 && <div style={{ marginTop: 24 }}><button className="btn danger sm" onClick={() => setConfirm('cancel')} disabled={!!busy}>Cancel this quote</button>{actErr && <div className="err" role="alert" style={{ marginTop: 8 }}>{actErr}</div>}</div>}
      {!cancelled && !paidFull && Number(q.paid) > 0 && <p className="small muted" style={{ marginTop: 24 }}>Payments are recorded on this quote, so it can no longer be cancelled. To stop further instalments, cancel the subscription in PayPal.</p>}

      {confirm === 'plan' && (
        <Modal title="Start this instalment plan?" onClose={() => setConfirm(null)}>
          <p>This commits the patient to <b className="num">{months} monthly payments of {money(preview.monthly)}</b>{preview.down > 0 && <> after a <b className="num">{money(preview.down)}</b> down payment</>}. Total <b className="num">{money(preview.total)}</b>, with no interest or fees.</p>
          <p className="small muted">Creates a PayPal billing plan and subscription. Nothing is charged until the patient approves it in PayPal.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={!!busy} onClick={() => act('plan', `/api/quotes/${q.id}/plan`, { months, downPct: down }, 'Plan created. Approval is the last step.')}>{busy === 'plan' ? <><span className="spin" /> Creating the plan</> : 'Start the plan'}</button>
            <button className="btn" onClick={() => setConfirm(null)}>Go back</button>
          </div>
        </Modal>
      )}
      {confirm === 'cancel' && (
        <Modal title="Cancel this quote?" onClose={() => setConfirm(null)}>
          <p>The PayPal invoice is cancelled{planned ? ' and the subscription is cancelled with it' : ''}. This cannot be undone; a new quote would need to be issued.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn danger" disabled={!!busy} onClick={() => act('cancel', `/api/quotes/${q.id}/cancel`, {}, 'Quote cancelled.')}>{busy === 'cancel' ? <span className="spin" /> : null} Cancel the quote</button>
            <button className="btn" onClick={() => setConfirm(null)}>Keep the quote</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
