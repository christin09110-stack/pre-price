import { useEffect, useMemo, useState } from 'react';
import { Icon, Badge } from './ui.jsx';
import { get, post, money, mb, rateKey, saveId } from './util.js';

const CONF = { high: { tone: 'ok', word: 'High confidence in this finding' }, medium: { tone: 'warn', word: 'Medium confidence in this finding' }, low: { tone: 'risk', word: 'Low confidence in this finding' } };

const plain = (t = '') => t.replace(/\b[Rr]ows? [A-Z]?\.?[rk]\d+(?:\s*(?:and|[–-])\s*[rk]?\d+)*/g, 'The matching row').replace(/The matching row (shows|contains|is)/, 'The matching row $1');
const sentence = (t = '') => (t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t);

function statusFor(ex) {
  const s = ex.quote?.scope;
  if (s === 'facility_total' && ex.quote?.amount != null) return { tone: 'ok', icon: 'check', word: 'Usable self-pay price' };
  if (s === 'facility_total') return { tone: 'warn', icon: 'alert', word: 'Plan-specific estimates only' };
  if (s === 'component_only') return { tone: 'risk', icon: 'x', word: 'Component fees only, no whole-procedure price' };
  return { tone: 'risk', icon: 'x', word: 'No defensible price in this file' };
}

function Excerpt({ ex }) {
  const hits = useMemo(() => {
    const m = new Set();
    const add = (f) => f && m.add(`${f.row_id}|${f.field}`);
    [ex.self_pay_price, ex.gross_charge, ex.min_rate, ex.max_rate].forEach(add);
    (ex.negotiated_rates || []).forEach(add);
    if (ex.quote?.grounded) m.add(`${ex.quote.amount_row_id}|${ex.quote.amount_field}`);
    return m;
  }, [ex]);
  const rows = (ex.rows || []).slice(0, 14);
  if (!rows.length) return <p className="muted small">The stored rows are not loaded for this result.</p>;
  return (
    <div className="stack">
      {rows.map((r) => (
        <div key={r.id} className="tbl-wrap">
          <table className="excerpt">
            <caption style={{ textAlign: 'left', padding: '8px 10px', fontFamily: 'var(--sans)', fontWeight: 600, fontSize: '.8125rem' }}>
              Row {r.id} · line {r.line?.toLocaleString()} of the file · {r.kind === 'code_match' ? 'carries the code' : 'description match'}
            </caption>
            <tbody>
              {Object.entries(r.cells).slice(0, 18).map(([k, v]) => (
                <tr key={k}><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--mono)' }}>{k}</th><td className={hits.has(`${r.id}|${k}`) ? 'cell-hit' : ''}>{v}{hits.has(`${r.id}|${k}`) ? <span className="visually-hidden"> (figure verified against this cell)</span> : null}</td></tr>
              ))}
              {Object.keys(r.cells).length > 18 && <tr><td colSpan="2" className="muted">and {Object.keys(r.cells).length - 18} more non-blank cells</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
      {ex.rows.length > 14 && <p className="small muted">Showing 14 of {ex.rows.length} kept rows.</p>}
    </div>
  );
}

export default function Read({ id, nav, toast }) {
  const [ex, setEx] = useState(() => { try { const s = sessionStorage.getItem(`ex-${id}`); return s ? JSON.parse(s) : null; } catch { return null; } });
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (ex?.id === id && ex.rows) return;
    let ok = true; setEx(null); setErr(null);
    get(`/api/extractions/${id}`).then((e) => ok && setEx(e)).catch((e) => ok && setErr(e.message));
    return () => { ok = false; };
  }, [id]); // eslint-disable-line

  if (err) return <div className="wrap"><div className="callout risk" role="alert"><Icon n="alert" /><div><b>This result could not be loaded.</b><p className="small">{err} Open a stored result from the home page, or run the agent again.</p><a className="btn" href="#/">Back to home</a></div></div></div>;
  if (!ex) return <div className="wrap" aria-busy="true"><div className="skeleton" style={{ height: 40, width: '60%', marginBottom: 16 }} /><div className="skeleton" style={{ height: 220 }} /></div>;

  const st = statusFor(ex);
  const cd = ex.confidenceDetail || { level: ex.confidence || 'medium', reasons: [] };
  const conf = CONF[cd.level] || CONF.medium;
  const g = ex.grounding || { checked: 0, verified: 0, removed: [] };
  const info = ex.hospitalInfo;
  const canSelf = ex.quote?.scope === 'facility_total' && ex.quote?.amount != null && ex.quote?.grounded;
  const canInsured = ex.quote?.scope === 'facility_total' && (ex.negotiated_rates || []).length > 0;

  return (
    <div className="wrap">
      <a href="#/" className="small">← All files</a>
      <div className="row between" style={{ margin: '8px 0 var(--s5)' }}>
        <div>
          <div className="eyebrow">{ex.hospital} · {ex.procedure?.code_system} {ex.procedure?.code}{ex.live ? ' · live run' : ''}</div>
          <h1 className="serif" style={{ fontSize: 'clamp(1.75rem,1.2rem + 2vw,2.5rem)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-.015em' }}>{ex.seed?.label || sentence(ex.procedure?.description || ex.procedureLabel)}</h1>
        </div>
        <Badge tone={st.tone} icon={st.icon}>{st.word}</Badge>
      </div>

      <div className={`panel ${canSelf ? 'tint' : ''}`}>
        {canSelf && (
          <>
            <div className="eyebrow">Self-pay price in the hospital's file</div>
            <div className="serif num" style={{ fontSize: 'clamp(2.5rem,1.6rem + 4vw,4rem)', fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1 }}>{ex.quote.cell}</div>
            <p style={{ marginTop: 12 }}>{plain(ex.quote.basis)}</p>
                      </>
        )}
        {!canSelf && canInsured && (
          <>
            <div className="eyebrow">No self-pay price. Plan-specific amounts only</div>
            <div className="serif num" style={{ fontSize: 'clamp(1.75rem,1.2rem + 2.4vw,2.5rem)', fontWeight: 700, lineHeight: 1.1 }}>
              {ex.min_rate ? money(ex.min_rate.value) : '?'} to {ex.max_rate ? money(ex.max_rate.value) : '?'}
            </div>
            <p style={{ marginTop: 12 }}>The file lists what the hospital expects each insurer to allow, not a single price. A patient's share depends on that insurer and on their own deductible and coinsurance.</p>
          </>
        )}
        {!canSelf && !canInsured && (
          <div className="callout risk" style={{ background: 'transparent', border: 0, padding: 0 }}>
            <Icon n="x" size={22} />
            <div>
              <h2 className="h3" style={{ fontSize: '1.25rem' }}>No price can be quoted from this file</h2>
              <p>{plain(ex.quote?.basis) || 'The file does not contain a usable price for this procedure.'}</p>
              <p className="small" style={{ margin: 0 }}><b>What the person can do:</b> ask the hospital for a written good-faith estimate for the full procedure, including surgeon, anaesthesia and implants. Anyone who is uninsured or paying themselves is entitled to one when scheduling a service. Another hospital's file may hold a price; run the agent on it from the home page.</p>
            </div>
          </div>
        )}
      </div>

      <p className="trust">
        <Badge tone={conf.tone}>{conf.word}</Badge>
        <span>Read from {info?.name || ex.hospital}'s published file; {g.verified} of {g.checked} figures checked against the cells they came from{g.removed.length ? `, and ${g.removed.length} the model reported could not be verified, so none was used` : ''}.</span>
      </p>

      {(canSelf || canInsured) && ex.not_in_file?.length > 0 && (
        <>
          <h2 className="h2">What this price does not cover</h2>
          <div className="panel">
            <p className="small muted" style={{ marginTop: 0 }}>These are not in the hospital's file, so they usually arrive as separate bills.</p>
            <ul style={{ paddingLeft: 18, margin: 0, columns: 'auto 260px', columnGap: 32 }}>{ex.not_in_file.map((x) => <li key={x} style={{ breakInside: 'avoid', marginBottom: 4 }}>{x}</li>)}</ul>
          </div>
        </>
      )}

      <details style={{ marginTop: 24 }}>
        <summary>See how this was read</summary>
        <div className="stack">
          <div className="grid2">
            <div>
              <h3 className="h3">Why this confidence</h3>
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{cd.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              {g.removed.length > 0 && <><h3 className="h3" style={{ marginTop: 16 }}>Figures that could not be verified, so were not used</h3><ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{g.removed.slice(0, 4).map((x) => <li key={x}>{x}</li>)}</ul></>}
              {ex.problems?.length > 0 && <><h3 className="h3" style={{ marginTop: 16 }}>Problems in the data</h3><ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{ex.problems.map((x) => <li key={x}>{x}</li>)}</ul></>}
              {!(canSelf || canInsured) && ex.not_in_file?.length > 0 && <><h3 className="h3" style={{ marginTop: 16 }}>Not in this file</h3><ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{ex.not_in_file.map((x) => <li key={x}>{x}</li>)}</ul></>}
            </div>
            <div>
              <h3 className="h3">The file</h3>
              <dl className="kv" style={{ fontSize: '.875rem' }}>
                <dt>Hospital</dt><dd style={{ fontWeight: 500 }}>{info?.name || ex.hospital}</dd>
                <dt>Layout</dt><dd style={{ fontWeight: 500, textAlign: 'right' }}>{info?.format}</dd>
                {ex.scan && <><dt>Read</dt><dd className="num">{ex.scan.records.toLocaleString()} rows, {mb(ex.scan.bytes)} MB</dd></>}
                <dt>Rows kept</dt><dd className="num">{ex.scan?.rowsKept ?? ex.rows?.length}</dd>
                <dt>Figures verified</dt><dd className="num">{g.verified} of {g.checked}</dd>
                {canSelf && <><dt>Price cell</dt><dd style={{ fontWeight: 500 }}>{ex.quote.amount_field}, line {ex.quote.line?.toLocaleString()}</dd></>}
              </dl>
              {info?.url && <p className="small" style={{ margin: '12px 0 0', overflowWrap: 'anywhere' }}><a href={info.url} target="_blank" rel="noreferrer">Open the hospital's file<span className="visually-hidden"> (new tab)</span></a></p>}
            </div>
          </div>
          {ex.trace?.length > 0 && (
            <div><h3 className="h3">Steps the agent took</h3><ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {ex.trace.filter((t) => t.kind === 'tool').map((t, i) => <li key={i}><span className="mono">{t.name}</span>{t.summary ? <>: {t.summary}</> : null}</li>)}
            </ol></div>
          )}
          <div><h3 className="h3">Rows from the file ({ex.rows?.length || 0}). Highlighted cells are the figures above.</h3><Excerpt ex={ex} /></div>
        </div>
      </details>

      {(canSelf || canInsured) && <QuoteForm ex={ex} canSelf={canSelf} canInsured={canInsured} nav={nav} toast={toast} />}
    </div>
  );
}

function QuoteForm({ ex, canSelf, canInsured, nav, toast }) {
  const [coverage, setCoverage] = useState(canSelf ? 'self_pay' : 'insured');
  const [rate, setRate] = useState('');
  const [ded, setDed] = useState('2000');
  const [coins, setCoins] = useState('20');
  const [oop, setOop] = useState('3500');
  const [given, setGiven] = useState('Maya');
  const [surname, setSurname] = useState('Okafor');
  const [email, setEmail] = useState('maya.okafor@example.com');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [key] = useState(() => `ui-${crypto.randomUUID()}`);
  const rates = ex.negotiated_rates || [];
  const bad = !given.trim() || !surname.trim() || !/^\S+@\S+\.\S+$/.test(email);

  async function submit(e) {
    e.preventDefault(); setErr(null); setRefusal(null);
    if (bad) { setErr('Enter the patient\'s first name, last name and a valid email so the invoice has a recipient.'); return; }
    if (coverage === 'insured' && !rate) { setErr('Choose the insurance plan from the amounts the hospital published.'); return; }
    setBusy(true);
    try {
      const r = await post('/api/quotes', { extractionId: ex.id, coverage, rateKey: rate, deductibleRemaining: +ded, coinsurancePct: +coins, oopRemaining: +oop, patient: { given, surname, email }, idempotencyKey: key });
      if (!r.issued) { setRefusal(r.reason); return; }
      saveId(r.quote.id); nav(`/quote/${r.quote.id}`);
    } catch (e2) { setErr(`${e2.message} Check the details and try again.`); toast?.(); } finally { setBusy(false); }
  }

  return (
    <>
      <h2 className="h2">Turn it into a binding quote</h2>
      <form className="panel stack" onSubmit={submit} noValidate>
        <div className="field">
          <span className="lab" id="cov-l">How will the patient pay?</span>
          <div className="seg" role="radiogroup" aria-labelledby="cov-l">
            <label><input type="radio" name="cov" checked={coverage === 'self_pay'} onChange={() => setCoverage('self_pay')} disabled={!canSelf} /><span>Self-pay</span></label>
            <label><input type="radio" name="cov" checked={coverage === 'insured'} onChange={() => setCoverage('insured')} disabled={!canInsured} /><span>Insured</span></label>
          </div>
          {!canSelf && <span className="hint">This file has no self-pay price for the procedure, so only the insured route is open.</span>}
          {!canInsured && <span className="hint">This file lists no plan-specific amounts, so only the self-pay route is open.</span>}
        </div>
        {coverage === 'insured' && (
          <div className="stack">
            <div className="field">
              <label htmlFor="plan">Insurance plan</label>
              <select id="plan" className="select" value={rate} onChange={(e) => setRate(e.target.value)}>
                <option value="">Choose a plan</option>
                {rates.map((r) => <option key={rateKey(r)} value={rateKey(r)}>{r.payer}{r.plan ? ` · ${r.plan}` : ''} · {money(r.value)}</option>)}
              </select>
              <span className="hint">The amount is what the hospital's file says the plan allows{rates.some((r) => r.kind === 'estimated_allowed_amount') ? ' (the hospital\'s own estimate)' : ''}. The patient owes only their share of it.</span>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="ded">Deductible still to meet ($)</label><input id="ded" className="input num" inputMode="decimal" value={ded} onChange={(e) => setDed(e.target.value)} /></div>
              <div className="field"><label htmlFor="coins">Coinsurance after deductible (%)</label><input id="coins" className="input num" inputMode="decimal" value={coins} onChange={(e) => setCoins(e.target.value)} /></div>
              <div className="field"><label htmlFor="oop">Out-of-pocket maximum still to meet ($)</label><input id="oop" className="input num" inputMode="decimal" value={oop} onChange={(e) => setOop(e.target.value)} /><span className="hint">The patient's share never exceeds this.</span></div>
            </div>
          </div>
        )}
        <div className="grid2">
          <div className="field"><label htmlFor="gn">Patient first name</label><input id="gn" className="input" value={given} onChange={(e) => setGiven(e.target.value)} autoComplete="given-name" /></div>
          <div className="field"><label htmlFor="sn">Patient last name</label><input id="sn" className="input" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="family-name" /></div>
        </div>
        <div className="field"><label htmlFor="em">Email for the invoice</label><input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={err && !/^\S+@\S+\.\S+$/.test(email) ? 'true' : undefined} /></div>
        {refusal && <div className="callout risk" role="alert"><Icon n="x" /><div><b>No quote was issued.</b><p className="small" style={{ margin: 0 }}>{refusal}</p></div></div>}
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row"><button className="btn primary" type="submit" disabled={busy}>{busy ? <><span className="spin" /> Issuing the quote</> : <>Issue the binding quote <Icon n="arrow" size={18} /></>}</button><span className="small muted">Creates and sends a PayPal invoice with itemised lines.</span></div>
      </form>
    </>
  );
}
