// Runs the real agent over the real downloaded files and stores the results as the first-load seed.
import { writeFileSync, appendFileSync } from 'node:fs';
import { runAgent } from '../lambda/agent.mjs';
import { HOSPITALS, SEEDS } from '../lambda/catalog.mjs';
process.env.LOCAL_FILE_DIR = new URL('../data/files', import.meta.url).pathname;
const ASK = {
  'mclaren-29881': 'Knee arthroscopy for a torn meniscus (CPT 29881)',
  'jhh-470': 'Total knee replacement with an overnight hospital admission (inpatient, MS-DRG 470)',
  'brookings-27447': 'Total knee replacement (CPT 27447)',
  'mclaren-47562': 'Gallbladder removal by keyhole (laparoscopic) surgery, CPT 47562',
  'wentworth-470': 'Total knee replacement with an overnight hospital admission (inpatient, MS-DRG 470)',
  'brookings-47562': 'Gallbladder removal by keyhole (laparoscopic) surgery, CPT 47562',
};
const only = process.argv[2];
for (const s of SEEDS) {
  if (only && s.id !== only) continue;
  const t0 = Date.now();
  const r = await runAgent({ message: ASK[s.id], hospitalId: s.hospital, onStep: (st) => st.kind === 'tool' && console.log('   ', s.id, st.name, st.summary) });
  if (r.status !== 'done') { console.log(s.id, 'NEEDS INPUT', r.question); continue; }
  const e = r.extraction;
  const out = { id: s.id, seed: s, hospitalInfo: HOSPITALS[s.hospital], extractedAt: new Date().toISOString(), ...e };
  writeFileSync(new URL(`../lambda/seed/${s.id}.json`, import.meta.url), JSON.stringify(out, null, 1));
  const line = `${s.id}: status=${e.status} scope=${e.quote?.scope} amount=${e.quote?.amount} grounded ${e.grounding.verified}/${e.grounding.checked} removed=${e.grounding.removed.length} conf=${e.confidenceDetail.level} tools=${e.trace.filter((t) => t.kind === 'tool').length} ${Date.now() - t0}ms`;
  console.log(line); appendFileSync(new URL('../data/seed-run.log', import.meta.url), `${new Date().toISOString()} ${line}\n`);
}
