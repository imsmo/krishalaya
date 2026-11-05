// apps/web-partner/src/test/brand-guard.spec.ts · PC-56 PARTNER-1a · founder D6 / D7 — THE PLATFORM'S NAME COMES FROM PLATFORM_BRAND, AND NO
// MAILBOX OR BRAND DOMAIN LIVES IN THE CONSOLE. (a) The catalogues: no value carries the platform's name in any script, a mailbox or a domain.
// (b) The source: every file under src/ outside the tests — pages, components, features, lib, styles — carries no literal platform name (an SDK
// type name such as `KrishalayaClient` and a `@krishalaya/…` package path are identifiers, not copy), no mailbox and no brand domain (the
// partners mailbox is a platform FACT read at runtime; F-8 removed the `support@…` literal). M1 kills here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const SRC = path.join(__dirname, '..');
const LITERALS = [PLATFORM_BRAND.name, 'कृषालय', 'કૃષાલય'];
function files(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'test' || d.name === 'test-render' ? [] : files(p);
    return /\.(ts|tsx|css)$/.test(d.name) ? [p] : [];
  });
}

describe('PC-56 PARTNER-1a · brand guard', () => {
  it.each(Object.entries({ en, hi, gu }))('%s: no value carries the platform\'s name, a mailbox or a domain', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      for (const lit of LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
      expect([k, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|krishalaya\.(in|com)|mailto:/i.test(v)]).toEqual([k, false]);
    }
  });
  it('no file under src/ (outside the tests) carries a literal platform name, a mailbox or a brand domain', () => {
    const all = files();
    expect(all.length).toBeGreaterThan(60);
    for (const f of all) {
      const src = fs.readFileSync(f, 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '').replace(/KrishalayaClient/g, '');
      const rel = path.relative(SRC, f);
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b/i.test(src)]).toEqual([rel, false]);
      expect([rel, /krishalaya\.(in|com)/i.test(src)]).toEqual([rel, false]);
    }
  });
  it('the mark is the token: the sidebar and the app name read PLATFORM_BRAND', () => {
    expect(fs.readFileSync(path.join(SRC, 'components', 'Sidebar.tsx'), 'utf8')).toContain('PLATFORM_BRAND.name');
    expect(fs.readFileSync(path.join(SRC, 'lib', 'env.ts'), 'utf8')).toContain('PLATFORM_BRAND.name');
  });
});

describe('PC-56 PARTNER-2a/2b · brand guard over the insurer console\'s new files', () => {
  const NEW = [path.join(SRC, 'components', 'partner2'), path.join(SRC, 'features', 'partner2'), path.join(SRC, 'app', 'insurer'), path.join(SRC, 'lib', 'insurer.ts')];
  const mine = files().filter((f) => NEW.some((d) => f === d || f.startsWith(d + path.sep)));
  it('they are scanned, and none carries the platform\'s name, a mailbox, a domain, a helpline, or a canon institution', () => {
    expect(mine.length).toBeGreaterThanOrEqual(22);
    // PC-56 PARTNER-2b: the four honest pages and their views are among them
    for (const f of ['components/partner2/InsurerIssuanceView.tsx', 'components/partner2/InsurerPremiumsView.tsx', 'components/partner2/InsurerReportsView.tsx',
      'components/partner2/InsurerParametricView.tsx', 'app/insurer/issuance/page.tsx', 'app/insurer/premiums/page.tsx', 'app/insurer/reports/page.tsx', 'app/insurer/parametric/page.tsx']) {
      expect([f, mine.some((m) => path.relative(SRC, m) === f)]).toEqual([f, true]);
    }
    for (const f of mine) {
      const src = fs.readFileSync(f, 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      const rel = path.relative(SRC, f);
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|1800|Bharat Krishi|Saurashtra/i.test(src)]).toEqual([rel, false]);
    }
  });
  it('the sidebar links the mark to the person\'s own home (kind-aware), still from PLATFORM_BRAND', () => {
    const sb = fs.readFileSync(path.join(SRC, 'components', 'Sidebar.tsx'), 'utf8');
    expect(sb).toContain('PLATFORM_BRAND.name'); expect(sb).toContain('homeHref(kind)');
  });
});

describe('PC-56 PARTNER-2c · brand guard over the lender\'s shelf (founder Q9: the platform\'s mark + the lender\'s own name)', () => {
  const NEW = ['components/partner2/LenderProductsView.tsx', 'components/partner2/LenderProductView.tsx', 'app/lender/products/page.tsx', 'app/lender/products/[id]/page.tsx',
    'lib/lender.ts', 'features/partner2/figures.ts', 'features/partner2/refusals.ts'];
  it('they exist, are scanned, and none carries the platform\'s name, a mailbox, a domain, a helpline, or a canon institution, place, person or avatar', () => {
    const all = files().map((f) => path.relative(SRC, f));
    for (const rel of NEW) {
      expect([rel, all.includes(rel)]).toEqual([rel, true]);
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:|1800|Saurashtra|Gramin/i.test(src)]).toEqual([rel, false]);
    }
    // the views and pages carry no canon place, person or avatar (the registry NAMES the canon's claims to refuse them, so it is not scanned for these)
    for (const rel of NEW.slice(0, 5)) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /\bAnand\b|\bAJ\b|Savita|Hetal|Meera|Jayesh|Ramesh|\bAmit\b/.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 PARTNER-3a · brand guard over the claims console (founder Q8: the platform\'s mark + the insurer\'s own name)', () => {
  const NEW = ['components/partner3/InsurerClaimsView.tsx', 'components/partner3/InsurerClaimView.tsx', 'components/partner3/InsurerClaimsInsightsView.tsx',
    'components/partner3/ClaimsSubNav.tsx', 'components/partner3/InsurerClaimsChain.tsx', 'app/insurer/claims/page.tsx', 'app/insurer/claims/[id]/page.tsx',
    'app/insurer/claims/insights/page.tsx', 'features/partner3/figures.ts', 'features/partner3/refusals.ts'];
  it('they exist, are scanned, and none carries the platform\'s name, a mailbox, a domain, a helpline or a canon institution; the views carry no canon person, place, phone or number', () => {
    const all = files().map((f) => path.relative(SRC, f));
    for (const rel of NEW) {
      expect([rel, all.includes(rel)]).toEqual([rel, true]);
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800|Bharat Krishi|Saurashtra|Gramin/i.test(src)]).toEqual([rel, false]);
    }
    // the views, pages and figures carry no canon person, place, phone, claim / policy number or avatar (the registry NAMES the canon's claims
    // to refuse them, so it is not scanned for these)
    for (const rel of NEW.slice(0, 9)) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /Kesar|Manju|Rathod|Vaghela|Chudasama|\bShah\b|\bIyer\b|Popat|Jashu|Karsan|Junagadh|Bhavnagar|Amreli|Bilkha|\+91|CLM-|BKI-|FRD-|\bPM\b/.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 PARTNER-3b · brand guard over the six honest pages (founder Q8: the platform\'s mark + the insurer\'s own name)', () => {
  const NEW = ['components/partner3/ClaimFacts.tsx', 'components/partner3/InsurerEvidenceView.tsx', 'components/partner3/InsurerEvidenceBoardView.tsx',
    'components/partner3/InsurerSurveyorsView.tsx', 'components/partner3/InsurerSurveysView.tsx', 'components/partner3/InsurerSurveyReportView.tsx',
    'components/partner3/InsurerFraudView.tsx', 'app/insurer/claims/evidence/page.tsx', 'app/insurer/claims/evidence/[id]/page.tsx',
    'app/insurer/surveyors/page.tsx', 'app/insurer/surveys/page.tsx', 'app/insurer/surveys/[id]/report/page.tsx', 'app/insurer/claims/fraud/page.tsx'];
  it('all thirteen exist, are scanned, and none carries the platform\'s name, a mailbox, a domain, a helpline, a canon institution, person, place, phone, series or avatar', () => {
    const all = files().map((f) => path.relative(SRC, f));
    expect(NEW.length).toBe(13);
    for (const rel of NEW) {
      expect([rel, all.includes(rel)]).toEqual([rel, true]);
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800|Bharat Krishi|Saurashtra|Gramin/i.test(src)]).toEqual([rel, false]);
      // no canon person, honorific, place, phone, claim / policy / flag series, scheme, breed or avatar anywhere in a 3b view or page
      expect([rel, /Kesar|Manju|Rathod|Vaghela|Chudasama|\bShah\b|\bIyer\b|Popat|Jashu|Karsan|\bBen\s|Bhai|\bDr\.|Junagadh|Bhavnagar|Amreli|Bilkha|\+91|CLM-|BKI-|FRD-|WBCIS|\bCCE\b|Jaffarabadi|\bPM\b/.test(src)]).toEqual([rel, false]);
      // and none of them prints a media reference of any kind (a URL, a file extension, a media field name)
      expect([rel, /\.jpe?g|\.png|\.mp4|mediaUrl|media_url|photoCount|videoCount|signedUrl|https?:\/\//i.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 PARTNER-4a · brand guard over the lender\'s own book (founder 4a-7: the platform\'s mark + the lender\'s own name)', () => {
  // PC-56 PARTNER-4b adds its three views and its three pages to the same block (the registry and the figures module are shared).
  const NEW = ['components/partner4/LenderQueueView.tsx', 'components/partner4/LenderApplicationView.tsx', 'components/partner4/LenderPortfolioView.tsx',
    'components/partner4/LenderLoanView.tsx', 'components/partner4/LenderChain.tsx', 'components/partner4/LendingSubNav.tsx',
    'components/partner4/LenderPayoutsView.tsx', 'components/partner4/LenderRepaymentsView.tsx', 'components/partner4/LenderBatchView.tsx',
    'app/lender/queue/page.tsx', 'app/lender/queue/actions.ts', 'app/lender/queue/[id]/page.tsx',
    'app/lender/portfolio/page.tsx', 'app/lender/portfolio/[id]/page.tsx',
    'app/lender/disbursements/page.tsx', 'app/lender/disbursements/[id]/page.tsx', 'app/lender/repayments/page.tsx',
    'features/partner4/figures.ts', 'features/partner4/refusals.ts'];
  it('all nineteen exist, are scanned, and none carries the platform\'s name, a mailbox, a domain, a helpline or a canon institution', () => {
    const all = files().map((f) => path.relative(SRC, f));
    expect(NEW.length).toBe(19);
    for (const rel of NEW) {
      expect([rel, all.includes(rel)]).toEqual([rel, true]);
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800|Saurashtra|Gramin|Bharat Krishi/i.test(src)]).toEqual([rel, false]);
    }
    // the views, pages and figures carry no canon person, bank, place, loan / application / account id or avatar (the registry NAMES the
    // canon's claims in order to refuse them, so it is not scanned for these)
    for (const rel of NEW.slice(0, 17)) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /Ramesh|Hetal|Suresh|Popat|Vithal|Jayesh|Meera|Savita|\bBen\s|Bhai|Kotak|\bSBI\b|Anand|Mehsana|Junagadh|LA-2026|LN-2026|KCC-2026|LTX-|CASE-0041|XXXX-XXXX|\bAJ\b|RBI ref|\+91/.test(src)]).toEqual([rel, false]);
      // and none of them prints a borrower, a repayment channel, a bank account, a drawl narrative or a money-record anchor
      expect([rel, /borrowerUserId|borrower_user_id|repaymentChannel|repayment_channel|bankAccount|bank_account|narrative|ledgerTxnId|ledger_txn_id|originationFeeTxnId|origination_fee_txn_id/i.test(src)]).toEqual([rel, false]);
    }
  });
  // PC-56 PARTNER-4c · the two KCC views and the two KCC pages, scanned the same way — plus the canon's person, her crops, her account
  // number and every field of the drawl ledger, none of which may appear in a view or a page.
  it('PC-56 PARTNER-4c · the four KCC files exist, are scanned, and carry no platform name, mailbox, domain, canon institution, person, crop, account number or ledger field', () => {
    const NEW_4C = ['components/partner4/LenderKccView.tsx', 'components/partner4/LenderKccDrawlsView.tsx',
      'app/lender/kcc/[id]/page.tsx', 'app/lender/kcc/[id]/drawls/page.tsx'];
    const all = files().map((f) => path.relative(SRC, f));
    expect(NEW_4C.length).toBe(4);
    for (const rel of NEW_4C) {
      expect([rel, all.includes(rel)]).toEqual([rel, true]);
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800|Saurashtra|Gramin|Bharat Krishi/i.test(src)]).toEqual([rel, false]);
      expect([rel, /Jayesh|Ramesh|Hetal|Suresh|Popat|Vithal|Meera|Savita|\bBen\s|Bhai|Kotak|\bSBI\b|Anand|Mehsana|Junagadh|KCC-2026|LA-2026|LN-2026|LTX-|XXXX-XXXX|\bAJ\b|RBI ref|\+91|cotton|cumin|\bacres?\b/i.test(src)]).toEqual([rel, false]);
      expect([rel, /borrowerUserId|borrower_user_id|narrative|destinationKind|destination_kind|purposeCheck|purpose_check|balanceAfter|balance_after|accrualBasis|accrual_basis|entryKind|entry_kind|ledgerTxnId|ledger_txn_id/i.test(src)]).toEqual([rel, false]);
    }
  });
  it('the lending group\'s items read their labels from i18n, never a literal — and the nav never names the canon\'s institution', () => {
    const nav = fs.readFileSync(path.join(SRC, 'features', 'nav', 'nav-model.ts'), 'utf8');
    expect(nav).toContain("labelKey: 'partner4.nav.loanQueue'");
    expect(nav).toContain("labelKey: 'partner4.nav.portfolio'");
    expect(nav).toContain("labelKey: 'partner4.nav.payouts'");
    expect(nav).toContain("labelKey: 'partner4.nav.repayments'");
    expect(/Saurashtra|Gramin|\bAJ\b|RBI ref/.test(nav)).toBe(false);
  });
});

describe('PC-56 PARTNER-5a · brand guard over the arrears pages (founder 5a-8: the platform\'s mark + the lender\'s own name; survey F-16)', () => {
  // the file floor: every components/partner5/*.tsx, the two pages and every features/partner5/* module — found on disk, not listed by hand,
  // so a new file in any of those folders is scanned without anyone remembering to add it
  const DIRS = [path.join(SRC, 'components', 'partner5'), path.join(SRC, 'features', 'partner5'),
    path.join(SRC, 'app', 'lender', 'portfolio', 'aging'), path.join(SRC, 'app', 'lender', 'portfolio', 'writeoffs'),
    // PC-56 PARTNER-5b · the collections tree (W219 / W220 / W221) joins the floor, recursively
    path.join(SRC, 'app', 'lender', 'collections'),
    // PC-56 PARTNER-5c · NAMED UPDATE: the SLA page (W214) joins the floor
    path.join(SRC, 'app', 'lender', 'reports')];
  const mine = files().filter((f) => DIRS.some((d) => f.startsWith(d + path.sep))).map((f) => path.relative(SRC, f)).sort();
  it('the floor holds: six views, five pages, two feature modules — all scanned (PARTNER-5b: + three views, three pages)', () => {
    expect(mine).toEqual(expect.arrayContaining(['components/partner5/LenderAgingView.tsx', 'components/partner5/LenderChain5.tsx',
      'components/partner5/LenderWriteoffsView.tsx', 'app/lender/portfolio/aging/page.tsx', 'app/lender/portfolio/writeoffs/page.tsx',
      'features/partner5/figures.ts', 'features/partner5/refusals.ts',
      // PC-56 PARTNER-5b
      'components/partner5/LenderCollectionsView.tsx', 'components/partner5/LenderCollectionsCaseView.tsx', 'components/partner5/LenderRestructureView.tsx',
      'app/lender/collections/page.tsx', 'app/lender/collections/[id]/page.tsx', 'app/lender/collections/[id]/restructure/page.tsx',
      // PC-56 PARTNER-5c
      'components/partner5/LenderReportsView.tsx', 'app/lender/reports/page.tsx']));
    expect(mine.length).toBeGreaterThanOrEqual(15);
  });
  it('none carries the platform\'s name, a mailbox, a domain, or the canon\'s institution, person, place, phone, loan / case reference, scheme, rainfall figure or sha fragment', () => {
    for (const rel of mine) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800/i.test(src)]).toEqual([rel, false]);
      expect([rel, /Saurashtra|Gramin|RBI ref|••4471|Bharat D|\+91|95•••|\bAJ\b|LN-20\d\d|CASE-0\d|PMFBY|rainfall|61% of normal|FPO office|2b1f|88c4|9e07|41aa/i.test(src)]).toEqual([rel, false]);
    }
  });
  it('the views and pages name no borrower, cause, actor or date of write-off field', () => {
    for (const rel of mine.filter((r) => !r.startsWith('features/'))) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /borrowerUserId|borrower_user_id|borrowerName|writeOffReason|write_off_reason|writtenOffBy|writtenOffAt|caseRef|case_ref|proposedBy|checkerId|tenantId/.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 PARTNER-6a · brand guard over the settlement pages (the platform\'s mark + the insurer\'s own name; survey F-10)', () => {
  // the file floor: every components/partner6/*, every features/partner6/* module and the app/insurer/settlements tree — found on disk, not
  // listed by hand, so a new file in any of those folders is scanned without anyone remembering to add it
  const DIRS = [path.join(SRC, 'components', 'partner6'), path.join(SRC, 'features', 'partner6'), path.join(SRC, 'app', 'insurer', 'settlements')];
  const mine = files().filter((f) => DIRS.some((d) => f.startsWith(d + path.sep))).map((f) => path.relative(SRC, f)).sort();
  it('the floor holds: three components, two feature modules, two pages — all scanned', () => {
    expect(mine).toEqual(expect.arrayContaining(['components/partner6/InsurerChain6.tsx', 'components/partner6/InsurerSettlementsView.tsx',
      'components/partner6/InsurerSettlementView.tsx', 'features/partner6/figures.ts', 'features/partner6/refusals.ts',
      'app/insurer/settlements/page.tsx', 'app/insurer/settlements/[id]/page.tsx']));
    expect(mine.length).toBeGreaterThanOrEqual(7);
  });
  it('none carries the platform\'s name, a mailbox, a domain, or a canon institution, person, place, phone, claim reference, account tail, payout id or avatar', () => {
    for (const rel of mine) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800/i.test(src)]).toEqual([rel, false]);
      expect([rel, /Bharat Krishi|IRDAI ref|••118|Saurashtra|Gramin|Kesar|Bhavna|Rathod|R\. Shah|M\. Iyer|Priti|Mehta|Vanthali|Bhesan|\+91|CLM-20|••4482|••1108|••2764|7741|કેસર/i.test(src)]).toEqual([rel, false]);
    }
    // the views and pages (not the registry, which NAMES the canon's claims to refuse them) carry no avatar and no honorific either
    for (const rel of mine.filter((r) => !r.startsWith('features/'))) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /\bPM\b|\bAJ\b|\bBen\s|Bhai|\bDr\./.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 PARTNER-6b · brand guard over the consents and regulatory pages (the platform\'s mark + the lender\'s own name; survey F-10)', () => {
  // the floor: the two new app trees (found on disk, recursively) + every components/partner6 / features/partner6 module (already 6a's floor,
  // re-scanned here for the lender persona's canon names)
  const DIRS = [path.join(SRC, 'app', 'lender', 'consents'), path.join(SRC, 'app', 'lender', 'reports', 'regulatory'),
    path.join(SRC, 'components', 'partner6'), path.join(SRC, 'features', 'partner6')];
  const mine = files().filter((f) => DIRS.some((d) => f.startsWith(d + path.sep))).map((f) => path.relative(SRC, f)).sort();
  it('the floor holds: two pages, three new components (with 6a\'s), the two feature modules — all scanned', () => {
    expect(mine).toEqual(expect.arrayContaining(['app/lender/consents/page.tsx', 'app/lender/reports/regulatory/page.tsx',
      'components/partner6/LenderConsentsView.tsx', 'components/partner6/LenderRegulatoryView.tsx', 'components/partner6/LenderChain6.tsx',
      'features/partner6/refusals.ts', 'features/partner6/figures.ts']));
    expect(mine.length).toBeGreaterThanOrEqual(10);
  });
  it('none carries the platform\'s name, a mailbox, a domain, or a canon institution, farmer, phone, application reference, regulator reference, avatar or sha fragment', () => {
    for (const rel of mine) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800/i.test(src)]).toEqual([rel, false]);
      expect([rel, /Saurashtra|Gramin|RBI ref|••4471|Popat|Ramesh P|Meera|\+91|94•••|98•••|97•••|LA-20\d\d|7a91|44c2|c204|18ef|e442|90b1|6,84,20,000|1,148/i.test(src)]).toEqual([rel, false]);
    }
    // the views and pages (not the registry, which NAMES the canon's claims to refuse them) carry no avatar, no honorific, no regulator acronym
    for (const rel of mine.filter((r) => !r.startsWith('features/') && /Lender|lender\//.test(r))) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /\bAJ\b|\bBen\s|Bhai|\bRBI\b|\bPSL\b|\bNWR\b/.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 PARTNER-6c · brand guard over the account notification pages (the platform\'s mark + the partner\'s own name; survey F-10)', () => {
  // the floor: the new app tree `app/account/notifications/**` (found on disk, recursively — the Server Action included) + every
  // components/partner6 / features/partner6 module (6a's and 6b's floor, re-scanned here for the insurer persona's notification canon names)
  const DIRS = [path.join(SRC, 'app', 'account', 'notifications'), path.join(SRC, 'components', 'partner6'), path.join(SRC, 'features', 'partner6')];
  const mine = files().filter((f) => DIRS.some((d) => f.startsWith(d + path.sep))).map((f) => path.relative(SRC, f)).sort();
  it('the floor holds: two pages, the Server Action, three new components (with 6a\'s and 6b\'s), the three feature modules — all scanned', () => {
    expect(mine).toEqual(expect.arrayContaining(['app/account/notifications/page.tsx', 'app/account/notifications/preferences/page.tsx',
      'app/account/notifications/preferences/actions.ts', 'components/partner6/AccountNotificationsView.tsx', 'components/partner6/AccountNotificationPrefsView.tsx',
      'components/partner6/AccountChain6.tsx', 'features/partner6/refusals.ts', 'features/partner6/figures.ts', 'features/partner6/language.ts']));
    expect(mine.length).toBeGreaterThanOrEqual(15);
  });
  it('none carries the platform\'s name, a mailbox, a domain, or a canon institution, person, place, phone, claim reference, account tail, payout id, sha fragment or avatar', () => {
    for (const rel of mine) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/@krishalaya\/[a-z0-9-]+/g, '');
      for (const lit of LITERALS) expect([rel, lit, src.includes(lit)]).toEqual([rel, lit, false]);
      expect([rel, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|in|org|net|co)\b|krishalaya\.(in|com)|mailto:[a-z]|1800/i.test(src)]).toEqual([rel, false]);
      expect([rel, /Bharat Krishi|IRDAI ref|Saurashtra|Gramin|Priti|Mehta|Bhavna|Rathod|Kesar|Vanthali|Bhesan|\+91|CLM-20|7741/i.test(src)]).toEqual([rel, false]);
    }
    // the 6c views, pages and the act (not the registry, which NAMES the canon's claims to refuse them) carry no avatar, no honorific
    for (const rel of mine.filter((r) => /Account|account\//.test(r))) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /\bPM\b|\bAJ\b|\bBen\s|Bhai|\bDr\./.test(src)]).toEqual([rel, false]);
    }
  });
});
