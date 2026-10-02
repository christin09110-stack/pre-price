// Streams the real 402MB Wentworth-Douglass (Mass General Brigham) price file out of its 67MB zip and reports what it finds.
import { scanPriceFile, compactRows } from '../lambda/scan.mjs';
const src = process.argv[2];
const isUrl = /^https?:/.test(src);
const t = Date.now(); let last = 0;
const peak = { rss: 0 }; const iv = setInterval(() => { peak.rss = Math.max(peak.rss, process.memoryUsage().rss); }, 200);
const s = await scanPriceFile(isUrl ? src : null, { codes: [process.env.CODE || '470'], types: process.env.CODE ? undefined : ['MS-DRG'], keywords: /major hip and knee|knee replacement/i }, { localPath: isUrl ? undefined : src, onProgress: ({ bytes, totalBytes }) => { if (bytes - last > 8e6) { last = bytes; process.stderr.write(`\r  read ${(bytes / 1e6).toFixed(0)} of ${(totalBytes / 1e6).toFixed(0)} MB compressed`); } } });
clearInterval(iv);
console.log(`\ndelimiter-sniffed records: ${s.records.toLocaleString()}  columns: ${s.header.length}  header at record ${s.headerIdx + 1}`);
console.log(`rows carrying the code: ${s.matched}  (kept ${s.codeRows.length}); description matches kept: ${s.kwRows.length}`);
console.log(`elapsed ${((Date.now() - t) / 1000).toFixed(1)} s; peak RSS ${(peak.rss / 1e6).toFixed(0)} MB`);
console.log('header:', s.header.join(' | '));
const c = compactRows(s);
console.log(JSON.stringify(c.rows.slice(0, 2), null, 0).slice(0, 1400));
