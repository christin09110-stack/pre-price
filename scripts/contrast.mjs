// Computes WCAG contrast ratios from the actual tokens in web/src/styles.css. Thresholds from Apple HIG accessibility: 4.5:1 text <=17pt, 3:1 for 18pt+/bold and UI.
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const light = block(/:root \{([\s\S]*?)\n\}/);
const dark = block(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/);
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ['ink on page', 'ink', 'page', 4.5], ['ink on surface', 'ink', 'surface', 4.5], ['secondary text on surface', 'ink-2', 'surface', 4.5], ['secondary text on page', 'ink-2', 'page', 4.5],
  ['tertiary text (placeholders) on surface', 'ink-3', 'surface', 4.5], ['button text on button', 'brand-ink', 'brand', 4.5], ['link/brand on surface', 'brand', 'surface', 4.5],
  ['label on tint panel', 'tint-ink', 'tint', 4.5], ['ok badge', 'ok', 'ok-bg', 4.5], ['warning badge', 'warn', 'warn-bg', 4.5], ['risk badge', 'risk', 'risk-bg', 4.5],
  ['interest red on surface', 'risk', 'surface', 4.5], ['focus ring on surface (UI, 3:1)', 'focus', 'surface', 3], ['input border on surface (UI, 3:1)', 'line-strong', 'surface', 3],
  ['ink on highlighted cell', 'ink', 'mark', 4.5],
];
for (const [name, theme] of [['LIGHT', light], ['DARK', dark.surface ? { ...light, ...dark } : light]]) {
  console.log(`\n${name}`);
  for (const [label, f, b, need] of pairs) { const r = ratio(theme[f], theme[b]); console.log(`${r >= need ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (need ${need}:1)  ${label}  ${theme[f]} on ${theme[b]}`); }
}
