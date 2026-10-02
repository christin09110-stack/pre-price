// The agent: Bedrock Converse with tool use, looping until it records an extraction or asks the patient a question.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { scanPriceFile, compactRows, toNumber } from './scan.mjs';
import { TOOL as RECORD_TOOL, SYSTEM as EXTRACT_RULES, ground } from './extract.mjs';
import { resolveProcedure } from './procedures.mjs';
import { HOSPITALS } from './catalog.mjs';
import { patientShare, zeroPlan, cardPlan, money } from './policy.mjs';
import { existsSync } from 'node:fs';

const MODEL = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 8, retryMode: 'adaptive' });
const LOCAL = { jhh: 'jhh.csv', mclaren: 'mclaren-flint.csv', brookings: 'brookings.csv', wentworth: 'wentworth-full.zip' };

const tool = (name, description, properties, required) => ({ toolSpec: { name, description, inputSchema: { json: { type: 'object', properties, required, additionalProperties: false } } } });
const TOOLS = [
  tool('list_price_files', 'List the hospital price files this tool can read, with format and size.', {}, []),
  tool('resolve_procedure_code', 'Map a patient\'s plain-language description of an operation to candidate CPT / MS-DRG codes. Returns scored candidates. If several candidates are plausible and they would price very differently, ask the patient with ask_user.', { description: { type: 'string' } }, ['description']),
  tool('search_price_file', 'Stream the hospital\'s real machine-readable price file and return every row that carries this code (plus a few description matches). Rows come back as non-blank column: value pairs with ids like A.r1. This is the only source of prices.', { hospital_id: { type: 'string', enum: Object.keys(HOSPITALS) }, code: { type: 'string' }, code_system: { type: 'string', enum: ['CPT', 'HCPCS', 'MS-DRG', 'APC'] }, description_keywords: { type: 'string', description: 'a few words to catch description matches, e.g. "knee arthroscopy"' } }, ['hospital_id', 'code']),
  tool('get_payer_rates', 'From rows already returned by search_price_file, pull every dollar amount whose column name mentions the payer (case-insensitive).', { payer_query: { type: 'string' } }, ['payer_query']),
  tool('compute_patient_share', 'Compute what an insured patient owes from an allowed amount, using their remaining deductible, coinsurance and remaining out-of-pocket maximum. Use this instead of doing arithmetic yourself.', { allowed: { type: 'number' }, deductible_remaining: { type: 'number' }, coinsurance_pct: { type: 'number' }, oop_remaining: { type: 'number' } }, ['allowed', 'deductible_remaining', 'coinsurance_pct', 'oop_remaining']),
  tool('check_affordability', 'Check a 0% instalment plan against the patient\'s monthly take-home pay. Returns the instalment, the share of take-home it uses, and a flag.', { total: { type: 'number' }, months: { type: 'integer' }, down_pct: { type: 'number' }, monthly_take_home: { type: 'number' } }, ['total', 'months', 'monthly_take_home']),
  tool('ask_user', 'Ask the patient ONE short clarifying question when their description is too vague to code, or the file offers choices only they can make. Ends this turn.', { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 5 } }, ['question']),
  { toolSpec: { name: RECORD_TOOL.name, description: RECORD_TOOL.description + ' Call this once, last, after search_price_file. Row ids must be the exact ids returned (A.r1 ...).', inputSchema: RECORD_TOOL.inputSchema } },
];

const SYSTEM = `You are the price-file agent inside Pre-Price. A patient has been quoted a name for an operation and nothing else. Your job is to find out what the hospital's own published price file actually says, and to say plainly when it says nothing useful.

Workflow:
1. If the patient gave no CPT/DRG code, call resolve_procedure_code. If two or more candidates are plausible and would be priced very differently (for example "knee surgery" could be an arthroscopy or a full replacement), call ask_user with the choices instead of guessing.
2. Call search_price_file for the chosen hospital and code. You may search a second code if the first returns nothing.
3. Use get_payer_rates, compute_patient_share and check_affordability when the patient has given you plan terms or income; never do arithmetic yourself.
4. Finish with record_extraction. If the file has nothing defensible, record scope none and say why. Admitting a file is unusable is a correct result.

${EXTRACT_RULES.split('Rules, in order of importance:')[1].replace('Call record_extraction exactly once.', '')}
Row ids from search_price_file carry a prefix (A.r1, A.k1, B.r1). Cite them exactly.`;

export async function runAgent({ message, hospitalId, history = [], onStep, onProgress }) {
  const trace = [];
  const scans = []; // {prefix, hospital, code, scan, compact}
  const cacheKey = (h, c) => `${h}|${c}`;
  const hospital = HOSPITALS[hospitalId];
  const userText = [...history.map((h) => `${h.role === 'agent' ? 'Agent asked' : 'Patient said'}: ${h.text}`), `Patient said: ${message}`, `Selected hospital file: ${hospitalId} (${hospital?.name || 'unknown'})`].join('\n');
  const messages = [{ role: 'user', content: [{ text: userText }] }];
  let final = null, question = null, usageTotal = { inputTokens: 0, outputTokens: 0 };
  const t0 = Date.now();

  const impl = {
    list_price_files: async () => Object.entries(HOSPITALS).map(([id, h]) => ({ id, name: h.name, format: h.format, sizeMB: h.sizeMB })),
    resolve_procedure_code: async ({ description }) => resolveProcedure(description),
    search_price_file: async ({ hospital_id, code, code_system, description_keywords }) => {
      const h = HOSPITALS[hospital_id]; if (!h) return { error: 'unknown hospital_id' };
      const prefix = String.fromCharCode(65 + scans.length) + '.';
      const types = code_system === 'MS-DRG' ? ['MS-DRG'] : code_system === 'CPT' ? ['CPT'] : undefined;
      const kw = description_keywords ? new RegExp(description_keywords.split(/\s+/).filter(Boolean).map((w) => w.replace(/[^\w]/g, '')).join('|'), 'i') : undefined;
      const localDir = process.env.LOCAL_FILE_DIR; const lp = localDir && LOCAL[hospital_id] && existsSync(`${localDir}/${LOCAL[hospital_id]}`) ? `${localDir}/${LOCAL[hospital_id]}` : undefined;
      // CMS tall files type their code columns; wide custom files do not, so only enforce a type when asked and present
      const scan = await scanPriceFile(h.url, { codes: [code], types: code_system === 'MS-DRG' ? types : undefined, keywords: kw }, { localPath: lp, onProgress });
      const compact = compactRows(scan, prefix);
      scans.push({ prefix, hospital: h.name, hospitalId: hospital_id, code, scan, compact });
      return { prefix, file: h.name, records_scanned: scan.records, megabytes: Number((scan.bytes / 1e6).toFixed(1)), header_columns: scan.header.length, header: scan.header.join(' | ').slice(0, 1500), preamble: scan.preamble.map((r) => r.filter(Boolean).join(' | ').slice(0, 300)), common: compact.common, rows: compact.rows.map((r) => ({ id: r.id, line: r.line, kind: r.kind, cells: r.cells })) };
    },
    get_payer_rates: async ({ payer_query }) => {
      const q = payer_query.toLowerCase(); const out = [];
      for (const s of scans) for (const r of s.compact.rows) for (const [k, v] of Object.entries(r.cells)) if (k.toLowerCase().includes(q) && toNumber(v) !== null) out.push({ row_id: r.id, field: k, cell: v, value: toNumber(v) });
      return out.slice(0, 20);
    },
    compute_patient_share: async (a) => patientShare(a.allowed, { deductibleRemaining: a.deductible_remaining, coinsurancePct: a.coinsurance_pct, oopRemaining: a.oop_remaining }),
    check_affordability: async ({ total, months, down_pct = 0, monthly_take_home }) => {
      const p = zeroPlan(total, months, down_pct);
      const ratio = Number((p.monthly / monthly_take_home).toFixed(3));
      // Product heuristic, not a clinical or regulatory threshold: flag instalments above 10% of take-home.
      return { instalment: p.monthly, down_payment: p.down, share_of_take_home: ratio, flag: ratio > 0.10 ? 'strained: lengthen the plan' : ratio > 0.05 ? 'workable' : 'comfortable', card_comparison: cardPlan(total, months) };
    },
  };

  for (let turn = 0; turn < 9 && !final && !question; turn++) {
    const out = await bedrock.send(new ConverseCommand({ modelId: MODEL, system: [{ text: SYSTEM }], messages, toolConfig: { tools: TOOLS }, inferenceConfig: { maxTokens: 5000, temperature: 0 } }));
    usageTotal.inputTokens += out.usage.inputTokens; usageTotal.outputTokens += out.usage.outputTokens;
    const msg = out.output.message; messages.push(msg);
    const uses = msg.content.filter((c) => c.toolUse).map((c) => c.toolUse);
    const text = msg.content.filter((c) => c.text).map((c) => c.text).join(' ').trim();
    if (text) { trace.push({ kind: 'thought', text: text.slice(0, 500) }); onStep?.(trace.at(-1)); }
    if (!uses.length) break;
    const results = [];
    for (const u of uses) {
      const st = Date.now();
      if (u.name === 'ask_user') { question = u.input; results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ text: 'Question sent to the patient.' }] } }); trace.push({ kind: 'tool', name: u.name, input: u.input, summary: u.input.question, ms: 0 }); continue; }
      if (u.name === 'record_extraction') {
        final = u.input; trace.push({ kind: 'tool', name: u.name, input: { status: u.input.status, scope: u.input.quote?.scope }, summary: `status ${u.input.status}, quote scope ${u.input.quote?.scope}`, ms: 0 });
        results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ text: 'Recorded.' }] } }); continue;
      }
      let result, err = null;
      try { result = await impl[u.name](u.input); } catch (e) { err = String(e.message).slice(0, 300); }
      const summary = err ? `error: ${err}` : summarize(u.name, result);
      const step = { kind: 'tool', name: u.name, input: u.input, summary, ms: Date.now() - st };
      trace.push(step); onStep?.(step);
      results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ text: JSON.stringify(err ? { error: err } : result).slice(0, 60000) }], status: err ? 'error' : 'success' } });
    }
    messages.push({ role: 'user', content: results });
  }

  if (question) return { status: 'needs_input', question: question.question, options: question.options || [], trace, usage: usageTotal };
  if (!final) throw new Error('Agent finished without recording an extraction');

  // merge every scan the agent made into one row index for the grounding check
  const rows = scans.flatMap((s) => s.compact.rows);
  const common = Object.assign({}, ...scans.map((s) => s.compact.common));
  const grounded = ground(final, { rows, common });
  const main = scans.find((s) => rows.some((r) => r.id === final.quote?.amount_row_id) && s.compact.rows.some((r) => r.id === final.quote?.amount_row_id)) || scans.at(-1);
  const out = {
    ...grounded, hospital: main?.hospital || hospital?.name, hospitalInfo: hospital, procedureLabel: final.procedure?.description,
    scan: main ? { records: main.scan.records, bytes: main.scan.bytes, columns: main.scan.header.length, rowsKept: main.compact.rows.length, headerLine: main.scan.headerIdx + 1, ms: Date.now() - t0 } : null,
    usage: usageTotal, model: MODEL, rows, common, header: main?.scan.header, trace, agentMs: Date.now() - t0,
  };
  out.confidenceDetail = scoreConfidence(out, scans);
  return { status: 'done', extraction: out };
}

function summarize(name, r) {
  if (name === 'list_price_files') return `${r.length} files`;
  if (name === 'resolve_procedure_code') return r.length ? r.map((c) => `${c.system} ${c.code} (${c.score})`).join(', ') : 'no candidates';
  if (name === 'search_price_file') return r.error || `${r.records_scanned.toLocaleString()} records, ${r.megabytes} MB scanned, ${r.rows.length} rows kept`;
  if (name === 'get_payer_rates') return `${r.length} amounts`;
  if (name === 'compute_patient_share') return `patient owes $${r.total}${r.capped ? ' (out-of-pocket cap applied)' : ''}`;
  if (name === 'check_affordability') return `$${r.instalment}/month = ${(r.share_of_take_home * 100).toFixed(1)}% of take-home: ${r.flag}`;
  return '';
}

// Deterministic confidence, independent of the model's own claim.
export function scoreConfidence(ex, scans = []) {
  const reasons = []; let level = 'high';
  const down = (to, why) => { reasons.push(why); if (to === 'low' || (to === 'medium' && level === 'high')) level = to; };
  if (ex.quote?.scope === 'none') down('low', 'No defensible price in this file');
  else if (ex.quote?.scope === 'component_only') down('low', 'Only component fees found, not a whole-procedure price');
  if (ex.grounding?.removed?.length) down('medium', `${ex.grounding.removed.length} figure(s) the model reported were not in the cited cells and were deleted`);
  if (!ex.self_pay_price && ex.quote?.scope === 'facility_total') down('medium', 'No self-pay price: the figure is a payer-specific estimate');
  if (ex.negotiated_rates?.some((r) => r.kind === 'estimated_allowed_amount')) down('medium', 'Payer amounts are the hospital\'s own algorithmic estimates');
  const codeRows = (ex.rows || []).filter((r) => r.kind === 'code_match');
  if (codeRows.length > 1 && ex.quote?.scope === 'facility_total' && !ex.negotiated_rates?.length) down('medium', `${codeRows.length} rows carry this code`);
  const pre = scans.flatMap((s) => s.scan.preamble.flat()).join(' ');
  const yr = (pre.match(/20\d\d-\d\d-\d\d/) || [])[0];
  if (yr && yr < '2024-01-01') down('medium', `File last updated ${yr}`);
  if (!yr) down('medium', 'The file carries no update date, so it may be stale');
  if (ex.confidence === 'medium' || ex.confidence === 'low') down(ex.confidence, 'The reading of this file needed a judgment call; the data problems list says which');
  if (ex.problems?.length) reasons.push(`${ex.problems.length} data-quality problem(s) noted`);
  if (!reasons.length) reasons.push('Single clear row, every figure matched its cell');
  return { level, reasons, file_updated: yr || null };
}
