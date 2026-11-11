// apps/web-gov/src/test/gov4-sources.spec.ts · PC-56 GOV-4a — SOURCE ASSERTIONS (brief §E, survey E1–E3):
//   • E1: ONE route — app/verification holds page.tsx only (no /verification/[id], /verification/[id]/visit, /verification/review, no
//     visits route of any shape);
//   • E2: /verification reads NOTHING — no SDK call at all (the gate is the shell's gov.me()), never schemes.fieldVisits /
//     scheduleFieldVisit / submitFieldVisit; no Server Action, no 'use server', no form, input, button, select, textarea or image;
//   • no money helper, no `amount`, no rupee sign; no location, media or phone field read (lat / lng / geotag / walkTrace / mediaId / photo /
//     video / phone / document) in any gov4 file's code;
//   • E3: the old organisation verification logic (features/verification/review.ts) and its spec are gone; nothing names them;
//   • the gate; GOV_NAV carries /verification.
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
  it('the gov4 files are the ones this wave built; app/verification holds page.tsx only', () => {
    expect([...GOV4_FILES].sort()).toEqual(['app/verification/page.tsx', 'components/gov4/VerificationViews.tsx', 'features/gov4/refusals.ts']);
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
