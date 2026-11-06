// apps/web-ops/src/test/ops1c-pages.spec.ts · PC-56 OPS-1c — SOURCE ASSERTIONS for the kiosk pages:
//   E11 · the READLESS assertion: the HONEST pages (W382–W388) and the step / summary views import no API client, call no SDK method and fetch
//         nothing — with the POSITIVE CONTROL FIRST: the same pattern fires on W380's page (which reads), W389's page and W381's create act, so
//         an empty result cannot pass silently;
//   E2  · `/kiosk` answers a REAL 307 to /kiosk/home (next.config.js `redirects()` contains OPS1C_REDIRECTS, permanent: false) and the OW-1 page
//         is gone; every sidebar entry, every kiosk step link and every 1c route constant points at a page that exists;
//   Q9-A / E4 · the phone never enters a URL: the create act reads it from the posted form and every redirect carries `act` and a reason code
//         only; the page hands the form a server action (a POST), never a string URL;
//   Q4-A′ · no kiosk page or view reads a commission plan or names an amount;
//   E8  · the superseded OW-1 `kiosk.*` keys are gone and no source still asks for one.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OPS1C_REDIRECTS, KIOSK_STEPS } from '../features/ops1/kiosk';
import { en } from '../i18n/en';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/** A read (or write) of the platform from a page or view — the 1b pattern, unchanged. */
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.ambassadors\.|\.labour\.|@krishalaya\/sdk-js['"];?\s*$/m;

const HONEST_PAGES = ['app/kiosk/profile/page.tsx', 'app/kiosk/land-crops/page.tsx', 'app/kiosk/kyc/page.tsx', 'app/kiosk/bank/page.tsx', 'app/kiosk/first-listing/page.tsx',
  'app/kiosk/schemes/page.tsx', 'app/kiosk/summary/page.tsx'];

describe('PC-56 OPS-1c · E11 · the honest kiosk pages read nothing (positive control first)', () => {
  it('CONTROL: the pattern fires on the pages that DO talk to the platform — W380\'s read, W389\'s read, W381\'s create act', () => {
    for (const rel of ['app/kiosk/home/page.tsx', 'app/kiosk/ambassador/page.tsx', 'app/kiosk/session-start/actions.ts']) expect([rel, READS.test(code(read(rel)))]).toEqual([rel, true]);
  });
  it('then finds nothing in the seven HONEST pages (W382–W388) or in the views (the views never read — the pages do)', () => {
    for (const rel of [...HONEST_PAGES, 'components/ops1/KioskViews.tsx']) expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('W381\'s PAGE reads nothing before the act either (whether she may create is the server\'s answer to the act)', () => {
    expect(READS.test(code(read('app/kiosk/session-start/page.tsx')))).toBe(false);
  });
});

describe('PC-56 OPS-1c · E2 · routes, the 307 and links', () => {
  it('next.config.js redirects() carries OPS1C_REDIRECTS as a 307 (permanent: false); the OW-1 page and action are gone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const r = await cfg.redirects();
    expect(r.filter((x) => x.source === '/kiosk')).toEqual(OPS1C_REDIRECTS.map((x) => ({ ...x, permanent: false })));
    for (const rel of ['app/kiosk/page.tsx', 'app/kiosk/actions.ts']) expect([rel, fs.existsSync(path.join(SRC, rel))]).toEqual([rel, false]);
  });
  it('every kiosk step and every 1c route constant is a page that exists (W381–W389, and W380)', () => {
    for (const s of KIOSK_STEPS) expect([s.href, fs.existsSync(path.join(SRC, 'app', s.href, 'page.tsx'))]).toEqual([s.href, true]);
    const feat = read('features/ops1/kiosk.ts');
    const consts = Array.from(feat.matchAll(/export const KIOSK_[A-Z]+ = '([^']+)'/g)).map((m) => m[1]);
    expect(consts.length).toBe(10);
    for (const p of consts) expect([p, fs.existsSync(path.join(SRC, 'app', p, 'page.tsx'))]).toEqual([p, true]);
    expect(KIOSK_STEPS.map((s) => s.href)).toEqual(consts.filter((p) => p !== '/kiosk/home'));
  });
  it('the sidebar links the kiosk at /kiosk/home (never the old /kiosk), with the create page and the earnings page under it', () => {
    const hrefs = Array.from(read('components/Sidebar.tsx').matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    for (const h of ['/kiosk/home', '/kiosk/session-start', '/kiosk/ambassador']) expect(hrefs).toContain(h);
    expect(hrefs).not.toContain('/kiosk');
    expect(read('app/dashboard/page.tsx')).toContain("{ key: 'kiosk', href: '/kiosk/home' }");
  });
});

describe('PC-56 OPS-1c · Q9-A / E4 · the phone never enters a URL', () => {
  const act = code(read('app/kiosk/session-start/actions.ts'));
  it('the create act is a server action that reads the phone from the posted form', () => {
    expect(read('app/kiosk/session-start/actions.ts').startsWith("'use server';")).toBe(true);
    expect(act).toMatch(/formData\.get\('phone'\)/);
  });
  it('every redirect in the act carries only `act` and a reason code — never the phone, the name or the language', () => {
    const redirects = Array.from(act.matchAll(/redirect\(([^;]+)\);/g)).map((m) => m[1]);
    expect(redirects.length).toBe(2);
    for (const r of redirects) expect([r, /phone|fullName|languageCode|built\.value/.test(r)]).toEqual([r, false]);
    expect(act).toMatch(/redirect\(`\$\{KIOSK_START\}\?act=failure&reason=\$\{encodeURIComponent\(reason\)\}`\)/);
    expect(act).toMatch(/redirect\(`\$\{KIOSK_START\}\?act=success`\)/);
  });
  it('the page hands the form the server action (a POST) in both the page and the confirm state, never a string address', () => {
    const page = code(read('app/kiosk/session-start/page.tsx'));
    expect(Array.from(page.matchAll(/<KioskStartView [^>]*action=\{createAccountAction\}/g)).length).toBe(2);
    expect(page).not.toMatch(/action="/);
  });
  it('the failure reason in the URL is one of ours (never echoed): the failure view parses it through parseKioskReason', () => {
    expect(code(read('app/kiosk/session-start/page.tsx'))).toMatch(/act === 'failure'\) return <KioskFailureView t=\{t\} searchParams=\{searchParams\} \/>/);
    expect(code(read('components/ops1/KioskViews.tsx'))).toMatch(/const reason = parseKioskReason\(searchParams\);/);
  });
});

describe('PC-56 OPS-1c · Q4-A′ · no plan read, no amount on the summary', () => {
  it('no kiosk page, action or view reads a commission plan; the summary view prints only its four keys', () => {
    for (const rel of [...HONEST_PAGES, 'app/kiosk/home/page.tsx', 'app/kiosk/ambassador/page.tsx', 'app/kiosk/session-start/actions.ts', 'components/ops1/KioskViews.tsx']) {
      expect([rel, /\.plans\(|commission|planId|rate_bps|amount_minor/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 OPS-1c · E8 · the superseded OW-1 kiosk keys', () => {
  it('no `kiosk.` key remains in the catalogue, and no source asks for one', () => {
    expect(Object.keys(en).filter((k) => k.startsWith('kiosk.'))).toEqual([]);
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['test', 'test-render', 'i18n'].includes(e.name)) walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    for (const f of walk(SRC)) expect([path.relative(SRC, f), /t\(\s*[`'"]kiosk\./.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
  });
});
