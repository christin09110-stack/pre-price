# BUILD-LOG (pre-price)
- 2026-10-02T01:16:58Z started; dirs created
- PayPal sandbox auth OK. Invoicing spec pulled: v2.12.0, 27 paths (data/invoicing-schema.json). Probed by hand: create/send/remind/record-payment/QR all 200 (invoice INV2-DPEA-U255-VAE8-7FZD). Billing product/plan/subscription OK (category must be SERVICES, not HEALTHCARE; sub stays APPROVAL_PENDING: needs human).
- Real files found via DoltHub hospital-price-transparency URL list (search engines blocked). Downloaded to data/files/: Johns Hopkins Hospital (CMS v2.2.0 tall CSV, 2025-07-01, 11.7MB; DRG 470 w/ "algorithm" rows, no cash price), McLaren Flint (2021 wide CSV w/ rate-type columns, 13.9MB, CPT 29881/27447/47562), Brookings Hospital SD (2020 wide CSV w/ " - " placeholders, 8MB; TKA LT/RT rows are tiny component fees). No live JSON file found (Atrium 403, Cedars 404) -> JSON path untested.
- Stack decision: zero-dependency Lambda (Node 22 bundled AWS SDK v3), Function URL called directly from browser w/ CORS; CloudFront serves SPA.
- 2026-10-02T01:33:34Z extraction proven on 3 real files (5 seeds in lambda/seed). e2e local: ALL PASSED (data/e2e-local-run1.txt). Fixed: PayPal generate-next-invoice-number gives >25 char value its own create rejects; fully-paid external invoices show MARKED_AS_PAID not PAID. mclaren-47562: model summed two rows, grounding checker removed the invented total (feature working).
- big-file path: Wentworth-Douglass (MGB) 66.7MB zip -> 402MB pipe-delimited txt, server throttled ~0.3MB/s; streaming unzip + auto delimiter sniff + regex-jump CSV parser added

## UI iteration log (screenshots in shots/rN/, never deleted)
- r1 (broken): wrong server on the port (:5199 was already in use, caught from the screenshot), primary buttons rendered with no text (a dark-mode link-colour rule beat .btn.primary), menu button showed at desktop width. SCORE 4/10.
- r2: fixed those. Comparison panel strong at 1280 and 360. Quote page fine. Faults: staggered panels in grids (.panel + .panel margin), refusal page showed a green "High confidence" badge that read as confidence in a price, raw ALL-CAPS file text as the page title, 5th card orphaned. SCORE 6/10.
- r3: fixed grid alignment, confidence wording ("in this finding"), titles from friendly labels, card grid. Reviewer feedback then said the read screen was telemetry, with empty cards, a duplicated badge and a quota meter. SCORE 6.5/10.
- r4: Read screen rebuilt: price, one trust line, "What this price does not cover" promoted, everything else behind "See how this was read"; quota meter removed; sandbox note moved to a footer line.
- r5 (final screenshots in shots/r5/, all four widths x light and dark; 0 px horizontal overflow everywhere). SCORE 8.5/10.
  Why not 9: the home screen is still the least distinctive (the reference shape was followed closely, so it reads familiar); icons for the procedure cards are generic; the "See how this was read" disclosure is plain. Kept strong: the comparison panel at every width, the refusal state, the quote document.
- 200% text test found three overflow bugs (card text on home, the total figure and a long heading at 360px); fixed, rerun clean (data/zoom-200-run2.txt).
- Contrast: input borders failed 3:1 in both themes (2.13 and 2.41); darkened the border token, now 3.87 and 4.29 (data/contrast.txt).

## Backend decisions that cost time
- Search engines are blocked from this machine; hospital file URLs came from the DoltHub hospital-price-transparency database (url column), then each was probed with HEAD.
- Function URLs now need both lambda:InvokeFunctionUrl and lambda:InvokeFunction permissions; aws-cli 2.27 has no --invoked-via-function-url flag, so the second statement is unconditioned.
- MGB's price file host throttles to a few hundred KB/s at times. A dropped partial download and a resumed one corrupted a local copy once (88 MB for a 67 MB file); redownloaded clean.
- Bedrock ThrottlingException from other workloads on the account; adaptive retry added; seed generation needed a retry loop.
- Webhook handler now answers 200 first and does follow-up work after the response is sent (streaming handler).
- Quote cancel: PayPal refuses to cancel a paid or partly paid invoice (CANNOT_CANCEL_PAID_INVOICE). UI hides the button once payments exist.
