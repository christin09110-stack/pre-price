// AI extraction + deterministic grounding check.
// The model reads the raw rows and says what the file supports; the code then refuses any figure
// it cannot find, character for character, in the cited row.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { scanPriceFile, compactRows, toNumber } from './scan.mjs';

const MODEL = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 8, retryMode: 'adaptive' });

const fig = {
  type: ['object', 'null'], additionalProperties: false,
  properties: { value: { type: 'number' }, row_id: { type: 'string' }, field: { type: 'string', description: 'exact column name the number was read from' } },
  required: ['value', 'row_id', 'field'],
};
export const TOOL = {
  name: 'record_extraction',
  description: 'Record what the hospital price file does and does not support for this procedure.',
  inputSchema: { json: {
    type: 'object', additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['usable', 'partial', 'unusable'], description: 'usable = a facility price for the whole procedure can be read; partial = only components or only plan-specific estimates; unusable = no defensible number' },
      procedure: { type: 'object', additionalProperties: false, properties: { code: { type: 'string' }, code_system: { type: 'string', enum: ['CPT', 'HCPCS', 'MS-DRG', 'APC', 'CDM', 'other'] }, description: { type: 'string' }, setting: { type: 'string', enum: ['inpatient', 'outpatient', 'both', 'unknown'] } }, required: ['code', 'code_system', 'description', 'setting'] },
      self_pay_price: fig,
      gross_charge: fig,
      min_rate: fig,
      max_rate: fig,
      negotiated_rates: { type: 'array', maxItems: 14, description: 'Payer-specific amounts, copied from the file. Include dollar amounts only.', items: { type: 'object', additionalProperties: false, properties: { payer: { type: 'string' }, plan: { type: 'string' }, value: { type: 'number' }, row_id: { type: 'string' }, field: { type: 'string' }, kind: { type: 'string', enum: ['negotiated_dollar', 'estimated_allowed_amount', 'dollar_beside_percent_of_charges'] } }, required: ['payer', 'value', 'row_id', 'field', 'kind'] } },
      quote: { type: 'object', additionalProperties: false, properties: {
        scope: { type: 'string', enum: ['facility_total', 'component_only', 'none'], description: 'facility_total only if the amount plausibly covers the hospital facility charge for the whole procedure, not a single supply, professional or anaesthesia line' },
        amount: { type: ['number', 'null'] },
        amount_row_id: { type: ['string', 'null'] }, amount_field: { type: ['string', 'null'] },
        basis: { type: 'string', description: 'one or two plain sentences a patient could read: which cell, which row, why it is or is not a whole-procedure price' },
      }, required: ['scope', 'amount', 'basis'] },
      not_in_file: { type: 'array', items: { type: 'string' }, description: 'Charges a patient would expect that this file does not contain (surgeon, anaesthesia, implants, pathology...)' },
      problems: { type: 'array', items: { type: 'string' }, description: 'Concrete data-quality problems seen in these rows, quoting the cell, e.g. a placeholder dash, an algorithm in place of a dollar amount, duplicate rows that disagree' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['status', 'procedure', 'quote', 'not_in_file', 'problems', 'confidence'],
  } },
};

export const SYSTEM = `You read US hospital price-transparency files (45 CFR Part 180) for a patient-facing quoting tool. The files are messy and every hospital lays them out differently.

You are given: the hospital's header/preamble records, and the rows of the file that mention the procedure code (code_match) plus a few description matches (keyword_match). Each row has an id (r1, r2, k1...), its line number in the file, and only its non-blank cells as column: value pairs. Cells identical across all code_match rows are shown once under "common".

Rules, in order of importance:
1. NEVER do arithmetic and never invent, round or convert a number. Every number you return must be copied exactly from a cell, with its row_id and column name. A separate checker will delete any figure that does not match its cell.
2. A single code can appear on several rows (different revenue codes, left/right sides, inpatient and outpatient, one row per payer). Say when rows disagree rather than picking silently.
3. Decide honestly whether a number is a price for the whole facility side of the procedure ("facility_total") or just a component (a professional fee, an anaesthesia line, a supply, one side of a bilateral line). Revenue codes 96x, 97x and 98x are professional fees; 964 is anaesthesia professional fees; 360 and 361 are operating room services; 278 is implants. A figure of a few hundred dollars for a joint replacement is not a facility total. If the only figure is a component, scope is component_only. If nothing is usable, scope is none and amount is null.
4. "estimated_amount" with an "algorithm" description is the hospital's own estimate of what a payer's contract allows, not a fixed price: report it as estimated_allowed_amount. When the file gives no cash price (self-pay) for the code, leave self_pay_price null and say so under problems. Do not substitute the gross charge as the self-pay price.
4b. Some files have no discounted-cash column and instead list self-pay as a payer named "<Self-pay>" (or similar); that row's price cell is the self-pay price, and its expected-reimbursement cell is what the hospital expects to collect. Report them as such, and say which column you used. When one self-pay row carries two plausible whole-procedure figures (a price and a lower expected-reimbursement), quote the price column, because that is what the file states as the price, and put the other figure and the ambiguity under problems with confidence medium or low.
5. Placeholders such as " - ", blank, "N/A", or percentages are not dollar amounts. A "% of Charges" cell beside a dollar cell: use the dollar cell, kind dollar_beside_percent_of_charges.
6. For the headline quote: if a self-pay (discounted cash) price exists for a facility-total row, use it. Otherwise if the file only has payer estimates, set quote.amount to null with scope facility_total only when a payer-specific amount is a whole-procedure facility amount, and let the caller choose the payer; put the lowest and highest in min_rate and max_rate when the file states them.
7. List what a patient would expect on a bill that is not in the file under not_in_file. Be specific to the procedure.
8. Keep prose short, plain and specific. No marketing words.
Call record_extraction exactly once.`;

export function buildPrompt(scan, compact, procedureLabel) {
  const pre = scan.preamble.map((r) => r.filter(Boolean).join(' | ').slice(0, 400)).filter(Boolean);
  return `Procedure the patient asked about: ${procedureLabel}

File preamble records:
${pre.join('\n') || '(none)'}

Header (${scan.header.length} columns): ${scan.header.join(' | ').slice(0, 1800)}

Records scanned: ${scan.records.toLocaleString()}. Rows kept: ${compact.rows.length}.

common (cells identical on every code_match row): ${JSON.stringify(compact.common)}

Rows:
${compact.rows.map((r) => JSON.stringify({ id: r.id, line: r.line, kind: r.kind, cells: r.cells })).join('\n')}`;
}

export async function callModel(prompt) {
  const out = await bedrock.send(new ConverseCommand({
    modelId: MODEL,
    system: [{ text: SYSTEM }],
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    toolConfig: { tools: [{ toolSpec: TOOL }], toolChoice: { tool: { name: 'record_extraction' } } },
    inferenceConfig: { maxTokens: 4000, temperature: 0 },
  }));
  const use = out.output.message.content.find((c) => c.toolUse)?.toolUse;
  if (!use) throw new Error('Model returned no tool call');
  return { result: use.input, usage: out.usage };
}

// ---- deterministic grounding check ----
export function ground(result, compact) {
  const byId = Object.fromEntries(compact.rows.map((r) => [r.id, r]));
  const common = compact.common;
  const removed = [];
  let checked = 0, verified = 0;
  const check = (f, label) => {
    if (!f || f.value == null) return null;
    checked++;
    const row = byId[f.row_id];
    const cell = row ? (row.cells[f.field] ?? common[f.field]) : undefined;
    const n = toNumber(cell);
    if (n !== null && Math.abs(n - f.value) < 0.005) { verified++; return { ...f, cell: String(cell), line: row.line }; }
    removed.push(`${label}: ${f.value} not found in ${f.row_id}.${f.field}${cell !== undefined ? ` (cell says ${cell})` : ''}`);
    return null;
  };
  const g = { ...result };
  for (const k of ['self_pay_price', 'gross_charge', 'min_rate', 'max_rate']) g[k] = check(result[k], k);
  g.negotiated_rates = (result.negotiated_rates || []).map((r) => {
    const c = check(r, `rate ${r.payer}`);
    return c ? { ...r, cell: c.cell, line: c.line } : null;
  }).filter(Boolean);
  if (result.quote?.amount != null) {
    const c = check({ value: result.quote.amount, row_id: result.quote.amount_row_id, field: result.quote.amount_field }, 'quote.amount');
    g.quote = { ...result.quote, grounded: !!c, cell: c?.cell, line: c?.line };
    if (!c) { g.quote.amount = null; if (g.quote.scope !== 'none') g.quote.scope = 'none'; }
  }
  g.grounding = { checked, verified, removed };
  return g;
}

// ---- end to end ----
export async function extract({ url, localPath, target, procedureLabel, hospital }) {
  const t0 = Date.now();
  const scan = await scanPriceFile(url, target, { localPath });
  const compact = compactRows(scan);
  if (!compact.rows.length) {
    return { status: 'unusable', hospital, procedureLabel, scan: statsOf(scan, compact, t0), quote: { scope: 'none', amount: null, basis: 'The code does not appear anywhere in this file.' }, not_in_file: [], problems: ['Code not found in file'], confidence: 'high', grounding: { checked: 0, verified: 0, removed: [] }, rows: [] };
  }
  const prompt = buildPrompt(scan, compact, procedureLabel);
  const { result, usage } = await callModel(prompt);
  const grounded = ground(result, compact);
  return { ...grounded, hospital, procedureLabel, scan: statsOf(scan, compact, t0), usage, model: MODEL, rows: compact.rows, common: compact.common, header: scan.header };
}
const statsOf = (scan, compact, t0) => ({ records: scan.records, bytes: scan.bytes, columns: scan.header.length, rowsKept: compact.rows.length, headerLine: scan.headerIdx + 1, ms: Date.now() - t0 });
