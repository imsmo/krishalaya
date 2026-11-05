// apps/web-partner/src/test/readless.spec.ts · PC-56 PARTNER-5a (survey E12, the 4c precedent) — THE POSITIVE CONTROL of the shared
// readlessness ban set (test/readless.ts). The aging page (W223) READS — `partner.loans.dpd()` and `partner.loans.counts()` through
// `partnerClient()` — so the ban set MUST fire on it, and fire for the reasons it reads. PC-56 PARTNER-5b adds the other half: the same set finds
// NOTHING on the collections, case and restructure pages and their three views. A ban list proven only by finding nothing is not a test.
import { READLESS_BANS, readCode, readlessFires } from './readless';

const AGING_PAGE = 'app/lender/portfolio/aging/page.tsx';
const WRITEOFFS_PAGE = 'app/lender/portfolio/writeoffs/page.tsx';

describe('PC-56 PARTNER-5a · the readlessness ban set fires on a page that reads (positive control)', () => {
  it('the ban set is the five the brief names, each with its reason', () => {
    expect(READLESS_BANS.map(([n]) => n)).toEqual(['partnerClient(', 'partner.loans.', '.request(', 'fetch(', 'dynamic import(']);
    for (const [name, re, why] of READLESS_BANS) expect([name, re instanceof RegExp, why.length > 20]).toEqual([name, true, true]);
  });
  it('it FIRES on the aging page: the client and the book resource it reads through', () => {
    const code = readCode(AGING_PAGE);
    expect(code.length).toBeGreaterThan(400);                                   // the file was really read, not silently empty
    expect(code).toMatch(/partner\.loans\.dpd\(\)/);
    expect(code).toMatch(/partner\.loans\.counts\(\)/);
    expect(readlessFires(AGING_PAGE)).toEqual(expect.arrayContaining(['partnerClient(', 'partner.loans.']));
    // and it fires for those two reasons only — the page makes no raw request, no fetch and no dynamic import
    expect(readlessFires(AGING_PAGE)).toEqual(['partnerClient(', 'partner.loans.']);
  });
  it('the comment stripping is not what makes it fire: a header that only DISCUSSES a read does not count', () => {
    expect(READLESS_BANS.some(([, re]) => re.test('// this page calls partnerClient().partner.loans.dpd()'.replace(/^\s*\/\/.*$/, '')))).toBe(false);
    expect(READLESS_BANS.some(([, re]) => re.test('const x = await partnerClient().partner.loans.dpd();'))).toBe(true);
  });
  it('and it fires on the write-offs page too (the second positive control)', () => {
    expect(readlessFires(WRITEOFFS_PAGE)).toEqual(['partnerClient(', 'partner.loans.']);
    expect(readCode(WRITEOFFS_PAGE)).toMatch(/partner\.loans\.list\(\{ status: 'written_off'/);
  });
});

// PC-56 PARTNER-5b (founder 5b-1, survey E3 / E12) — THE "FINDS NOTHING" HALF. The three honest pages (W219 / W220 / W221) and the views they
// mount read NOTHING: the ban set that fires on the aging page above finds nothing here. And the calls these pages DO make are asserted by
// name — `requirePartner`, `lenderGate`, `lenderSwitches` (the public flag map), `getTranslator`, `chain5State` — with nothing imported from
// lib/api-client or the SDK at all. M3 (a `partnerClient()` read inserted into the W219 page) kills here, while the control above still fires.
const HONEST_PAGES = ['app/lender/collections/page.tsx', 'app/lender/collections/[id]/page.tsx', 'app/lender/collections/[id]/restructure/page.tsx'];
const HONEST_VIEWS = ['components/partner5/LenderCollectionsView.tsx', 'components/partner5/LenderCollectionsCaseView.tsx', 'components/partner5/LenderRestructureView.tsx'];

describe('PC-56 PARTNER-5b · the readlessness ban set finds NOTHING on the three honest collections pages (with the control still firing)', () => {
  it('the positive control still fires on the aging page in this same run', () => {
    expect(readlessFires(AGING_PAGE)).toEqual(['partnerClient(', 'partner.loans.']);
  });
  it.each([...HONEST_PAGES, ...HONEST_VIEWS].map((f) => [f]))('%s: no ban fires', (rel) => {
    const code = readCode(rel);
    expect(code.length).toBeGreaterThan(400);                                   // really read
    expect([rel, readlessFires(rel)]).toEqual([rel, []]);
  });
  it.each(HONEST_PAGES.map((f) => [f]))('%s: the calls it makes, BY NAME — and nothing from lib/api-client, the SDK or the mailbox', (rel) => {
    const code = readCode(rel);
    expect(code).toMatch(/await requirePartner\(\);/);
    expect(code).toMatch(/await lenderGate\(\);/);
    expect(code).toMatch(/state=\{await lenderSwitches\(\)\}/);
    expect(code).toMatch(/const t = getTranslator\(\);/);
    expect(code).toMatch(/chain5State\('/);
    // every awaited call is one of the three named
    expect([...new Set([...code.matchAll(/await\s+([A-Za-z_$][\w$.]*)\s*\(/g)].map((m) => m[1]))].sort()).toEqual(['lenderGate', 'lenderSwitches', 'requirePartner']);
    // the imports: session, i18n, the lender gate + switches, the partner5 views / chain / registry / figures — nothing else
    const from = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1].replace(/^(\.\.\/)+/, ''));
    for (const f of from) expect([rel, f, /^(next|lib\/session|lib\/i18n|lib\/lender|components\/partner5\/\w+|features\/partner5\/(refusals|figures))$/.test(f)]).toEqual([rel, f, true]);
    expect(/api-client|@krishalaya\/sdk-js|partners-mailbox|partnerClient|anonClient/.test(code)).toBe(false);
    // the lender lib's imports used here are the gate and the switches only (never lenderFailure: there is no read to fail)
    expect(code).toMatch(/import \{ lenderGate, lenderSwitches \} from '[./]+lib\/lender';/);
  });
  it('the views import no client either, and mount no read of their own', () => {
    for (const rel of HONEST_VIEWS) {
      const code = readCode(rel);
      expect([rel, /api-client|@krishalaya\/sdk-js|lib\/lender|lib\/session|async function|await /.test(code)]).toEqual([rel, false]);
    }
  });
});

// PC-56 PARTNER-6a (founder 6a-2, brief E7 / survey E11) — W261 `/insurer/settlements/[id]` and its view read NOTHING: the same ban set finds
// nothing there, while it still FIRES on the aging page AND on W260 `/insurer/settlements` — the second positive control, a page of THIS wave
// that does read (`partnerClient().partner.insurance.claims.counts()`). The calls W261's page makes are asserted BY NAME: `requirePartner`,
// `insurerGate`, `insurerSwitches` (the public flag map), `getTranslator`, `chain6State`. M5 (a `partnerClient(` read inserted into the W261
// page) kills here while both controls still fire.
const SETTLEMENTS_PAGE = 'app/insurer/settlements/page.tsx';
const SETTLEMENT_PAGE = 'app/insurer/settlements/[id]/page.tsx';
const SETTLEMENT_VIEW = 'components/partner6/InsurerSettlementView.tsx';

describe('PC-56 PARTNER-6a · the ban set finds NOTHING on W261, and fires on both positive controls (aging and W260)', () => {
  it('positive control 1: it still fires on the aging page in this same run', () => {
    expect(readlessFires(AGING_PAGE)).toEqual(['partnerClient(', 'partner.loans.']);
  });
  it('positive control 2: it FIRES on W260 — the counts read through the partner client — and for that reason only', () => {
    const code = readCode(SETTLEMENTS_PAGE);
    expect(code.length).toBeGreaterThan(400);
    expect(code).toMatch(/partnerClient\(\)\.partner\.insurance\.claims\.counts\(\)/);
    expect(readlessFires(SETTLEMENTS_PAGE)).toEqual(['partnerClient(']);
  });
  it.each([[SETTLEMENT_PAGE], [SETTLEMENT_VIEW]])('%s: no ban fires', (rel) => {
    const code = readCode(rel);
    expect(code.length).toBeGreaterThan(400);
    expect([rel, readlessFires(rel)]).toEqual([rel, []]);
  });
  it('W261\'s page: the calls it makes, BY NAME — and nothing from lib/api-client, the SDK or the mailbox', () => {
    const code = readCode(SETTLEMENT_PAGE);
    expect(code).toMatch(/await requirePartner\(\);/);
    expect(code).toMatch(/await insurerGate\(\);/);
    expect(code).toMatch(/state=\{await insurerSwitches\(\)\}/);
    expect(code).toMatch(/const t = getTranslator\(\);/);
    expect(code).toMatch(/chain6State\('settlement_detail_act'/);
    expect([...new Set([...code.matchAll(/await\s+([A-Za-z_$][\w$.]*)\s*\(/g)].map((m) => m[1]))].sort()).toEqual(['insurerGate', 'insurerSwitches', 'requirePartner']);
    const from = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1].replace(/^(\.\.\/)+/, ''));
    for (const f of from) expect([f, /^(next|lib\/session|lib\/i18n|lib\/insurer|components\/partner6\/\w+|features\/partner6\/(refusals|figures))$/.test(f)]).toEqual([f, true]);
    expect(/api-client|@krishalaya\/sdk-js|partners-mailbox|partnerClient|anonClient|insurerFailure/.test(code)).toBe(false);
    expect(code).toMatch(/import \{ insurerGate, insurerSwitches \} from '[./]+lib\/insurer';/);
  });
  it('the W261 view imports no client either, and mounts no read of its own', () => {
    const code = readCode(SETTLEMENT_VIEW);
    expect(/api-client|@krishalaya\/sdk-js|lib\/insurer|lib\/session|async function|await /.test(code)).toBe(false);
  });
});

// PC-56 PARTNER-6b (founder 6b-1 / 6b-3, brief E2) — W213 `/lender/consents` and W224 `/lender/reports/regulatory` and their views read
// NOTHING: the same ban set finds nothing there, while it still FIRES on both positive controls (the aging page and W260). The calls the two
// pages make are asserted BY NAME — `requirePartner`, `lenderGate`, `lenderSwitches` (the public flag map), `partnersMailbox` (the
// platform's published fact), `getTranslator`, `chain6State` — and nothing comes from lib/api-client or the SDK. M3 (a `partnerClient()`
// read inserted into the W213 page) kills here while both controls still fire.
const CONSENTS_PAGE = 'app/lender/consents/page.tsx';
const REGULATORY_PAGE = 'app/lender/reports/regulatory/page.tsx';
const SIX_B_VIEWS = ['components/partner6/LenderConsentsView.tsx', 'components/partner6/LenderRegulatoryView.tsx', 'components/partner6/LenderChain6.tsx'];

describe('PC-56 PARTNER-6b · the ban set finds NOTHING on W213 and W224, and fires on both positive controls (aging and W260)', () => {
  it('positive control 1: it still fires on the aging page in this same run', () => {
    expect(readlessFires(AGING_PAGE)).toEqual(['partnerClient(', 'partner.loans.']);
  });
  it('positive control 2: it still fires on W260, a page that reads', () => {
    expect(readlessFires(SETTLEMENTS_PAGE)).toEqual(['partnerClient(']);
  });
  it.each([[CONSENTS_PAGE], [REGULATORY_PAGE], ...SIX_B_VIEWS.map((f) => [f])])('%s: no ban fires', (rel) => {
    const code = readCode(rel);
    expect(code.length).toBeGreaterThan(400);
    expect([rel, readlessFires(rel)]).toEqual([rel, []]);
  });
  it.each([[CONSENTS_PAGE, 'consents_export', 'consents_act'], [REGULATORY_PAGE, 'regulatory_form', 'regulatory_act']])('%s: the calls it makes, BY NAME, chain states FIRST — nothing from lib/api-client or the SDK', (rel, first, second) => {
    const code = readCode(rel);
    expect(code).toMatch(/await requirePartner\(\);/);
    expect(code).toMatch(/await lenderGate\(\);/);
    expect(code).toMatch(/state=\{await lenderSwitches\(\)\}/);
    expect(code).toMatch(/const t = getTranslator\(\);/);
    const at = (s: string) => code.indexOf(s);
    expect(at(`chain6State('${first}'`)).toBeGreaterThan(at('await lenderGate();'));
    expect(at(`chain6State('${second}'`)).toBeGreaterThan(at(`chain6State('${first}'`));
    expect(at('await lenderSwitches()')).toBeGreaterThan(at(`chain6State('${second}'`));
    expect([...new Set([...code.matchAll(/await\s+([A-Za-z_$][\w$.]*)\s*\(/g)].map((m) => m[1]))].sort()).toEqual(['lenderGate', 'lenderSwitches', 'partnersMailbox', 'requirePartner']);
    const from = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1].replace(/^(\.\.\/)+/, ''));
    for (const f of from) expect([rel, f, /^(next|lib\/session|lib\/i18n|lib\/lender|lib\/partners-mailbox|components\/partner6\/\w+|features\/partner6\/refusals)$/.test(f)]).toEqual([rel, f, true]);
    expect(/api-client|@krishalaya\/sdk-js|partnerClient|anonClient|lenderFailure/.test(code)).toBe(false);
    expect(code).toMatch(/import \{ lenderGate, lenderSwitches \} from '[./]+lib\/lender';/);
    expect(code).toContain("export const dynamic = 'force-dynamic'");
    expect(code).toContain('robots: { index: false, follow: false }');
  });
  it('the views and the chain component import no client, no gate, no session and mount no read of their own', () => {
    for (const rel of SIX_B_VIEWS) {
      const code = readCode(rel);
      expect([rel, /api-client|@krishalaya\/sdk-js|lib\/lender|lib\/session|lib\/partners-mailbox|async function|await /.test(code)]).toEqual([rel, false]);
    }
  });
});
