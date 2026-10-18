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
