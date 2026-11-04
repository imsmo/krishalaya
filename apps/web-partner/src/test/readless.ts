// apps/web-partner/src/test/readless.ts · PC-56 PARTNER-5a (survey E12 / F-18(c), the 4c precedent) — THE SHARED READLESSNESS BAN SET.
// A page that is HONEST and reads nothing (PARTNER-5b's collections, case and restructure pages) is certified by scanning its SOURCE for every
// way a server component could come to read something. The panel's rule (P4cR §0.c): a ban list must first be shown to FIRE on a page that
// DOES read, or it is not a test. PARTNER-5a's two pages read, so the aging page is the positive control (test/readless.spec.ts); the
// "finds nothing" half is 5b's. Not a spec itself (jest matches `*.spec.ts` only); imported by specs.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');

/** Each pattern is a way a page could come to read something, with the reason it is banned. */
export const READLESS_BANS: readonly [string, RegExp, string][] = [
  ['partnerClient(', /partnerClient\s*\(/,
    'every audited read of the partner console goes through this one client (lib/api-client.ts)'],
  ['partner.loans.', /partner\.loans\./,
    'the lender\'s own book — every loan read of this axis (dpd, counts, list, get, repayments, collected, pipeline)'],
  ['.request(', /\.request\s*\(/,
    'a raw SDK request bypasses the typed resources and every wall they carry'],
  ['fetch(', /\bfetch\s*\(/,
    'the SDK is not the only way out of a server component; a bare HTTP call would bypass it entirely'],
  ['dynamic import(', /\bimport\s*\(/,
    'a static import scan is defeated by `await import(...)`, which could reach a client at runtime'],
];

/** A source file under src/ as CODE ONLY: comment lines are dropped (a header may legitimately DISCUSS a read; the claim is about what the
 *  file DOES). The same stripping rule as partner4-refusals.spec's `readSrc` and the claims guard's per-file scan. */
export function readCode(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

/** The names of the bans that fire on a file's code. */
export function readlessFires(rel: string): string[] {
  const code = readCode(rel);
  return READLESS_BANS.filter(([, re]) => re.test(code)).map(([name]) => name);
}
