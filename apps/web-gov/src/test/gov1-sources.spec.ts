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
  it('the old organisation pages are deleted and their addresses redirect (307) to /dashboard', () => {
    for (const d of ['app/schemes', 'app/registers', 'app/verification', 'app/mgnrega']) expect([d, fs.existsSync(path.join(SRC, d))]).toEqual([d, false]);
    const cfg = fs.readFileSync(path.join(SRC, '..', 'next.config.js'), 'utf8');
    expect(cfg).toMatch(/\['\/schemes', '\/registers', '\/verification', '\/mgnrega'\]/); expect(cfg).toMatch(/permanent: false/);
  });
  it('C-7: the middleware persists ?lang= into the console\'s own cookie, the one lib/i18n.ts reads', () => {
    expect(LANG_COOKIE_FOR_TEST(read('middleware.ts'))).toBe('kvg_lang');
    expect(LANG_COOKIE_FOR_TEST(read('lib/i18n.ts'))).toBe('kvg_lang');
  });
});
