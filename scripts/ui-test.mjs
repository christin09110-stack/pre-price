// Clicks every interactive element of the real UI against the real deployed API. Prints PASS/FAIL per check.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/tmp/claude-1000/pw/');
const { chromium } = require('playwright-core');
const base = process.env.BASE || 'http://127.0.0.1:5317';
const tag = process.argv[2] || 'ui';
mkdirSync(new URL(`../shots/${tag}/`, import.meta.url), { recursive: true });
const shot = (p, n) => p.screenshot({ path: new URL(`../shots/${tag}/${n}.png`, import.meta.url).pathname, fullPage: true });
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fails++; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(base + '/#/'); await page.waitForSelector('h1');
ok('home heading', (await page.textContent('h1')).includes('What operation'));

// search
await page.fill('#gs', 'gallbladder'); await page.waitForSelector('#gs-list li');
ok('search lists a result', (await page.locator('#gs-list li').count()) >= 1);
await page.keyboard.press('Enter'); await page.waitForURL(/#\/read\//);
ok('search Enter opens a result', /#\/read\//.test(page.url()));

// refused result
await page.goto(base + '/#/read/brookings-27447'); await page.waitForSelector('h1');
ok('refusal explains itself', (await page.textContent('main')).includes('No price can be quoted from this file'));
ok('no quote form on a refused result', (await page.locator('text=Issue the binding quote').count()) === 0);
await page.click('summary:has-text("See how this was read")'); ok('disclosure opens', await page.locator('.excerpt').first().isVisible());

// quote flow
await page.goto(base + '/#/read/mclaren-29881'); await page.waitForSelector('text=Issue the binding quote');
await page.fill('#em', 'bad'); await page.click('button:has-text("Issue the binding quote")');
ok('validation error shown for a bad email', await page.locator('.err').isVisible());
await page.fill('#em', 'maya.okafor@example.com'); await page.click('button:has-text("Issue the binding quote")');
await page.waitForURL(/#\/quote\//, { timeout: 60000 }); await page.waitForSelector('.doc'); await page.waitForSelector('.skeleton', { state: 'detached' }).catch(() => {});
ok('quote document shows the file price', (await page.textContent('.doc')).includes('$4,464.93'));
ok('QR code image present', (await page.locator('.doc img').count()) === 1);
await page.fill('#months', '18').catch(async () => { await page.locator('#months').evaluate((el) => { el.value = 18; el.dispatchEvent(new Event('input', { bubbles: true })); }); });
await page.locator('#months').evaluate((el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '18'); el.dispatchEvent(new Event('input', { bubbles: true })); });
ok('slider updates the comparison', (await page.textContent('.compare')).includes('18'));
await page.click('button:has-text("Send a reminder")'); await page.waitForSelector('.toast');
ok('reminder confirmed', (await page.textContent('.toast')).includes('Reminder sent'));
await page.click('button:has-text("Start the instalment plan")'); await page.waitForSelector('[role=dialog]');
ok('confirm dialog names the commitment', (await page.textContent('[role=dialog]')).includes('18 monthly payments'));
await page.keyboard.press('Escape'); ok('Escape closes the dialog', (await page.locator('[role=dialog]').count()) === 0);
await page.click('button:has-text("Start the instalment plan")'); await page.click('[role=dialog] button:has-text("Start the plan")');
await page.waitForSelector('text=The instalment plan', { timeout: 60000 });
ok('approval link points at PayPal', (await page.getAttribute('a:has-text("Approve in PayPal sandbox")', 'href')).includes('paypal.com'));
ok('simulated clock banner visible', (await page.textContent('.sim-banner')).includes('Simulated clock'));
await page.click('button:has-text("Record the next payment")'); await page.waitForSelector('.sched .done', { timeout: 30000 });
ok('payment recorded on the invoice', (await page.locator('.sched .done').count()) === 1);
await page.click('button:has-text("Record the next payment")'); await page.waitForFunction(() => document.querySelectorAll('.sched .done').length === 2, null, { timeout: 30000 });
ok('second payment recorded', true);
await shot(page, 'quote-with-plan');
const quoteUrl = page.url();

// persistence
await page.goto(base + '/#/quotes'); await page.waitForSelector('table', { timeout: 30000 });
ok('saved quotes lists it', (await page.locator('table a').count()) >= 1);
await page.reload(); await page.waitForSelector('table', { timeout: 30000 });
ok('still there after reload', (await page.locator('table a').count()) >= 1);
await page.goto(quoteUrl); await page.reload(); await page.waitForSelector('.doc', { timeout: 30000 });
ok('quote still there after reload with progress intact', (await page.locator('.sched .done').count()) === 2);

// other pages and chrome
for (const [h, t] of [['/files', 'Price files read'], ['/evidence', 'Why a quote needs an agent'], ['/how', 'How it works']]) { await page.goto(base + '/#' + h); ok(`page ${h}`, (await page.textContent('h1')).includes(t)); }
await page.goto(base + '/#/evidence'); ok('5.4 versus 37.9 distinction present', (await page.textContent('main')).includes('This is the level, not the effect of surgery'));
await page.click('button[aria-label^="Switch between"]'); ok('theme toggle sets data-theme', ['dark', 'light'].includes(await page.getAttribute('html', 'data-theme')));
await page.goto(base + '/#/nowhere'); ok('unknown route has a way home', await page.locator('a:has-text("Back to home")').isVisible());

// mobile menu
await page.setViewportSize({ width: 360, height: 800 }); await page.goto(base + '/#/');
await page.click('button[aria-label="Open menu"]'); ok('mobile drawer opens', await page.locator('.side.open').isVisible());
await page.click('.side a:has-text("Evidence")'); await page.waitForTimeout(400); ok('drawer link navigates and closes', /evidence/.test(page.url()) && (await page.locator('.side.open').count()) === 0);
// keyboard focus ring
await page.keyboard.press('Tab');
const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
ok('focus is visible on first Tab', outline !== 'none', outline);

// cancel
ok('a quote with payments offers no cancel button', (await page.goto(quoteUrl), await page.waitForSelector('.doc'), (await page.locator('button:has-text("Cancel this quote")').count()) === 0));
const fresh = await page.evaluate(async (api) => { const r = await fetch(api + '/api/quotes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extractionId: 'mclaren-29881', coverage: 'self_pay', patient: { given: 'Cancel', surname: 'Test', email: 'cancel.test@example.com' } }) }); return (await r.json()).quote.id; }, process.env.API);
await page.goto(base + '/#/quote/' + fresh); await page.waitForSelector('.doc'); await page.click('button:has-text("Cancel this quote")'); await page.click('[role=dialog] button:has-text("Cancel the quote")');
await page.waitForSelector('.badge:has-text("Cancelled")', { timeout: 30000 }); ok('quote cancelled through PayPal', true);
ok('no uncaught page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
await browser.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
