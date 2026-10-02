# Pre-Price

**A binding price for your operation before you have it, and a 0% instalment plan instead of a 27% medical credit card.**

Hospitals in the US must publish their prices. Many publish files that contain no usable price. Pre-Price reads a hospital's own machine-readable price file, extracts a number for the specific procedure, issues an itemised **PayPal invoice** as the quote, and turns it into a **PayPal billing plan** of equal instalments with no interest. The screen that matters puts that plan next to what the same amount costs on a medical credit card at 26.99% APR.

- Site: https://d374t6frlui23r.cloudfront.net
- API (Lambda Function URL): https://fleltplpaitbmueekixec2wcpq0paotb.lambda-url.us-east-1.on.aws/api/health
- Everything runs against the **PayPal sandbox**. No real patient, no real money, and the hospital is not a party to these invoices.

## The problem, with the verified figures

**Surgery causes a 5.4-point rise in financial hardship. It does not cause 37.9%.**

| Figure | What it is | Source |
|---|---|---|
| **+5.4 percentage points** (95% CI 1.8 to 9.0) | Hardship **caused by surgery**: a 16% relative rise over matched patients who did not have surgery | JAMA Surg 2026;161(1):59-66, PMID 41259019. MEPS 2014-2021, weighted n = 40 million |
| 37.9% | The **level** of hardship among surgical patients in the year after surgery. It is not the effect of surgery and is never presented as one anywhere in this project | same study |
| +23.7 points uninsured, +8.4 privately insured, Medicaid no significant change | The increment by payer. Family out-of-pocket spending rose $708 | same study |
| about 43% of hospitals | require payment before an elective procedure: 20.1% always, 22.5% sometimes. **The 43% is our own addition (87 of 204); the authors report the two components.** 22 hospitals wanted payment before the procedure, often about 50% of estimated cost-sharing; 16 required a down payment of up to 50% before allowing instalments. 97% offered payment plans, 19.1% offered third-party financing, and 20.5% of those charged interest or fees | Randall et al., Health Aff Sch 2024, PMID 38808329. Random 10% sample of US hospitals phoned Jun to Nov 2023, 204 usable responses |
| **26.99% APR** | Average medical credit card rate; accepted at 8.7% of orthopaedic locations. CareCredit is accepted at 42% of academic plastic-surgery practices | JAMA Health Forum 2025, PMID 40215074; Ann Surg Open 2026, PMID 42344451 |
| 22.4% vs 3.4% | Kidney-stone patients with financial toxicity who deferred recommended surgery, against those without. **Self-reported, volunteer sample** | Urology 2025, PMID 40602468 |

**Why an agent is needed.** The law already requires publication (45 CFR Part 180: $300 a day up to $5,500 a day, a ceiling of about $2.0 million a year), but CMS has taken 13,355 actions (3,646 warning notices, 2,107 corrective action plan requests) and issued **29 civil monetary penalty notices across 28 hospitals**: fewer than 0.5% of hospitals. The largest were Northside Atlanta $883,180, Jackson Memorial $871,122 and Community First $847,740. And the files are often unusable: **56% of hospitals offering shoppable services reported no prices and only 6% were fully concordant** (PMID 39220579); among top orthopaedic hospitals 38 to 39% were fully compliant; in neurosurgery 96.5% had the file but only 42.7% reported any negotiated price (PMID 38345364).

Other figures used in the app: emergency surgery 30.7% hardship and 12.7% catastrophic expenditure (PMID 42600426); inpatient surgery over 65, 21.9% toxicity and mean out-of-pocket $2,395 (PMID 42469109); Michigan emergency general surgery with linked credit reports, n = 4,216, 9.1% with more collections debt at 12 months, mean +$1,764, uninsured 29.5% against 7.3% privately insured (PMID 42775827).

## What it does

1. **Ask.** The patient names the operation in plain words and picks a hospital file. An agent (Claude Sonnet 4.5 on Bedrock, Converse API with tool use) loops over tools: `resolve_procedure_code`, `search_price_file`, `get_payer_rates`, `compute_patient_share`, `check_affordability`, `ask_user`, `record_extraction`. If "knee surgery" could mean an arthroscopy or a replacement it asks one question rather than guessing.
2. **Read.** The file is **streamed**, never loaded: delimiter sniffed (comma, pipe, tab), header found by scoring, zip unpacked on the fly, quoted newlines handled. A real 402 MB file is scanned in about four seconds of CPU locally. The UI shows a determinate progress bar from real byte counts (Lambda response streaming).
3. **Verify.** Every number the model returns must name a row and column. Code compares it with that cell and **deletes any figure that does not match**. The model never does arithmetic. When it added two rows together on one file, the check removed the invented total.
4. **Refuse when the file says nothing.** A quote is issued only for a whole-procedure facility price (self-pay) or a plan-specific published amount plus the patient's own deductible, coinsurance and out-of-pocket limit (insured). Otherwise the page says so plainly and names the next step (a written good-faith estimate). Confidence is computed by code from what was found, and always printed in words.
5. **Quote.** `POST /v2/invoicing/invoices` from a reusable **template**, itemised lines, **partial payment**, a **QR code**, `/send`, `/remind`, and account-level **scheduled auto-reminders** (3 days before, 2 days after, twice). Payments are recorded with `/payments`.
6. **Plan.** `POST /v1/catalogs/products`, `/v1/billing/plans`, `/v1/billing/subscriptions`. Equal instalments, cents settled in the down payment so the sum is exactly the quote. A person must approve the subscription once in PayPal; everything after that is hands-free.
7. **Webhooks.** `INVOICING.INVOICE.PAID`, `.CANCELLED` and `BILLING.SUBSCRIPTION.*` are verified with `POST /v1/notifications/verify-webhook-signature` and rejected with HTTP 401 if the signature fails. PayPal receives its 200 before any follow-up work. Replayed events are ignored.
8. **Idempotency.** `Idempotency-Key` becomes the invoice number and the `PayPal-Request-Id`; a repeat returns the same invoice. A duplicate-number 422 from PayPal is treated as success.

### Real files used

| Hospital | Layout | Size |
|---|---|---|
| The Johns Hopkins Hospital | CMS v2.2.0 tall CSV, 2025-07-01. Inpatient prices are payer "algorithms" with an estimate per plan; no cash price for DRG 470 | 11.7 MB |
| McLaren Flint | 2021 wide CSV, 68 columns, dollars next to "49.0% of Charges", the same code on several rows | 13.9 MB |
| Brookings Hospital | 2020 wide CSV with `-` placeholders; the knee-replacement "price" is a $568.82 professional fee | 8.0 MB |
| Wentworth-Douglass Hospital (Mass General Brigham) | pipe-delimited text, **402 MB unpacked from a 67 MB zip**, 863,923 rows, codes like `MS-DRG V41.0 (FY 2024) 470`, self-pay as a payer named `<Self-pay>` | 66.7 MB download |

Not covered: the CMS JSON layout. No live JSON file was reachable while building (one host returned 403, one 404), so that path is **untested** and not implemented.

## The clock is simulated

PayPal's sandbox has **no clock control for subscriptions**, so renewals, retries and dunning cannot be demonstrated with documented tooling. The "Record the next payment (simulated)" button writes each payment to the invoice with `POST /v2/invoicing/invoices/{id}/payments`, which is what a `PAYMENT.SALE.COMPLETED` webhook would do. The UI carries a dashed "Simulated clock" banner next to it, the footer says so on every page, and the payment note PayPal stores starts with `SIMULATED CLOCK`.

## Architecture

```
CloudFront -> S3 (React + Vite)                      static site
browser   -> Lambda Function URL (Node 22, no deps)  holds the PayPal secret; response streaming
              |-- Bedrock Converse  (us.anthropic.claude-sonnet-4-5-20250929-v1:0)
              |-- DynamoDB on-demand (extractions, quotes, events, idempotency, daily budgets)
              |-- PayPal Invoicing v2.12.0, Billing v1, Webhooks
              '-- hospital price files (streamed over HTTPS)
```

No API Gateway, no SAM, no CDK: `deploy.sh` uses the plain `aws` CLI. AWS account 854924711083, us-east-1. Idle cost is close to zero (DynamoDB on-demand, Lambda, S3, CloudFront price class 100). Daily caps in DynamoDB stop abuse of Bedrock and the sandbox: 150 live agent runs, 300 quotes, 300 plans per day. Stored results never use the cap.

The Invoicing spec was pulled from `developer.paypal.com/api/invoicing/v2/schema.json`: **version 2.12.0, 27 paths** (`data/invoicing-schema.json`), against 2.6 with 16 in the old GitHub copy. Used: invoices, send, remind, payments, QR code, templates, setup-reminders and reminders, search-invoices, cancel.

## Run it

```bash
# needs: node 22+, aws CLI authenticated to the account, jq, zip, and ../../.env with PAYPAL_CLIENT_ID / PAYPAL_SECRET / PAYPAL_API
cd lambda && npm install && cd ..           # dev-only SDK copies; the Lambda runtime already bundles AWS SDK v3
./deploy.sh all                              # table, role, Lambda + streaming Function URL, S3, CloudFront
node scripts/register-webhook.mjs            # registers the Function URL as the sandbox webhook
node scripts/e2e.mjs "$(jq -r .api .deploy-state.json)"   # real PayPal + real Bedrock end-to-end checks
cd web && VITE_API=<function url> npm run dev            # local UI
```

Secrets are read from `.env` at deploy time and set as Lambda environment variables. They are not in the repository.

## Accessibility, measured

Contrast ratios computed from the actual tokens by `scripts/contrast.mjs` (full output in `data/contrast.txt`). Thresholds from Apple's HIG: 4.5:1 for text up to 17pt, 3:1 for 18pt and larger, bold and interface boundaries.

| Pair | Light | Dark |
|---|---|---|
| Body text on page | 15.79:1 | 16.04:1 |
| Body text on cards | 17.25:1 | 14.58:1 |
| Secondary text on cards | 8.07:1 | 9.14:1 |
| Placeholder and tertiary text | 5.77:1 | 6.74:1 |
| Button text on button | 13.79:1 | 11.10:1 |
| "Verified" badge text | 6.12:1 | 8.49:1 |
| "Medium confidence" badge text | 6.70:1 | 8.84:1 |
| Interest in red on cards | 6.54:1 | 8.43:1 |
| Input border (3:1 needed) | 3.87:1 | 4.29:1 |
| Focus ring (3:1 needed) | 5.73:1 | 8.06:1 |

Body text is 16px in a sans face; the serif is used only for headings, the quote document and the large figures, where it is large and bold. Controls are 36 to 44px tall. Text enlarged to 200% keeps its hierarchy with no horizontal scroll at 1280 and 360 px (`data/zoom-200-run2.txt`). Nothing relies on colour alone: every status badge carries an icon and words ("Medium confidence in this finding", "Component fees only"). Full keyboard use, visible focus ring, skip link, labelled icon buttons, dialog focus trap, and `prefers-reduced-motion` is respected. Light and dark both work.

## Known gaps

- Subscription approval needs a human in a PayPal browser. The sandbox buyer approval was **not** completed here, so subscriptions stay `APPROVAL_PENDING`; no real renewal ran.
- JSON price files and Deflate64 zip archives are not supported.
- Two of the four files are from 2020 and 2021. Confidence says so; prices may have changed.
- Bedrock returned throttling errors under shared-account load while building. The SDK retries; the UI explains when a live run still fails. Stored results are unaffected.
- Quotes are reachable by anyone who has the quote id (no accounts). Fine for a sandbox demonstration; a real deployment needs patient authentication.
- A quote covers the hospital facility charge only. Surgeon, anaesthesia and implant fees are listed as not included.

MIT licence, see `LICENSE`.
