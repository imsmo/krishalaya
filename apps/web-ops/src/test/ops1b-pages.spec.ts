// apps/web-ops/src/test/ops1b-pages.spec.ts · PC-56 OPS-1b — SOURCE ASSERTIONS for the AePS / biometric pages:
//   E11 · the READLESS assertion: the HONEST pages (W390, W393, W397, W398, W399) and the views they render import no API client, call no SDK
//         method and fetch nothing — with the POSITIVE CONTROL FIRST: the same pattern fires on W392's page (a read) and W391's action (a write),
//         so an empty result cannot pass silently;
//   E2  · the old OW-5 addresses answer REAL 307s (next.config.js `redirects()` equals OPS1B_REDIRECTS, permanent: false) and the old pages are gone;
//         every sidebar entry, and every 1b link, points at a route that exists as a page;
//   Q7-A · no web-ops source sends an Aadhaar or customer field to the AePS record.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OPS1B_REDIRECTS } from '../features/ops1/aeps';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/** A read (or write) of the platform from a page or view. */
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.ambassadors\.|\.labour\.|@krishalaya\/sdk-js['"];?\s*$/m;

const HONEST_PAGES = ['app/aeps/home/page.tsx', 'app/aeps/receipt/page.tsx', 'app/attendance/face-enroll/page.tsx', 'app/attendance/face-attendance/page.tsx', 'app/canon/biometric/page.tsx'];
const HONEST_VIEWS = ['components/ops1/AepsViews.tsx', 'components/ops1/FaceViews.tsx'];

describe('PC-56 OPS-1b · E11 · the honest pages read nothing (positive control first)', () => {
  it('CONTROL: the pattern fires on the pages that DO talk to the platform — W392\'s read, W391\'s record act, /payout\'s read', () => {
    for (const rel of ['app/aeps/exceptions/page.tsx', 'app/aeps/withdrawal/actions.ts', 'app/payout/page.tsx']) expect([rel, READS.test(code(read(rel)))]).toEqual([rel, true]);
  });
  it('then finds nothing in the five HONEST pages or the views they render', () => {
    for (const rel of [...HONEST_PAGES, ...HONEST_VIEWS]) expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('W391\'s PAGE reads nothing before the act either (whether she may record is the server\'s answer to the act)', () => {
    expect(READS.test(code(read('app/aeps/withdrawal/page.tsx')))).toBe(false);
  });
});

describe('PC-56 OPS-1b · E2 · routes, 307s and links', () => {
  it('next.config.js redirects() equals OPS1B_REDIRECTS, each a 307 (permanent: false); the old money pages are gone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const r = await cfg.redirects();
    expect(r.filter((x) => x.source.startsWith('/money'))).toEqual(OPS1B_REDIRECTS.map((x) => ({ ...x, permanent: false })));
    for (const rel of ['app/money/page.tsx', 'app/money/actions.ts', 'app/money/oversight/page.tsx']) expect([rel, fs.existsSync(path.join(SRC, rel))]).toEqual([rel, false]);
  });
  it('every sidebar entry links to a route that exists as a page; AePS and Attendance are there, /money is not', () => {
    const nav = read('components/Sidebar.tsx');
    const hrefs = Array.from(nav.matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    for (const h of hrefs) expect([h, fs.existsSync(path.join(SRC, 'app', h, 'page.tsx'))]).toEqual([h, true]);
    for (const h of ['/aeps/home', '/aeps/withdrawal', '/aeps/exceptions', '/attendance/face-enroll', '/canon/biometric']) expect(hrefs).toContain(h);
    expect(hrefs).not.toContain('/money');
  });
  it('every link a 1b view draws points at a page that exists (W390 → W391/W392/W393/W399; attendance → W399)', () => {
    const feat = read('features/ops1/aeps.ts');
    for (const [, path_] of Array.from(feat.matchAll(/export const (?:AEPS_HOME|AEPS_RECORD|AEPS_EXCEPTIONS|AEPS_RECEIPT|FACE_ENROLL|FACE_ATTENDANCE|BIOMETRIC_CANON) = '([^']+)'/g))) {
      expect([path_, fs.existsSync(path.join(SRC, 'app', path_, 'page.tsx'))]).toEqual([path_, true]);
    }
  });
  it('the dashboard lists the AePS log and Attendance at their new homes, never /money or "receipts"', () => {
    const dash = read('app/dashboard/page.tsx');
    expect(dash).toContain("{ key: 'aeps', href: '/aeps/home' }"); expect(dash).toContain("{ key: 'attendance', href: '/attendance/face-enroll' }");
    expect(code(dash)).not.toContain("'/money'");
  });
});

describe('PC-56 OPS-1b · Q7-A · nothing in web-ops sends an Aadhaar digit or a customer link to the record', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['test', 'test-render', 'i18n'].includes(e.name)) walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  it('no app / component / feature source names aadhaarLast4 or customerUserId outside a comment', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) expect([path.relative(SRC, f), /aadhaarLast4|customerUserId/.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
    // control: the pattern would see the field if it were there
    expect(/aadhaarLast4|customerUserId/.test("const v = { aadhaarLast4: '1' }")).toBe(true);
  });
});
