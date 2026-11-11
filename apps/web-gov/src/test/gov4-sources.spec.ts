// apps/web-gov/src/test/gov4-sources.spec.ts · PC-56 GOV-4a — SOURCE ASSERTIONS (brief §E, survey E1–E3):
//   • E1: ONE route — app/verification holds page.tsx only (no /verification/[id], /verification/[id]/visit, /verification/review, no
//     visits route of any shape);
//   • E2: /verification reads NOTHING — no SDK call at all (the gate is the shell's gov.me()), never schemes.fieldVisits /
//     scheduleFieldVisit / submitFieldVisit; no Server Action, no 'use server', no form, input, button, select, textarea or image;
//   • no money helper, no `amount`, no rupee sign; no location, media or phone field read (lat / lng / geotag / walkTrace / mediaId / photo /
//     video / phone / document) in any gov4 file's code;
//   • E3: the old organisation verification logic (features/verification/review.ts) and its spec are gone; nothing names them;
//   • the gate; GOV_NAV carries /verification.
//   GOV-4b (W356 → /access "Sign-ins"): the section takes only `t` and reads nothing; /access makes NO SDK call beyond GOV-1a's
//   gov.members.list() (and its three act methods in actions.ts); app/access holds page.tsx and actions.ts only (no /access/sign-ins);
//   no app/audit route (W356's canon address /audit/access answers not found); no sign-in, IP, device or session field read.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [path.relative(SRC, p)];
  });
}
const GOV4_FILES = [...walk(path.join(SRC, 'features', 'gov4')), ...walk(path.join(SRC, 'components', 'gov4')), ...walk(path.join(SRC, 'app', 'verification'))];

describe('PC-56 GOV-4a · E1 — one route', () => {
  it('the gov4 files are the ones GOV-4a and GOV-4b built; app/verification holds page.tsx only', () => {
    expect([...GOV4_FILES].sort()).toEqual(['app/verification/page.tsx', 'components/gov4/SignInsViews.tsx', 'components/gov4/VerificationViews.tsx', 'features/gov4/refusals.ts']);
    expect(walk(path.join(SRC, 'app', 'verification'))).toEqual(['app/verification/page.tsx']);
  });
});

describe('PC-56 GOV-4a · E2 — /verification reads nothing and writes nothing', () => {
  it('no SDK call in any gov4 file: no govClient, no .gov., no .schemes., no fetch or raw request; never a field-visit method', () => {
    for (const rel of GOV4_FILES) {
      const c = code(read(rel));
      expect([rel, /govClient|tenantClient|\.gov\.|\.schemes\.|fetch\(|\.request\(/.test(c)]).toEqual([rel, false]);
      expect([rel, /fieldVisits|scheduleFieldVisit|submitFieldVisit|field-visits/.test(c)]).toEqual([rel, false]);
    }
    expect(code(read('app/verification/page.tsx'))).toMatch(/await requireGov\('\/verification'\)/);
  });
  it('no Server Action, no form, input, button, select or textarea, no image, no table, in any gov4 file', () => {
    for (const rel of GOV4_FILES) {
      expect([rel, /'use server'|"use server"|action=\{|formAction|<form|<input|<button|<select|<textarea/.test(code(read(rel)))]).toEqual([rel, false]);
      expect([rel, /<img|<svg|<Image|<video|<table|<iframe/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('no money helper, no `amount`, no rupee sign; no location, media, phone or document field read in any gov4 file\'s code', () => {
    for (const rel of GOV4_FILES) {
      const c = code(read(rel));
      expect([rel, /formatMoneyMinor|parseMajorToMinor|from '[^']*\/money'|amount|₹|Minor\b/i.test(c)]).toEqual([rel, false]);
      // the registry's `canon` strings QUOTE the canon (anonymised) and say no; the field-read check is on the view and the page
      if (rel !== 'features/gov4/refusals.ts') expect([rel, /\.(lat|lng|geotag|walkTrace|mediaId|photo|video|phone\w*|document\w*|measuredValues|officerId)\b/i.test(c)]).toEqual([rel, false]);
    }
  });
  it('the view takes only `t` and `me` (and the chain its id and state): no prop could carry a visit, farm, farmer or officer', () => {
    const v = code(read('components/gov4/VerificationViews.tsx'));
    expect(v).toMatch(/export function VerificationView\(\{ t, me \}: \{ t: Tr; me: GovMe \| null \}\)/);
    expect(v).toMatch(/export function Gov4Chain\(\{ t, chain, state \}: \{ t: Tr; chain: Chain4Id; state: string \}\)/);
    expect([...v.matchAll(/\bme\.(\w+)/g)].map((m) => m[1])).toEqual(['authority']);
  });
});

describe('PC-56 GOV-4a · E3 — the old organisation verification logic is gone', () => {
  it('features/verification/review.ts and test/verification.spec.ts are deleted; no source names them', () => {
    expect(fs.existsSync(path.join(SRC, 'features', 'verification'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'test', 'verification.spec.ts'))).toBe(false);
    const all = [...walk(path.join(SRC, 'features')), ...walk(path.join(SRC, 'components')), ...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'lib')), ...walk(path.join(SRC, 'test')), ...walk(path.join(SRC, 'test-render'))].filter((r) => r !== 'test/gov4-sources.spec.ts');   // (this spec names them to look for them)
    for (const rel of all) expect([rel, /features\/verification|canVerifyKyc|KYC_REVIEW_STATUSES/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('GOV_NAV carries /verification ("Field visits")', () => {
    const shell = code(read('components/gov1/GovShell.tsx'));
    expect(shell.slice(shell.indexOf('GOV_NAV'), shell.indexOf(']);'))).toMatch(/\{ href: '\/verification', labelKey: 'gov4\.nav\.verification' \}/);
  });
});

describe('PC-56 GOV-4b · W356 is a section of /access that reads nothing', () => {
  it('no route for sign-ins: app/access holds page.tsx and actions.ts only; no app/audit; no route named for sign-ins or sessions anywhere', () => {
    expect(walk(path.join(SRC, 'app', 'access')).sort()).toEqual(['app/access/actions.ts', 'app/access/page.tsx']);
    expect(fs.existsSync(path.join(SRC, 'app', 'audit'))).toBe(false);
    for (const rel of walk(path.join(SRC, 'app'))) expect([rel, /sign-?ins?\b|signins|sessions|audit|login-?events/i.test(rel)]).toEqual([rel, false]);
  });
  it('/access makes no SDK call beyond GOV-1a\'s: the page reads gov.members.list() only; the actions call request / approve / remove only', () => {
    const page = code(read('app/access/page.tsx'));
    expect([...page.matchAll(/govClient\(\)\.([\w.]+)\(/g)].map((m) => m[1])).toEqual(['gov.members.list']);
    expect(page).not.toMatch(/fetch\(|\.request\(|tenantClient|\bsessions\b|loginEvents|login_events|signIns/);
    const acts = code(read('app/access/actions.ts'));
    expect([...new Set([...acts.matchAll(/\.gov\.([\w.]+)\(/g)].map((m) => m[1]))].sort()).toEqual(['members.approve', 'members.remove', 'members.request']);
  });
  it('the section takes only `t`; it imports no SDK, client or session helper; no sign-in, address, device or session field is read', () => {
    const v = code(read('components/gov4/SignInsViews.tsx'));
    expect(v).toMatch(/export function SignInsSection\(\{ t \}: \{ t: Tr \}\)/);
    expect(v).not.toMatch(/@krishalaya\/sdk-js|api-client|lib\/session|govClient|fetch\(/);
    expect(v).not.toMatch(/\.(ip|ipAddress|device\w*|userAgent|fingerprint|lastSignIn\w*|signIns?|sessions?|loginEvents|location|city)\b/);
    const a = code(read('components/gov1/AccessViews.tsx'));
    expect([...a.matchAll(/<SignInsSection ([^/]*)\/>/g)].map((m) => m[1].trim())).toEqual(['t={t}']);
    expect(a).not.toMatch(/\.(ip|ipAddress|device\w*|userAgent|fingerprint|lastSignIn\w*|signIns?|sessions|loginEvents|location|city)\b/);
  });
  it('the sign-ins chains are answered on /access before anything is read, with Back → /access', () => {
    const page = code(read('app/access/page.tsx'));
    const at = page.indexOf("chain4For(searchParams, 'access')");
    expect(at).toBeGreaterThan(0); expect(at).toBeLessThan(page.indexOf('govClient()'));
  });
});
