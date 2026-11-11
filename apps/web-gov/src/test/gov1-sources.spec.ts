// apps/web-gov/src/test/gov1-sources.spec.ts · PC-56 GOV-1a — SOURCE ASSERTIONS (survey_gov1.md §7 "Pure unit specs", brief §C):
//   • the console signs in ONLY through the gov realm: no tenant `auth.*` call anywhere in src (no `auth.verifyOtp`, `auth.requestOtp`,
//     `auth.refresh`, `auth.me`), every SDK call goes through `.gov.` (or the public flag map), no tenant id, no `x-tenant-id`;
//   • the sidebar is drawn from the API-verified gate, never from a cookie's presence (layout.tsx);
//   • no money helper and no organisation read in a GOV-1a file; the deleted tenant pages stay deleted and redirect;
//   • the middleware's language cookie is the console's own (C-7); the gate is used by every GOV-1a page and act.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LANG_COOKIE_FOR_TEST } from './gov1-sources.fixture';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'test' || d.name === 'test-render' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(d.name) ? [path.relative(SRC, p)] : [];
  });
}
const ALL = walk(SRC);

describe('PC-56 GOV-1a · the gov realm only (Q2-A)', () => {
  it('no tenant sign-in call anywhere in web-gov (auth.verifyOtp / requestOtp / refresh / me / logout without .gov)', () => {
    for (const rel of ALL) {
      const src = code(read(rel));
      const hits = src.match(/(?<!gov)\.auth\.(verifyOtp|requestOtp|refresh|me|logout|verifyTwoFactor)\s*\(/g) ?? [];
      expect([rel, hits]).toEqual([rel, []]);
    }
  });
  it('every SDK client call goes through `.gov.` (or the public flag map) — no tenant resource from a gov page', () => {
    for (const rel of ALL) {
      const src = code(read(rel));
      for (const m of src.matchAll(/(?:govClient|anonClient)\([^)]*\)\s*\.\s*(\w+)/g)) expect([rel, m[1]]).toEqual([rel, m[1] === 'request' ? 'request' : 'gov']);
    }
    expect(code(read('app/login/page.tsx'))).toMatch(/'config\/flags'/);
  });
  it('no tenant id, no x-tenant-id header, no NEXT_PUBLIC_TENANT_ID anywhere', () => {
    for (const rel of ALL) expect([rel, /x-tenant-id|tenantId|NEXT_PUBLIC_TENANT_ID/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the login actions call the gov realm\'s verify, choose, 2fa, enrol, confirm — and nothing else', () => {
    const src = code(read('app/login/actions.ts'));
    for (const m of ['otp', 'verify', 'choose', 'verifyTwoFactor', 'enrol', 'confirm']) expect([m, src.includes(`.gov.auth.${m}(`)]).toEqual([m, true]);
    expect(src).not.toMatch(/\.auth\.verifyOtp|tenant/i);
  });
});

describe('PC-56 GOV-1a · the persona gate (E2)', () => {
  it('the layout draws the sidebar from govGate() (the API\'s answer), never from a cookie\'s presence', () => {
    const src = code(read('app/layout.tsx'));
    expect(src).toMatch(/await govGate\(\)/); expect(src).toMatch(/gate\.kind === 'gov' \? gate\.me : null/);
    expect(src).not.toMatch(/getAccessToken|getRefreshToken|cookies\(|hasSessionCookie|isAuthenticated/);
    expect(code(read('lib/auth.ts'))).not.toMatch(/hasSessionCookie|isAuthenticated/);
  });
  it('the gate asks the API (gov.me) with the token it judged; the layout never spends a refresh token', () => {
    const s = code(read('lib/session.ts'));
    expect(s).toMatch(/gateDecision\(token\)/); expect(s).toMatch(/govClient\(token\)\.gov\.me\(\)/);
    expect(s).not.toMatch(/auth\.refresh/);
    expect(code(read('app/api/session/route.ts'))).toMatch(/anonClient\(\)\.gov\.auth\.refresh\(/);
  });
  it('every GOV-1a page and act passes the gate', () => {
    for (const rel of ['app/access/page.tsx', 'app/access/actions.ts', 'app/dashboard/page.tsx']) expect([rel, /await requireGov\(/.test(code(read(rel)))]).toEqual([rel, true]);
    const acts = code(read('app/access/actions.ts'));
    expect((acts.match(/await requireGov\(/g) ?? []).length).toBe(3);
  });
});

describe('PC-56 GOV-1a · what these pages never hold', () => {
  it('no money helper, no organisation read, no form data in a GOV-1a file', () => {
    for (const rel of ALL.filter((r) => /gov1|app\/(login|access|dashboard)|layout|Sidebar/.test(r))) {
      expect([rel, /formatMoneyMinor|from '[^']*\/money'|\.members\.roster|\.users\.|formData\.(form|applicant)|form_data/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('the old organisation pages are deleted and their addresses redirect (307) to /dashboard — /schemes rebuilt for the authority by GOV-2b', () => {
    for (const d of ['app/registers', 'app/verification', 'app/mgnrega']) expect([d, fs.existsSync(path.join(SRC, d))]).toEqual([d, false]);
    const cfg = fs.readFileSync(path.join(SRC, '..', 'next.config.js'), 'utf8');
    expect(cfg).toMatch(/\['\/registers', '\/verification', '\/mgnrega'\]/); expect(cfg).toMatch(/permanent: false/);
    // PC-56 GOV-2b: the /schemes 307 is removed and /schemes is the AUTHORITY's page (gated; gov realm only — test/gov2-sources.spec.ts)
    expect(cfg).not.toMatch(/'\/schemes'/);
    expect(code(read('app/schemes/page.tsx'))).toMatch(/await requireGov\('\/schemes'\)/);
  });
  it('C-7: the middleware persists ?lang= into the console\'s own cookie, the one lib/i18n.ts reads', () => {
    expect(LANG_COOKIE_FOR_TEST(read('middleware.ts'))).toBe('kvg_lang');
    expect(LANG_COOKIE_FOR_TEST(read('lib/i18n.ts'))).toBe('kvg_lang');
  });
});

describe('PC-56 GOV-1b · the desk and its chrome — sources (E7, E12)', () => {
  const GOV1_FILES = ALL.filter((r) => /gov1|app\/(login|access|dashboard|canon)|layout|Sidebar/.test(r));
  it('E7: no money helper in ANY gov1 file (formatMoneyMinor, the money module), and no rupee sign in their code', () => {
    expect(GOV1_FILES.length).toBeGreaterThan(15);
    for (const rel of GOV1_FILES) expect([rel, /formatMoneyMinor|from '[^']*\/money'|₹/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('/dashboard is gated and reads ONE thing — the overview; it never lists or opens an application', () => {
    const src = code(read('app/dashboard/page.tsx'));
    expect(src).toMatch(/await requireGov\('\/dashboard'\)/); expect(src).toMatch(/govClient\(\)\.gov\.overview\(\)/);
    expect((src.match(/govClient\(/g) ?? []).length).toBe(1); expect(src).not.toMatch(/\.applications\.|\.members\./);
  });
  it('/canon/chrome is gated and reads nothing else', () => {
    const src = code(read('app/canon/chrome/page.tsx'));
    expect(src).toMatch(/await requireGov\('\/canon\/chrome'\)/); expect(src).not.toMatch(/govClient|anonClient|fetch\(/);
  });
  it('the dashboard view and its pure module compute nothing: no division, no percentage, no sum, no rounding of a count', () => {
    for (const rel of ['components/gov1/DashboardViews.tsx', 'features/gov1/dashboard.ts']) {
      const src = code(read(rel)).replace(/<\/?[a-z][^>]*>/g, '').replace(/'[^']*'|`[^`]*`/g, "''");
      expect([rel, /[^/*]\/\s*[A-Za-z0-9_(.]|\*\s*100|\.reduce\(|toFixed|Math\.(round|floor|ceil)|percent/i.test(src)]).toEqual([rel, false]);
    }
  });
  it('no image of any kind in a gov1 component (no emblem can be drawn), and none shipped in public/', () => {
    for (const rel of ALL.filter((r) => r.startsWith('components/gov1/'))) expect([rel, /<img|<svg|<Image|emblem\.(svg|png)/i.test(code(read(rel)))]).toEqual([rel, false]);
    const pub = path.join(SRC, '..', 'public');
    const files = fs.existsSync(pub) ? fs.readdirSync(pub) : [];
    expect(files.filter((f) => /emblem|ashoka|lion|seal/i.test(f))).toEqual([]);
  });
  it('E12: the signed-in shell carries the blue top edge and the GOV mark (logical properties only); W358 is linked from the footer, not the sidebar', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.kv-shell\[data-kv-shell="gov"\]\s*\{\s*border-block-start:\s*4px solid var\(--kv-info\)/);
    expect(css).toMatch(/\.kv-gov-pill\s*\{/);
    const shell = code(read('components/gov1/GovShell.tsx'));
    expect(shell).toMatch(/href="\/canon\/chrome"/);
    expect(shell.slice(shell.indexOf('GOV_NAV'), shell.indexOf(']);'))).not.toMatch(/canon/);
    expect(code(read('app/layout.tsx'))).toMatch(/footer=\{me \? <GovFooter t=\{t\} \/> : null\}/);
  });
});
