// apps/web-partner/src/test/readless.spec.ts · PC-56 PARTNER-5a (survey E12, the 4c precedent) — THE POSITIVE CONTROL of the shared
// readlessness ban set (test/readless.ts). The aging page (W223) READS — `partner.loans.dpd()` and `partner.loans.counts()` through
// `partnerClient()` — so the ban set MUST fire on it, and fire for the reasons it reads. PARTNER-5b adds the other half: the same set finds
// NOTHING on the collections, case and restructure pages. A ban list proven only by finding nothing is not a test.
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
