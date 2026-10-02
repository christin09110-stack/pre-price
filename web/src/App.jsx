import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Toast } from './ui.jsx';
import Home from './Home.jsx';
import Read from './Read.jsx';
import QuotePage from './QuotePage.jsx';
import { Quotes, Files, Evidence, How } from './Pages.jsx';
import bundled from './catalog.json';
import { get } from './util.js';

const useRoute = () => {
  const [h, setH] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => { const f = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
};

export default function App() {
  const route = useRoute();
  const [catalog, setCatalog] = useState(bundled);
  const [open, setOpen] = useState(false);
  const [toastMsg, setToast] = useState('');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('pp-theme') || 'light'; } catch { return 'light'; } });
  const askRef = useRef(null); const searchRef = useRef(null);
  const nav = useCallback((p) => { location.hash = p; }, []);
  const toast = useCallback((m) => { setToast(m || ''); if (m) setTimeout(() => setToast(''), 3800); }, []);

  useEffect(() => { get('/api/catalog').then((c) => setCatalog((prev) => ({ ...prev, hospitals: c.hospitals, items: c.items }))).catch(() => {}); }, [route]);
  useEffect(() => { setOpen(false); }, [route]);
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name=color-scheme]')?.setAttribute('content', dark ? 'dark' : 'light');
  }, [theme]);
  const flip = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const nxt = isDark ? 'light' : 'dark'; setTheme(nxt); try { localStorage.setItem('pp-theme', nxt); } catch { /* ignore */ }
  };

  const [seg, a, b] = route.split('/').filter(Boolean);
  let page;
  if (!seg) page = <Home catalog={catalog} nav={nav} askRef={askRef} />;
  else if (seg === 'read') page = <Read id={a} nav={nav} toast={toast} key={a} />;
  else if (seg === 'quote') page = <QuotePage id={a} toast={toast} key={a} />;
  else if (seg === 'quotes') page = <Quotes />;
  else if (seg === 'files') page = <Files catalog={catalog} />;
  else if (seg === 'evidence') page = <Evidence />;
  else if (seg === 'how') page = <How />;
  else page = <div className="wrap"><div className="empty"><p style={{ fontWeight: 600 }}>That page does not exist.</p><a className="btn primary" href="#/">Back to home</a></div></div>;
  void b;

  const cur = (s) => (seg === s || (!seg && s === 'home') ? 'page' : undefined);

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Sidebar">
        <a className="brand" href="#/"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--brand)" /><path d="M9 8h9a5 5 0 0 1 0 10h-5v6H9z" fill="none" stroke="var(--brand-ink)" strokeWidth="2.6" strokeLinejoin="round" /><path d="M20 22h4" stroke="var(--ok-bg)" strokeWidth="2.6" strokeLinecap="round" /></svg>Pre-Price</a>
        <a className="btn primary block" href="#/" onClick={() => setTimeout(() => askRef.current?.focus(), 50)}><Icon n="plus" size={18} /> Get a quote</a>
        <nav aria-label="Main"><ul className="nav">
          <li><a href="#/" aria-current={cur('home')}><Icon n="home" /> Home</a></li>
          <li><a href="#/quotes" aria-current={cur('quotes')}><Icon n="doc" /> Saved quotes</a></li>
          <li><a href="#/files" aria-current={cur('files')}><Icon n="file" /> Price files</a></li>
          <li><a href="#/evidence" aria-current={cur('evidence')}><Icon n="book" /> Evidence</a></li>
          <li><a href="#/how" aria-current={cur('how')}><Icon n="info" /> How it works</a></li>
        </ul></nav>
            </aside>
      <div className={`drawer-back ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div>
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="Open menu" aria-expanded={open}><Icon n="menu" /></button>
          <SearchBox catalog={catalog} nav={nav} inputRef={searchRef} />
          <button className="icon-btn" onClick={flip} aria-label="Switch between light and dark" title="Switch between light and dark"><Icon n={document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon'} /></button>
        </header>
        <main id="main" tabIndex={-1} className="main">{page}<p className="foot">Pre-Price is not a medical provider and quotes only what a hospital's published file supports.</p></main>
      </div>
      <Toast msg={toastMsg} />
    </div>
  );
}

function SearchBox({ catalog, nav, inputRef }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [sel, setSel] = useState(0);
  const pages = [
    { g: 'Pages', t: 'Evidence: what surgery does to household finances', to: '/evidence', k: 'evidence hardship surgery 5.4 37.9 credit card apr' },
    { g: 'Pages', t: 'How it works and its limits', to: '/how', k: 'how works limits simulated clock sandbox' },
    { g: 'Pages', t: 'Price files read', to: '/files', k: 'files hospitals format' },
    { g: 'Pages', t: 'Saved quotes', to: '/quotes', k: 'quotes invoices saved' },
  ];
  const all = useMemo(() => [...catalog.items.map((i) => ({ g: 'Results', t: `${i.extraction.hospital}: ${i.label} (${i.codeLabel})`, to: `/read/${i.id}`, k: `${i.label} ${i.codeLabel} ${i.extraction.hospital} ${i.short}` })), ...pages], [catalog]); // eslint-disable-line
  const hits = q.trim() ? all.filter((x) => (x.t + ' ' + x.k).toLowerCase().includes(q.trim().toLowerCase())) : all.slice(0, 7);
  const go = (h) => { if (!h) return; nav(h.to); setOpen(false); setQ(''); inputRef.current?.blur(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel((s) => Math.min(hits.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); go(hits[sel]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  return (
    <div className="search" role="search">
      <span className="ico"><Icon n="search" size={20} /></span>
      <label htmlFor="gs" className="visually-hidden">Search results, pages and evidence</label>
      <input id="gs" ref={inputRef} role="combobox" aria-expanded={open} aria-controls="gs-list" aria-autocomplete="list" aria-activedescendant={open && hits[sel] ? `gs-${sel}` : undefined} placeholder="Search procedures, hospitals and evidence" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} autoComplete="off" />
      {open && (
        <ul className="results" id="gs-list" role="listbox" aria-label="Search results">
          {hits.length === 0 && <li role="option" aria-selected="false" style={{ cursor: 'default' }}>Nothing matches “{q}”. Try a procedure such as knee, or a hospital name.</li>}
          {hits.map((h, i) => (<li key={h.to} id={`gs-${i}`} role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); go(h); }} onMouseEnter={() => setSel(i)}><span className="xs muted">{h.g}</span>{h.t}</li>))}
        </ul>
      )}
    </div>
  );
}
