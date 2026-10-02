// Streaming scanner for hospital price-transparency CSVs.
// Real files are 5-500MB and every hospital lays them out differently, so we never load the file:
// we stream it, find the header, and keep only the records that mention the procedure code.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

// ---------- CSV record stream (quoted delimiters/newlines, BOM, CRLF, auto-detected , | or tab) ----------
// Hot path for 400MB files: jump between special characters with a regex instead of walking every character.
export async function* csvRecords(chunks, delimiter = null) {
  const dec = new TextDecoder('utf-8');
  let D = delimiter, special = null;
  let field = '', rec = [], inQ = false, started = false, pendingQuote = false, skipLF = false;
  const endField = () => { rec.push(field); field = ''; };
  for await (const chunk of chunks) {
    let s = typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
    if (!started) {
      s = s.replace(/^﻿/, ''); started = true;
      if (!D) { // sniff the delimiter from the first line, ignoring quoted text
        const first = s.split(/\r?\n/)[0].replace(/"[^"]*"/g, '');
        const n = (ch) => first.split(ch).length - 1;
        D = n('|') > n(',') && n('|') >= n('\t') ? '|' : n('\t') > n(',') ? '\t' : ',';
      }
      special = new RegExp('[' + (D === '|' ? '\\|' : D === '\t' ? '\\t' : ',') + '"\\r\\n]', 'g');
    }
    const len = s.length; let i = 0;
    if (skipLF) { skipLF = false; if (s[0] === '\n') i = 1; }
    if (pendingQuote) { pendingQuote = false; if (s[i] === '"') { field += '"'; i++; } else inQ = false; }
    while (i < len) {
      if (inQ) {
        const j = s.indexOf('"', i);
        if (j < 0) { field += s.slice(i); i = len; break; }
        field += s.slice(i, j); i = j + 1;
        if (i >= len) { pendingQuote = true; break; }
        if (s[i] === '"') { field += '"'; i++; } else inQ = false;
        continue;
      }
      special.lastIndex = i;
      const m = special.exec(s);
      if (!m) { field += s.slice(i); i = len; break; }
      const j = m.index, ch = s[j];
      if (j > i) field += s.slice(i, j);
      i = j + 1;
      if (ch === '"') { if (field === '') inQ = true; else field += '"'; }
      else if (ch === D) endField();
      else { // newline
        if (ch === '\r') { if (i < len) { if (s[i] === '\n') i++; } else skipLF = true; }
        endField();
        if (!(rec.length === 1 && rec[0] === '')) yield rec;
        rec = [];
      }
    }
  }
  if (pendingQuote) inQ = false;
  if (field !== '' || rec.length) { endField(); yield rec; }
}

// ---------- numbers ----------
export const MONEY_RE = /^\(?-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$|^\(?-?\$?\s*\d+(?:\.\d+)?\)?$/;
export function toNumber(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t || !MONEY_RE.test(t)) return null;
  const n = Number(t.replace(/[$,\s()]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const isBlank = (v) => v == null || /^[\s\-–—]*$/.test(String(v)) || /^(n\/?a|null|none)$/i.test(String(v).trim());

// ---------- header detection ----------
// The header is the early record with the most distinct, mostly non-numeric, non-blank cells.
export function pickHeader(early) {
  let best = -1, bestScore = 0;
  early.forEach((r, i) => {
    const cells = r.map((x) => x.trim()).filter((x) => x && toNumber(x) === null);
    const score = new Set(cells).size;
    if (score > bestScore && r.length >= 5) { best = i; bestScore = score; }
  });
  return best;
}

// ---------- SSRF guard for user-supplied URLs ----------
export async function assertPublicHttps(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== 'https:') throw new Error('Only https URLs are accepted');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(address)) throw new Error('Refusing to fetch a private address');
  }
  return u;
}


// Many large hospital files ship as a single-entry .zip. Stream-inflate it without ever holding the archive.
export async function* unzipFirstEntry(chunks) {
  let buf = Buffer.alloc(0); let headerDone = false; let inflate = null; let method = 0;
  const it = chunks[Symbol.asyncIterator]();
  const feed = [];
  for (;;) {
    const { value, done } = await it.next();
    if (done) break;
    const c = Buffer.from(value);
    if (!headerDone) {
      buf = Buffer.concat([buf, c]);
      if (buf.length < 30) continue;
      if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Not a zip archive');
      const flags = buf.readUInt16LE(6); method = buf.readUInt16LE(8);
      const n = buf.readUInt16LE(26), x = buf.readUInt16LE(28);
      if (buf.length < 30 + n + x) continue;
      if (method === 9) throw new Error('This archive uses Deflate64, which the streaming reader does not support');
      if (method !== 8 && method !== 0) throw new Error(`Unsupported zip compression method ${method}`);
      headerDone = true; void flags;
      const rest = buf.subarray(30 + n + x);
      inflate = method === 8 ? zlib.createInflateRaw() : null;
      const src = (async function* () { if (rest.length) yield rest; for (;;) { const r = await it.next(); if (r.done) return; yield Buffer.from(r.value); } })();
      const out = inflate ? Readable.from(src).pipe(inflate) : Readable.from(src);
      for await (const o of out) yield o;
      return;
    }
  }
  throw new Error('Zip archive ended before its first entry');
}

// ---------- main scan ----------
// target: { codes: ['29881'], keywords: /knee|arthroscop/i }
export async function scanPriceFile(url, target, opts = {}) {
  const { maxBytes = 400 * 1024 * 1024, maxCodeRows = 60, maxKeywordRows = 12, localPath, onProgress } = opts;
  let source, bytes = 0, totalBytes = null;
  if (localPath) {
    const { createReadStream } = await import('node:fs');
    const { stat } = await import('node:fs/promises');
    totalBytes = (await stat(localPath)).size;
    const rawLocal = (async function* () { for await (const c of createReadStream(localPath)) { bytes += c.length; onProgress?.({ bytes, totalBytes }); yield c; } })();
    source = /\.zip$/i.test(localPath) ? unzipFirstEntry(rawLocal) : rawLocal;
  } else {
    await assertPublicHttps(url);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (pre-price price-file reader)' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Price file fetch failed: HTTP ${res.status}`);
    totalBytes = Number(res.headers.get('content-length')) || null;
    if (totalBytes && totalBytes > maxBytes) throw new Error(`File is ${(totalBytes / 1e6).toFixed(0)}MB, over the ${(maxBytes / 1e6).toFixed(0)}MB live-read limit`);
    const raw = (async function* () { for await (const c of res.body) { bytes += c.length; if (bytes > maxBytes) throw new Error('File exceeded live-read limit'); onProgress?.({ bytes, totalBytes }); yield c; } })();
    source = /\.zip(\?|$)/i.test(url) ? unzipFirstEntry(raw) : raw;
  }

  const codes = new Set(target.codes.map(String));
  let codeTotal = 0, codeCols = null;
  const TYPE_WORD = { 'MS-DRG': 'DRG', CPT: 'CPT', HCPCS: 'HCPCS', APC: 'APC' };
  const early = [];
  let header = null, headerIdx = -1, nrec = 0;
  const codeRows = [], kwRows = [];
  const preamble = [];

  for await (const rec of csvRecords(source)) {
    nrec++;
    if (!header) {
      early.push(rec);
      if (early.length >= 6) {
        headerIdx = pickHeader(early);
        header = early[headerIdx].map((h) => h.trim());
        for (let i = 0; i < headerIdx; i++) preamble.push(early[i]);
        for (let i = headerIdx + 1; i < early.length; i++) consider(early[i], i + 1);
      }
      continue;
    }
    consider(rec, nrec);
  }
  if (!header && early.length) { // tiny file
    headerIdx = pickHeader(early); header = early[headerIdx].map((h) => h.trim());
    for (let i = headerIdx + 1; i < early.length; i++) consider(early[i], i + 1);
  }

  function consider(rec, lineNo) {
    if (!codeCols) codeCols = header.map((h, i) => (/code|procedure|cpt|drg|service/i.test(h) ? i : -1)).filter((i) => i >= 0);
    const hit = rec.some((f, i) => {
      const t = f.trim();
      if (codes.has(t) && (codeCols.length === 0 || codeCols.includes(i))) {
        // CMS tall format pairs each code column with a "...|type" column; honour it so DRG 470 is not confused with revenue code 470
        if (target.types && /^code\|\d+$/.test(header[i] || '') && /\|type$/.test(header[i + 1] || '')) return target.types.includes((rec[i + 1] || '').trim());
        return true;
      }
      // Some files prefix the code inside the cell: "CPT? 27447", "MS-DRG V41.0 (FY 2024) 470"
      if (t.length > 3 && t.length < 60 && codeCols.includes(i)) {
        const last = t.split(/\s+/).pop();
        if (codes.has(last) && (!target.types || target.types.some((ty) => t.toUpperCase().includes(TYPE_WORD[ty] || ty)))) return true;
      }
      return false;
    });
    if (hit) { codeTotal++; if (codeRows.length < maxCodeRows) codeRows.push({ lineNo, rec }); return; }
    if (target.keywords && kwRows.length < maxKeywordRows) {
      const desc = rec.slice(0, 14).join(' ');
      if (target.keywords.test(desc)) kwRows.push({ lineNo, rec });
    }
  }

  return { header, headerIdx, preamble, codeRows, kwRows, records: nrec, bytes, totalBytes, matched: codeTotal };
}

// ---------- compaction: turn wide rows into {column: value} of non-blank cells, hoist constants ----------
export function compactRows(scan, prefix = '') {
  const { header } = scan;
  const mk = (r, kind, idx) => {
    const cells = {};
    r.rec.forEach((v, i) => {
      if (isBlank(v)) return;
      const name = (header[i] || `col${i}`).replace(/\s+/g, ' ');
      cells[name] = v.trim().slice(0, 400);
    });
    return { id: `${prefix}${kind}${idx + 1}`, line: r.lineNo, kind: kind === 'r' ? 'code_match' : 'keyword_match', cells };
  };
  const rows = [...scan.codeRows.map((r, i) => mk(r, 'r', i)), ...scan.kwRows.map((r, i) => mk(r, 'k', i))];
  // hoist cells identical across all code_match rows (long notes, setting, billing class...)
  const code = rows.filter((r) => r.kind === 'code_match');
  const common = {};
  if (code.length > 3) {
    for (const k of Object.keys(code[0].cells)) {
      const v = code[0].cells[k];
      if (code.every((r) => r.cells[k] === v) && String(v).length > 0 && toNumber(v) === null) common[k] = v;
    }
    for (const r of code) for (const k of Object.keys(common)) delete r.cells[k];
  }
  return { rows, common };
}
