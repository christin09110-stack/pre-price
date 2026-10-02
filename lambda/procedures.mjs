// Small dictionary of common planned procedures, used by the agent's resolve_procedure_code tool.
// Codes are the standard CPT / MS-DRG identifiers; this is a lookup aid, never a source of prices.
export const PROCEDURES = [
  { code: '29881', system: 'CPT', name: 'Knee arthroscopy with meniscectomy', setting: 'outpatient', words: 'knee arthroscopy arthroscopic scope meniscus meniscectomy meniscal tear cartilage' },
  { code: '29880', system: 'CPT', name: 'Knee arthroscopy with medial and lateral meniscectomy', setting: 'outpatient', words: 'knee arthroscopy both menisci medial lateral meniscectomy' },
  { code: '29888', system: 'CPT', name: 'ACL reconstruction (arthroscopic)', setting: 'outpatient', words: 'acl anterior cruciate ligament reconstruction knee ligament' },
  { code: '27447', system: 'CPT', name: 'Total knee replacement (arthroplasty)', setting: 'both', words: 'total knee replacement arthroplasty tka joint' },
  { code: '470', system: 'MS-DRG', name: 'Major hip and knee joint replacement without MCC (inpatient)', setting: 'inpatient', words: 'total knee replacement hip replacement joint inpatient admitted drg' },
  { code: '27130', system: 'CPT', name: 'Total hip replacement (arthroplasty)', setting: 'both', words: 'total hip replacement arthroplasty tha hip' },
  { code: '29827', system: 'CPT', name: 'Shoulder arthroscopy with rotator cuff repair', setting: 'outpatient', words: 'shoulder rotator cuff repair arthroscopy' },
  { code: '47562', system: 'CPT', name: 'Laparoscopic cholecystectomy (gallbladder removal)', setting: 'outpatient', words: 'gallbladder removal cholecystectomy laparoscopic gallstones' },
  { code: '49505', system: 'CPT', name: 'Open repair of inguinal hernia', setting: 'outpatient', words: 'inguinal hernia repair groin' },
  { code: '49650', system: 'CPT', name: 'Laparoscopic repair of inguinal hernia', setting: 'outpatient', words: 'inguinal hernia repair laparoscopic groin' },
  { code: '44970', system: 'CPT', name: 'Laparoscopic appendectomy', setting: 'both', words: 'appendix appendectomy laparoscopic' },
  { code: '66984', system: 'CPT', name: 'Cataract surgery with intraocular lens', setting: 'outpatient', words: 'cataract lens eye surgery' },
  { code: '63030', system: 'CPT', name: 'Lumbar discectomy (laminotomy)', setting: 'both', words: 'lumbar disc discectomy herniated back sciatica laminotomy' },
  { code: '64721', system: 'CPT', name: 'Carpal tunnel release', setting: 'outpatient', words: 'carpal tunnel release wrist hand nerve' },
  { code: '58661', system: 'CPT', name: 'Laparoscopic removal of ovaries/tubes', setting: 'outpatient', words: 'ovary tube laparoscopy oophorectomy salpingectomy' },
  { code: '58558', system: 'CPT', name: 'Hysteroscopy with biopsy/polypectomy', setting: 'outpatient', words: 'hysteroscopy uterus polyp biopsy' },
  { code: '58150', system: 'CPT', name: 'Total abdominal hysterectomy', setting: 'inpatient', words: 'hysterectomy uterus removal abdominal' },
  { code: '45378', system: 'CPT', name: 'Diagnostic colonoscopy', setting: 'outpatient', words: 'colonoscopy colon screening scope' },
  { code: '43239', system: 'CPT', name: 'Upper endoscopy with biopsy', setting: 'outpatient', words: 'endoscopy egd upper gi stomach biopsy' },
  { code: '30520', system: 'CPT', name: 'Septoplasty', setting: 'outpatient', words: 'septoplasty deviated septum nose' },
  { code: '42826', system: 'CPT', name: 'Tonsillectomy', setting: 'outpatient', words: 'tonsillectomy tonsils throat' },
  { code: '55866', system: 'CPT', name: 'Laparoscopic radical prostatectomy', setting: 'inpatient', words: 'prostatectomy prostate cancer robotic laparoscopic' },
  { code: '22551', system: 'CPT', name: 'Anterior cervical discectomy and fusion', setting: 'both', words: 'cervical fusion acdf neck spine disc' },
  { code: '43775', system: 'CPT', name: 'Laparoscopic sleeve gastrectomy', setting: 'inpatient', words: 'sleeve gastrectomy bariatric weight loss stomach' },
];

export function resolveProcedure(description, limit = 5) {
  const toks = String(description).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
  const codeHit = PROCEDURES.find((p) => toks.includes(p.code));
  if (codeHit) return [{ ...codeHit, score: 1 }];
  return PROCEDURES.map((p) => {
    const bag = new Set(p.words.split(' '));
    const hits = toks.filter((t) => bag.has(t) || [...bag].some((w) => w.length > 4 && (w.startsWith(t) || t.startsWith(w)))).length;
    return { code: p.code, system: p.system, name: p.name, setting: p.setting, score: toks.length ? Number((hits / toks.length).toFixed(2)) : 0 };
  }).filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
