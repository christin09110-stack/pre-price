// The real files this build was proven against. URLs are the hospitals' own public downloads.
export const HOSPITALS = {
  jhh: {
    name: 'The Johns Hopkins Hospital', city: 'Baltimore, MD',
    url: 'https://jhm-web-assets.s3.amazonaws.com/hopkinsmedicine/prod/charge-fees/520591656_JohnsHopkinsHospital_standardcharges.csv',
    format: 'CMS v2.2.0 "tall" CSV, updated 2025-07-01', sizeMB: 11.7,
    mess: 'Inpatient prices are payer "algorithms" with an estimated amount per plan. No cash price and no gross charge for the knee-replacement DRG.',
  },
  mclaren: {
    name: 'McLaren Flint', city: 'Flint, MI',
    url: 'https://www.mclaren.org/Uploads/Public/Documents/corporate/ChargeMasterFile/2021/38-2383119_McLarenFlint_standardcharges.csv',
    format: 'Pre-template "wide" CSV, 68 columns, 2021', sizeMB: 13.9,
    mess: 'One column pair per payer, dollars sitting next to "49.0% of Charges". The same code is on several rows under different revenue codes.',
  },
  wentworth: {
    name: 'Wentworth-Douglass Hospital', city: 'Dover, NH (Mass General Brigham)',
    url: 'https://healthcare.mgb.org/pricetransparency/020260334_Wentworth-Douglass-Hospital_StandardCharges.zip',
    format: 'Pipe-delimited text, 402 MB unpacked from a 67 MB zip, FY2024 codes', sizeMB: 66.7,
    mess: '864,000 rows, one per payer contract per code. Codes arrive as text like "MS-DRG V41.0 (FY 2024) 470" or with a corrupted prefix ("CPT\uFFFD 90676"). Self-pay is a payer named "<Self-pay>".',
  },
  brookings: {
    name: 'Brookings Hospital', city: 'Brookings, SD',
    url: 'https://www.brookingshealth.org/sites/default/files/2020-12/466000069_Brookings-Hospital_standardcharges.csv',
    format: 'Custom "wide" CSV, 32 columns, 2020', sizeMB: 8.0,
    mess: 'Dashes as placeholders, an unnamed first column, left and right knee as separate rows, and a "price" that is a professional fee.',
  },
};

export const SEEDS = [
  { id: 'mclaren-29881', hospital: 'mclaren', label: 'Knee arthroscopy with meniscectomy', short: 'Knee arthroscopy', codeLabel: 'CPT 29881', target: { codes: ['29881'], keywords: '/knee arthroscop/i' }, hero: true },
  { id: 'jhh-470', hospital: 'jhh', label: 'Total knee replacement, inpatient', short: 'Knee replacement', codeLabel: 'MS-DRG 470', target: { codes: ['470'], types: ['MS-DRG'], keywords: '/joint replacement|knee/i' } },
  { id: 'brookings-27447', hospital: 'brookings', label: 'Total knee replacement', short: 'Knee replacement', codeLabel: 'CPT 27447', target: { codes: ['27447'], keywords: '/knee arthroplast/i' } },
  { id: 'mclaren-47562', hospital: 'mclaren', label: 'Laparoscopic gallbladder removal', short: 'Gallbladder removal', codeLabel: 'CPT 47562', target: { codes: ['47562'], keywords: '/cholecystectomy/i' } },
  { id: 'wentworth-470', hospital: 'wentworth', label: 'Total knee replacement, inpatient', short: 'Knee replacement', codeLabel: 'MS-DRG 470', target: { codes: ['470'], types: ['MS-DRG'], keywords: '/joint replacement/i' } },
  { id: 'brookings-47562', hospital: 'brookings', label: 'Laparoscopic gallbladder removal', short: 'Gallbladder removal', codeLabel: 'CPT 47562', target: { codes: ['47562'], keywords: '/cholecystectomy/i' } },
];

export const reviveTarget = (t) => ({ ...t, keywords: t.keywords ? new RegExp(t.keywords.slice(1, t.keywords.lastIndexOf('/')), t.keywords.slice(t.keywords.lastIndexOf('/') + 1)) : undefined });
