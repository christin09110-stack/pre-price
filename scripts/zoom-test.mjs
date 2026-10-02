// 200% text enlargement: raises the root font size and checks nothing overflows or hides.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/tmp/claude-1000/pw/');
const { chromium } = require('playwright-core');
const base = process.env.BASE; const q = process.env.QUOTE;
mkdirSync(new URL('../shots/zoom/', import.meta.url), { recursive: true });
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const w of [1280, 360]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
  for (const [name, hash] of [['home', '/'], ['read', '/read/mclaren-29881'], ['quote', `/quote/${q}`]]) {
    await p.goto(`${base}/#${hash}`); await p.addStyleTag({ content: 'html{font-size:200% !important}' }); await p.waitForTimeout(1500);
    await p.waitForSelector('.skeleton', { state: 'detached', timeout: 15000 }).catch(() => {});
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`200% text, width ${w}, ${name}: horizontal overflow ${o}px`);
    await p.screenshot({ path: new URL(`../shots/zoom/${w}-${name}.png`, import.meta.url).pathname, fullPage: false });
  }
}
await b.close();
