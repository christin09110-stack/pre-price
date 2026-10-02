import { createRequire } from 'node:module'; import { mkdirSync } from 'node:fs';
const require = createRequire('/tmp/claude-1000/pw/'); const { chromium } = require('playwright-core');
mkdirSync(new URL('../shots/r6/', import.meta.url), { recursive: true });
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const w of [1600, 1280, 768, 360]) { const p = await (await b.newContext({ viewport: { width: w, height: 1000 } })).newPage(); await p.goto(process.env.BASE + '/#/'); await p.waitForTimeout(1200); await p.screenshot({ path: new URL(`../shots/r6/home-${w}.png`, import.meta.url).pathname, fullPage: true }); console.log(w, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); }
await b.close();
