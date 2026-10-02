// Drives the local app with Playwright (Chromium needs --no-sandbox on this machine) and saves screenshots.
import { createRequire } from 'node:module';
const require = createRequire('/tmp/claude-1000/pw/');
const { chromium } = require('playwright-core');
const base = process.env.BASE || 'http://127.0.0.1:5199';
const tag = process.argv[2] || 'r1';
const widths = [360, 768, 1280, 1920];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
import { mkdirSync } from 'node:fs';
mkdirSync(new URL(`../shots/${tag}/`, import.meta.url), { recursive: true });
const out = (n) => new URL(`../shots/${tag}/${n}.png`, import.meta.url).pathname;
const quoteId = process.env.QUOTE;
for (const scheme of ['light', 'dark']) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    const shot = async (name, hash, full = true, sel) => {
      await page.goto(`${base}/#${hash}`); await page.waitForTimeout(600); await page.waitForSelector('.skeleton', { state: 'detached', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500);
      if (sel) { const el = await page.$(sel); if (el) { await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: out(`${scheme}-${w}-${name}`) }); return; } }
      await page.screenshot({ path: out(`${scheme}-${w}-${name}`), fullPage: full });
    };
    await shot('home', '/');
    await shot('read-ok', '/read/mclaren-29881');
    await shot('read-refused', '/read/brookings-27447');
    await shot('read-insured', '/read/jhh-470');
    if (quoteId) { await shot('quote', `/quote/${quoteId}`); await shot('compare', `/quote/${quoteId}`, false, '.compare'); }
    await shot('evidence', '/evidence');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(scheme, w, 'horizontal overflow px:', overflow, errs.length ? 'ERRORS ' + errs.slice(0, 3).join(' | ') : '');
    await ctx.close();
  }
}
await browser.close();
