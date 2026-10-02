// Bundles the seeded extractions into the web app so the first screen renders with real data even before the API answers.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { HOSPITALS, SEEDS } from '../lambda/catalog.mjs';
const dir = new URL('../lambda/seed/', import.meta.url);
const full = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) { const j = JSON.parse(readFileSync(new URL(f, dir))); full[j.id] = j; }
const out = { hospitals: HOSPITALS, items: SEEDS.map((s) => ({ ...s, extraction: full[s.id] })) };
writeFileSync(new URL('../web/src/catalog.json', import.meta.url), JSON.stringify(out));
console.log('catalog.json', Math.round(JSON.stringify(out).length / 1024) + 'KB', SEEDS.length, 'items');
