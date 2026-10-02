import { useEffect, useState } from 'react';
import { Icon, Badge } from './ui.jsx';
import { CardRow } from './Home.jsx';
import { get, savedIds, money, dt, statusWord, statusTone } from './util.js';

export function Quotes() {
  const [qs, setQs] = useState(null);
  useEffect(() => {
    const ids = savedIds();
    Promise.all(ids.map((id) => get(`/api/quotes/${id}`).catch(() => null))).then((r) => setQs(r.filter(Boolean)));
  }, []);
  return (
    <div className="wrap">
      <h1 className="page-title" style={{ textAlign: 'left' }}>Saved quotes</h1>
      {qs === null && <div className="skeleton" style={{ height: 120 }} aria-busy="true" />}
      {qs && !qs.length && (
        <div className="empty"><p style={{ fontWeight: 600 }}>No quotes yet.</p><p className="muted small">Quotes issued in this browser appear here, with their live PayPal status. Start by describing an operation.</p><a className="btn primary" href="#/">Describe an operation</a></div>
      )}
      {qs && qs.length > 0 && (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Quote</th><th>Hospital and procedure</th><th className="r">Total</th><th>Status</th><th>Issued</th></tr></thead>
          <tbody>{qs.map((q) => (
            <tr key={q.id}><td><a href={`#/quote/${q.id}`} className="mono">{q.invoiceNumber}</a></td><td>{q.hospital}<div className="muted xs">{q.procedure?.description}</div></td><td className="r num">{money(q.total)}</td><td><Badge tone={statusTone(q.status)}>{statusWord(q.status)}</Badge>{q.planTerms && <div className="xs muted" style={{ marginTop: 4 }}>{q.schedule?.paid || 0} of {(q.planTerms.down > 0 ? 1 : 0) + q.planTerms.months} payments recorded</div>}</td><td className="num">{dt(q.createdAt)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function Files({ catalog }) {
  return (
    <div className="wrap">
      <h1 className="page-title" style={{ textAlign: 'left' }}>Price files read</h1>
      <p className="muted" style={{ maxWidth: '62ch' }}>Each file is the hospital's own public download. The layouts differ so much that no single parser handles them; the agent finds the header, the code columns and the price columns for each one.</p>
      <div className="stack" style={{ marginTop: 24 }}>
        {Object.entries(catalog.hospitals).map(([id, h]) => (
          <div className="panel" key={id}>
            <div className="row between"><h2 className="h3" style={{ fontSize: '1.125rem', margin: 0 }}>{h.name} <span className="muted" style={{ fontWeight: 400 }}>· {h.city}</span></h2><span className="num small muted">{h.sizeMB} MB</span></div>
            <p className="small" style={{ margin: '8px 0' }}><b>Layout:</b> {h.format}</p>
            <p className="small muted">{h.mess}</p>
            <CardRow items={catalog.items.filter((i) => i.hospital === id)} />
            <p className="xs muted" style={{ marginTop: 12, marginBottom: 0, overflowWrap: 'anywhere' }}><a href={h.url} target="_blank" rel="noreferrer">{h.url}<span className="visually-hidden"> (new tab)</span></a></p>
          </div>
        ))}
      </div>
    </div>
  );
}

const Fact = ({ n, children, cite, trap }) => (<div className={`fact ${trap ? 'trap' : ''}`}><div className="n num">{n}</div><p className="small" style={{ margin: '6px 0 0' }}>{children}</p><div className="src">{cite}</div></div>);

export function Evidence() {
  return (
    <div className="wrap">
      <h1 className="page-title" style={{ textAlign: 'left' }}>Why a quote needs an agent</h1>
      <p className="muted" style={{ maxWidth: '64ch' }}>Hospitals must publish their prices. Many publish files that contain none. Meanwhile some want money before an elective procedure, and the financing on offer is often a medical credit card. Every figure below is quoted from the source named under it.</p>

      <h2 className="h2">What surgery does to household finances</h2>
      <div className="facts">
        <Fact n="+5.4 points" cite="JAMA Surg 2026;161(1):59-66, PMID 41259019. MEPS 2014-2021, weighted n = 40 million surgical patients matched to non-surgical controls.">Financial hardship caused by surgery, in the year after it (95% CI 1.8 to 9.0). A 16% relative rise over matched patients who did not have surgery.</Fact>
        <Fact n="37.9%" trap cite="Same study.">of surgical patients reported financial hardship in the year after surgery. <b>This is the level, not the effect of surgery.</b> Compared with matched patients who did not have surgery, the part surgery itself caused is the 5.4 points.</Fact>
        <Fact n="+23.7 points" cite="Same study, by payer.">Increase in hardship for uninsured patients. Privately insured: +8.4 points. Medicaid: no significant change. Family out-of-pocket spending rose by $708.</Fact>
      </div>

      <h2 className="h2">The mechanism: pay first, finance second</h2>
      <div className="facts">
        <Fact n="about 43%" cite="Randall et al., Health Aff Sch 2024, PMID 38808329. Random 10% sample of US hospitals phoned Jun to Nov 2023; 204 usable responses.">of hospitals require cost-sharing before an elective procedure: 20.1% always and 22.5% sometimes. The 43% is added up here (87 of 204); the authors report the two components.</Fact>
        <Fact n="22 and 16" cite="Same study.">22 hospitals wanted payment before the procedure, often about 50% of estimated cost-sharing. 16 required a down payment of up to 50% before allowing instalments.</Fact>
        <Fact n="20.5%" cite="Same study.">of third-party financing plans (offered by 19.1% of hospitals) charged interest or fees. 97% of hospitals offered payment plans of some kind.</Fact>
        <Fact n="26.99% APR" cite="Bruch et al., JAMA Health Forum 2025, PMID 40215074.">is the average rate on medical credit cards. They are accepted at 8.7% of orthopaedic surgery locations. CareCredit is accepted at 42% of academic plastic-surgery practices (Ann Surg Open 2026, PMID 42344451).</Fact>
        <Fact n="22.4% vs 3.4%" cite="Urology 2025, PMID 40602468. Self-reported, volunteer sample of 945 kidney-stone patients.">of patients with financial toxicity deferred recommended surgery, against patients without it.</Fact>
      </div>

      <h2 className="h2">The gap: the law exists, the usable price does not</h2>
      <div className="facts">
        <Fact n="29 penalties" cite="CMS, Hospital Price Transparency Enforcement Activities, data to 31 Jul 2026.">in 13,355 actions: 3,646 warning notices, 2,107 corrective action plan requests, and 29 civil monetary penalty notices across 28 hospitals. Fewer than 0.5% of hospitals have been fined. Largest: Northside Atlanta $883,180, Jackson Memorial $871,122, Community First $847,740.</Fact>
        <Fact n="$300 to $5,500" cite="45 CFR Part 180.90.">per day under the rule, with a ceiling of about $2.0 million a year.</Fact>
        <Fact n="56% and 6%" cite="Mead and Ibrahim, Health Aff Sch 2024, PMID 39220579.">56% of hospitals offering shoppable services reported no prices; only 6% were fully concordant.</Fact>
        <Fact n="42.7%" cite="Neurosurgery 2024, PMID 38345364.">In neurosurgery, 96.5% of hospitals had the machine-readable file but only 42.7% reported any negotiated price. Among top orthopaedic hospitals, 38 to 39% were fully compliant (PMID 38735409).</Fact>
      </div>

      <h2 className="h2">Other measured burdens</h2>
      <div className="facts">
        <Fact n="30.7%" cite="J Surg Res 2026, PMID 42600426.">of emergency surgery patients reported financial hardship; 12.7% had catastrophic expenditure.</Fact>
        <Fact n="21.9%" cite="J Surg Res 2026, PMID 42469109.">of inpatient surgery patients over 65 reported financial toxicity; mean out-of-pocket $2,395.</Fact>
        <Fact n="9.1%" cite="JACS 2026, PMID 42775827. Michigan, n = 4,216, linked credit reports.">of emergency general surgery patients had more medical debt in collections at 12 months, a mean increase of $1,764. Uninsured 29.5% against 7.3% for privately insured.</Fact>
      </div>
      <p className="small muted" style={{ marginTop: 24 }}>Where the evidence is mixed, nothing here claims more than the sources do. Cost-related deferral figures are self-reported; the research on high-deductible plans delaying surgery points both ways.</p>
    </div>
  );
}

export function How() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <h1 className="page-title" style={{ textAlign: 'left' }}>How it works, and what it does not do</h1>
      <div className="stack">
        <div className="panel">
          <h2 className="h3">1. The agent reads the file</h2>
          <p className="small" style={{ marginBottom: 8 }}>A Claude model on AWS Bedrock runs a loop of tool calls:</p>
          <ol className="small" style={{ paddingLeft: 20, margin: '0 0 12px' }}>
            <li>Match the description to a billing code</li>
            <li>Stream the hospital's file</li>
            <li>Pull payer amounts</li>
            <li>Compute the patient's share</li>
            <li>Check the plan against take-home pay</li>
          </ol>
          <p className="small" style={{ marginBottom: 8 }}>If the description is too vague, it asks one question.</p>
          <p className="small" style={{ margin: 0 }}>Files up to 400 MB are streamed, never loaded whole. Zip archives are unpacked on the fly.</p>
        </div>
        <div className="panel">
          <h2 className="h3">2. Every figure is checked against its cell</h2>
          <ol className="small" style={{ paddingLeft: 20, margin: '0 0 12px' }}>
            <li>The model must cite the row and column for each number.</li>
            <li>Code compares each figure with that cell and deletes any that does not match.</li>
            <li><b>The model never does arithmetic.</b> Code does.</li>
          </ol>
          <p className="small" style={{ margin: 0 }}>When the model once added two rows together, the check removed the invented total.</p>
        </div>
        <div className="panel">
          <h2 className="h3">3. A quote is issued only when the file supports one</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Route</th><th>What the file must hold</th></tr></thead>
            <tbody>
              <tr><td style={{ whiteSpace: "nowrap" }}>Self-pay</td><td>A price for the whole facility side of the procedure</td></tr>
              <tr><td style={{ whiteSpace: "nowrap" }}>Insured</td><td>The plan's published amount, plus the patient's own deductible, coinsurance and out-of-pocket limit</td></tr>
            </tbody>
          </table></div>
          <p className="small" style={{ margin: '12px 0 0' }}>Otherwise no quote is issued, and the page says why.</p>
        </div>
        <div className="panel">
          <h2 className="h3">4. PayPal does the money part</h2>
          <div className="tbl-wrap"><table>
            <thead><tr><th>PayPal product</th><th>Used for</th></tr></thead>
            <tbody>
              <tr><td>Invoicing</td><td>The quote: built from a template, itemised lines, partial payment, QR code, scheduled reminders</td></tr>
              <tr><td>Billing plans and subscriptions</td><td>The instalment plan</td></tr>
              <tr><td>Webhooks</td><td>Paid and cancelled events, signature-checked before anything changes</td></tr>
            </tbody>
          </table></div>
          <p className="small" style={{ margin: '12px 0 0' }}>A repeated request cannot create two invoices.</p>
        </div>
        <div className="panel"><h2 className="h3">Limits that matter</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li><b>Simulated clock.</b> The “record the next payment” button stands in for each billing cycle.</li>
            <li><b>The hospital is not a party to these invoices.</b></li>
            <li><b>Facility charges only.</b> Surgeon, anaesthesia and implant fees are usually outside these files and are listed as not included.</li>
            <li><b>Approval needs a person.</b> PayPal requires one human approval for a new recurring payment; an agent cannot do that step.</li>
            <li><b>File age varies.</b> Two of the four files are from 2020 and 2021; the confidence label says so.</li>
          </ul></div>
      </div>
    </div>
  );
}
