import { useRef, useState } from 'react';
import { Icon, Badge, Progress } from './ui.jsx';
import { streamAgent, mb, savedIds } from './util.js';

const ICONS = { 'mclaren-29881': 'knee', 'jhh-470': 'knee', 'brookings-27447': 'knee', 'wentworth-470': 'knee', 'mclaren-47562': 'gall', 'brookings-47562': 'gall' };
const TOOL_WORDS = { list_price_files: 'Listed available price files', resolve_procedure_code: 'Matched the description to a billing code', search_price_file: 'Streamed the hospital file', get_payer_rates: 'Pulled payer amounts', compute_patient_share: 'Computed the patient share', check_affordability: 'Checked the plan against take-home pay', ask_user: 'Needs one answer', record_extraction: 'Recorded the finding' };

export function CardRow({ items, go }) {
  return (
    <div className="cards">
      {items.map((it) => (
        <a key={it.id} className="card-link" href={`#/read/${it.id}`} onClick={() => go?.()}>
          <span className="sq"><Icon n={ICONS[it.id] || 'doc'} /></span>
          <span><b>{it.short}</b><small>{it.extraction.hospital} · {it.codeLabel}</small>{it.hospital === 'wentworth' && <em className="filetag">402 MB file, streamed</em>}</span>
        </a>
      ))}
    </div>
  );
}

export default function Home({ catalog, nav, askRef }) {
  const [text, setText] = useState('');
  const [hospital, setHospital] = useState('mclaren');
  const [run, setRun] = useState(null); // {progress, steps, question, error, busy}
  const [history, setHistory] = useState([]);
  const [answer, setAnswer] = useState('');
  const abort = useRef(null);
  const hosp = catalog.hospitals[hospital];
  const quotes = savedIds();

  async function start(message, hist) {
    if (!message.trim()) { setRun({ error: 'Describe the operation first, in your own words. For example: knee arthroscopy for a torn meniscus.' }); return; }
    abort.current?.abort(); abort.current = new AbortController();
    setRun({ busy: true, steps: [], progress: { bytes: 0, totalBytes: hosp.sizeMB * 1e6 } });
    try {
      const r = await streamAgent({ message, hospitalId: hospital, history: hist }, {
        signal: abort.current.signal,
        onProgress: (p) => setRun((s) => ({ ...s, progress: { bytes: p.bytes, totalBytes: p.totalBytes || hosp.sizeMB * 1e6 } })),
        onStep: (st) => setRun((s) => ({ ...s, steps: [...(s.steps || []), st] })),
      });
      if (r.status === 'needs_input') {
        setHistory([...hist, { role: 'patient', text: message }, { role: 'agent', text: r.question }]);
        setRun((s) => ({ ...s, busy: false, question: r }));
        setAnswer('');
      } else {
        const id = r.extraction.id; sessionStorage.setItem(`ex-${id}`, JSON.stringify(r.extraction));
        nav(`/read/${id}`);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      setRun((s) => ({ ...s, busy: false, error: `${e.message} Pick one of the stored results below, or run it again.` }));
    }
  }

  const prog = run?.progress;
  return (
    <div className="wrap">
      <h1 className="page-title">What operation have you been quoted for?</h1>
      <p className="page-sub">Every figure is traced to a cell in the hospital's own published price file. The model is not allowed to do arithmetic, and a number it cannot cite is deleted before you see it.</p>

      <form className="ask" onSubmit={(e) => { e.preventDefault(); start(text, []); }} aria-busy={!!run?.busy}>
        <div className="ask-head"><span className="chip"><Icon n="search" size={14} /> Price-file agent</span><span className="muted small">Reads the hospital's own published file</span></div>
        <label htmlFor="op" className="visually-hidden">Describe the operation</label>
        {/* An empty box asks a patient to guess what the hospital calls their operation.
            These are the three the files cover, in the words someone would actually use. */}
        <div className="try">
          <span className="try-lab">Try one</span>
          {[['A torn meniscus in my knee, keyhole surgery', 'Knee, keyhole'],
            ['Full knee replacement, staying overnight', 'Knee replacement'],
            ['Gallbladder out, keyhole surgery', 'Gallbladder']].map(([q, label]) => (
            <button key={label} type="button" className="try-chip" disabled={!!run?.busy}
              onClick={() => { setText(q); askRef.current?.focus(); }}>{label}</button>
          ))}
        </div>
        <textarea id="op" ref={askRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the operation in plain words, for example: knee arthroscopy for a torn meniscus, or gallbladder removal." disabled={!!run?.busy} />
        <div className="ask-foot">
          <fieldset className="hosp-pick">
            <legend>Hospital file to read</legend>
            {Object.entries(catalog.hospitals).map(([id, h]) => (
              <label key={id} className="radio-chip"><input type="radio" name="hosp" value={id} checked={hospital === id} onChange={() => setHospital(id)} disabled={!!run?.busy} /><span>{h.name}</span></label>
            ))}
          </fieldset>
          <button className="btn primary" type="submit" disabled={!!run?.busy}>{run?.busy ? <><span className="spin" /> Reading the file</> : <>Find the price <Icon n="arrow" size={18} /></>}</button>
        </div>
      </form>
      <p className="fine">The agent can be wrong. It quotes only a figure it can point to in a cell of the file, and states plainly when the file holds no price.</p>

      {run?.error && <div className="callout risk" role="alert" style={{ maxWidth: 760, margin: '16px auto 0' }}><Icon n="alert" /><div><b>Could not finish.</b><p className="small" style={{ margin: 0 }}>{run.error}</p></div></div>}

      {run?.busy && (
        <div className="panel" style={{ maxWidth: 760, margin: '16px auto 0' }} role="status" aria-live="polite">
          <div className="row between small" style={{ marginBottom: 8 }}>
            <b>Reading {hosp.name}'s file</b>
            <span className="num muted">{mb(prog.bytes)} of {prog.totalBytes ? mb(prog.totalBytes) : hosp.sizeMB} MB</span>
          </div>
          <Progress value={prog.bytes} max={prog.totalBytes || hosp.sizeMB * 1e6} label="Price file download progress" />
          <ul className="steps">
            {(run.steps || []).map((s, i) => (
              <li key={i}><Icon n={s.kind === 'tool' ? 'check' : 'info'} size={16} /><span>{s.kind === 'tool' ? (TOOL_WORDS[s.name] || s.name) : s.text}{s.kind === 'tool' && s.summary ? <span className="muted">: {s.summary}</span> : null}</span><span className="tool">{s.kind === 'tool' ? s.name : ''}</span></li>
            ))}
            <li><span className="spin" style={{ width: 14, height: 14 }} /><span className="muted">Working. A large file can take a minute or two.</span><span /></li>
          </ul>
        </div>
      )}

      {run?.question && !run.busy && (
        <div className="panel tint" style={{ maxWidth: 760, margin: '16px auto 0' }}>
          <div className="eyebrow">One question before the file is read</div>
          <h2 className="h3" style={{ fontSize: '1.125rem' }}>{run.question.question}</h2>
          <div className="row" style={{ margin: '12px 0' }}>
            {(run.question.options || []).map((o) => <button key={o} className="btn" type="button" onClick={() => start(o, history)}>{o}</button>)}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) start(answer, history); }}>
            <label className="visually-hidden" htmlFor="ans">Your own answer</label>
            <input id="ans" className="input" style={{ flex: 1, minWidth: 200 }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type your own answer" />
            <button className="btn primary" type="submit" disabled={!answer.trim()}>Answer</button>
          </form>
        </div>
      )}

      <h2 className="h2">Files already read</h2>
      <p className="muted small" style={{ marginTop: -8 }}>Six results from four hospitals' real files. Open one to see what the agent found, including the ones where the file holds no usable price.</p>
      <CardRow items={catalog.items} />

      <h2 className="h2">Latest</h2>
      {quotes.length ? (
        <div className="panel tint">
          <div className="eyebrow">Your most recent quote</div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Quote and instalment plan saved in this browser.</p>
          <a className="btn primary" href={`#/quote/${quotes[0]}`}>Open the quote <Icon n="arrow" size={18} /></a>
        </div>
      ) : (
        <div className="panel tint">
          <div className="row" style={{ marginBottom: 6 }}><Badge tone="ok" icon="check">Verified price</Badge><span className="muted small">McLaren Flint · CPT 29881</span></div>
          <p style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: 6 }}>Knee arthroscopy: {catalog.items[0].extraction.quote.cell} self-pay, read from line {catalog.items[0].extraction.quote.line?.toLocaleString()} of the hospital's file.</p>
          <p className="small muted">Open it to turn the figure into a binding PayPal invoice and a 0% plan.</p>
          <a className="btn primary" href={`#/read/${catalog.items[0].id}`}>Open this result <Icon n="arrow" size={18} /></a>
        </div>
      )}
    </div>
  );
}
