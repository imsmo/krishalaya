// apps/web-ops/src/test/ops3a-pages.spec.ts · PC-56 OPS-3a — THE COUNTER: pure helpers and SOURCE ASSERTIONS.
//   E11 · the READLESS assertion with its POSITIVE CONTROL FIRST: the pattern fires on /pos/home (which reads), then finds nothing in /pos/exceptions;
//   E2  · one write, one path: `recordCollection(` is called from app/pos/actions.ts ONLY (the /dairy form moved); /dairy links the counter;
//         the pages read exactly what their headers say; the record act re-reads custody and the roll before it sends;
//   E3  · no client money math in any 3a source — no sum, split, average or per-kg derivation; the formatter only gets server minor strings;
//   B18 · no `Number(` / `parseFloat` / `Math.` on the reading path in the counter's helpers;
//   Q1-A / OPS-1 Q2-A · no web-ops source calls createRateCard, approveBill, payBill, decideQualityReview, setBmcBand or retireBmcUnit;
//   E7  · inputs: W361 the record form only; W362 hidden fields + one button; W360 / W363 / W364 / W365 none (counted on the views by section);
//   the pure helpers: buildPour (pattern only, the future day refused), the failure-reason map, the recorded-pour codec, the centre picker.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  POS, buildPour, counterState, decodeRecorded, encodeRecorded, memberValue, parseCode, parseMember, pickCentre, pourFailureReason, pourFromParams, pourQuery,
  recordedAtText, type RecordedPour,
} from '../features/ops3/counter';
import { chain3State } from '../features/ops3/refusals';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.dairy\.|loadCounter|counter-load/m;
const PAGES = ['app/pos/home/page.tsx', 'app/pos/collect/page.tsx', 'app/pos/quality/page.tsx', 'app/pos/slip/page.tsx', 'app/pos/exceptions/page.tsx', 'app/pos/shift-close/page.tsx'];
const ALL_3A = [...PAGES, 'app/pos/actions.ts', 'components/ops3/CounterViews.tsx', 'features/ops3/counter.ts', 'features/ops3/counter-load.ts'];
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SRC_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));
const M = '0192d2c4-0000-7000-8000-000000000001';
const C = '0192d2c4-0000-7000-8000-0000000000c1';

describe('PC-56 OPS-3a · E11 · the readless assertion (positive control first)', () => {
  it('CONTROL: the pattern fires on /pos/home, which DOES read', () => {
    expect(READS.test(code(read('app/pos/home/page.tsx')))).toBe(true);
  });
  it('then finds nothing in /pos/exceptions (W364 reads nothing)', () => {
    expect(READS.test(code(read('app/pos/exceptions/page.tsx')))).toBe(false);
    expect(/SdkError|cookies\(/.test(code(read('app/pos/exceptions/page.tsx')))).toBe(false);
  });
});

describe('PC-56 OPS-3a · E2 · one write, one path; the reads', () => {
  it('`recordCollection(` is called from app/pos/actions.ts and nowhere else in web-ops', () => {
    const callers = SRC_FILES.filter((f) => /\.recordCollection\(/.test(code(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(SRC, f));
    expect(callers).toEqual([path.join('app', 'pos', 'actions.ts')]);
  });
  it('/dairy no longer carries the record form, and links the counter', () => {
    const page = read('app/dairy/page.tsx'); const acts = read('app/dairy/actions.ts');
    expect(/recordCollectionAction|name="weightKg"|dc-member/.test(code(page))).toBe(false);
    expect(/export async function recordCollectionAction/.test(acts)).toBe(false);
    expect(page).toContain('href="/pos/home"');
  });
  it('the record act re-reads custody and the centre\'s roll BEFORE it sends, and sends the counter\'s own centre', () => {
    const a = code(read('app/pos/actions.ts'));
    const at = (s: string) => a.indexOf(s);
    expect(at('counterCentres()')).toBeGreaterThan(-1);
    expect(at('counterCentres()')).toBeLessThan(at('.recordCollection('));
    expect(at("listMemberships({ box: 'mcc', mccId: centre.id")).toBeLessThan(at('.recordCollection('));
    expect(a).toContain('recordCollection({ ...built.value, mccId: centre.id }, key)');
  });
  it('the roll is the centre\'s (box=mcc + its id), keyset-paged by a member-code prefix — never box=all, never limit 100', () => {
    const p = code(read('app/pos/collect/page.tsx'));
    expect(p).toContain("listMemberships({ box: 'mcc', mccId: ctx.centre.id, code: code ?? undefined, cursor, limit: ROLL_PAGE_SIZE })");
    for (const rel of ALL_3A) expect([rel, /box: 'all'|limit: 100\b/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the chain states are read BEFORE any call on /pos/quality; the failure state reads nothing', () => {
    const q = code(read('app/pos/quality/page.tsx'));
    expect(q.indexOf("chain3State('pos_act'")).toBeLessThan(q.indexOf('loadCounter('));
    expect(q.indexOf("act === 'failure'")).toBeLessThan(q.indexOf('loadCounter('));
  });
});

describe('PC-56 OPS-3a · E3 / B18 · no money math, no float on the reading path', () => {
  it('no line that touches an amount multiplies, adds, subtracts, divides or converts it; no BigInt, reduce or "×" anywhere in 3a', () => {
    for (const rel of ALL_3A) {
      for (const line of code(read(rel)).split('\n').filter((l) => /Minor|formatMoney|amount|price/i.test(l) && !/^import /.test(l))) {
        expect([rel, line.trim(), /\*|×|\bBigInt\s*\(|\bNumber\s*\(|parseFloat|parseInt|Math\.|\w\s*[+-]\s*\w*Minor|Minor\w*\s*[+\-/]\s*\w|\d+n\b/.test(line)]).toEqual([rel, line.trim(), false]);
      }
      expect([rel, /×|\bBigInt\b|\breduce\s*\(/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('the formatter is given only server minor strings, through ONE guarded helper', () => {
    const v = code(read('components/ops3/CounterViews.tsx'));
    expect(Array.from(v.matchAll(/formatMoneyMinor\((.*?), 'INR', lang\)/g)).map((m) => m[1])).toEqual(['minor']);
    expect(v).toContain("const money = (minor: string | undefined, lang: string) => (isMinor(minor) ? formatMoneyMinor(minor, 'INR', lang) : null);");
  });
  it('the counter\'s helpers never turn a reading into a number', () => {
    for (const rel of ['features/ops3/counter.ts', 'app/pos/actions.ts', 'components/ops3/CounterViews.tsx'])
      expect([rel, /\bNumber\s*\(|parseFloat|parseInt|Math\.|toFixed/.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-3a · the console never sets a price, decides quality, pays or changes a cooler', () => {
  it('no web-ops source calls createRateCard, approveRateCard, approveBill, payBill, decideQualityReview, retestQualityReview, setBmcBand or retireBmcUnit', () => {
    expect(SRC_FILES.length).toBeGreaterThan(50);
    for (const f of SRC_FILES) expect([path.relative(SRC, f), /\.(createRateCard|approveRateCard|approveBill|payBill|decideQualityReview|retestQualityReview|setBmcBand|retireBmcUnit|reportBmcLevel|stateBmcCompressor)\(/.test(code(fs.readFileSync(f, 'utf8')))])
      .toEqual([path.relative(SRC, f), false]);
  });
});

describe('PC-56 OPS-3a · E7 · inputs per page (counted on the source of each page\'s section)', () => {
  const views = read('components/ops3/CounterViews.tsx');
  const section = (start: string, end: string) => views.slice(views.indexOf(start), views.indexOf(end));
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  it('W360, W363, W364 and W365 have no input, select, textarea or form', () => {
    for (const [a, b] of [['export function PosHomeView', 'W361 · /pos/collect'], ['export function PosSlipView', 'W364 · /pos/exceptions'],
      ['export function PosExceptionsView', 'W365 · /pos/shift-close'], ['export function PosShiftView', '\u0000']] as const) {
      const s = b === '\u0000' ? views.slice(views.indexOf(a)) : section(a, b);
      expect([a, count(s, /<input|<select|<textarea|<form/g)]).toEqual([a, 0]);
    }
  });
  it('W361: the code search (one input) and the record form (member select, two shift radios, date, weight, fat, SNF, the flags)', () => {
    const s = section('export function PosCollectView', 'W362 · /pos/quality');
    expect(count(s, /<form/g)).toBe(2);
    expect(count(s, /<select/g)).toBe(1);
    expect(s).toMatch(/name="collectedOn" type="date"[^>]*defaultValue=\{today \?\? ''\} max=\{today \?\? undefined\}/);
  });
  it('W362: hidden fields and ONE button, "Record this pour"; no visible input', () => {
    const s = section('export function PosQualityView', 'W3337 failure');
    expect(count(s, /<input (?![^>]*type="hidden")/g)).toBe(0);
    expect(count(s, /<button/g)).toBe(1);
    expect(s).toContain("t.t('ops3.pos.recordBtn')");
    expect(/Retest|retest/.test(code(s))).toBe(false);
  });
});

describe('PC-56 OPS-3a · the pure helpers', () => {
  const raw = { membershipId: M, shift: 'evening', collectedOn: '2026-11-09', weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', waterFlag: false, adulteration: [] as string[] };
  it('buildPour: the readings stay the strings typed; today passes; tomorrow is refused by name', () => {
    expect(buildPour(raw, '2026-11-09')).toEqual({ ok: true, value: { membershipId: M, shift: 'evening', collectedOn: '2026-11-09', weightKg: '10.500', fatPct: '4.10', snfPct: '8.50' } });
    expect(buildPour({ ...raw, collectedOn: '2026-11-10' }, '2026-11-09')).toEqual({ ok: false, error: 'future' });
    expect(buildPour({ ...raw, weightKg: '0.000' }, '2026-11-09')).toEqual({ ok: false, error: 'weight' });
    expect(buildPour({ ...raw, weightKg: '1e3' }, '2026-11-09')).toEqual({ ok: false, error: 'weight' });
    expect(buildPour({ ...raw, collectedOn: '9/11/2026' }, '2026-11-09')).toEqual({ ok: false, error: 'date' });
  });
  it('the member travels as id|code; the code is a short printable string (never a name with spaces)', () => {
    expect(parseMember(memberValue(M, 'C-007'))).toEqual({ membershipId: M, code: 'C-007' });
    expect(parseMember(`${M}|Some Name`)).toBeNull();
    expect(parseCode('A'.repeat(41))).toBeNull();
    const q = new URLSearchParams(pourQuery({ membershipId: M, shift: 'morning', collectedOn: '2026-11-09', weightKg: '1', fatPct: '4', snfPct: '8', waterFlag: true, adulterationFlags: ['urea'] }, C, 'C-007'));
    const back = pourFromParams(Object.fromEntries([...new Set(q.keys())].map((k) => [k, q.getAll(k).length > 1 ? q.getAll(k) : q.get(k) ?? ''])), '2026-11-09');
    expect(back).toEqual({ ok: true, code: 'C-007', value: { membershipId: M, shift: 'morning', collectedOn: '2026-11-09', weightKg: '1', fatPct: '4', snfPct: '8', waterFlag: true, adulterationFlags: ['urea'] } });
  });
  it('the server\'s refusals map to named reasons — the brief\'s four first', () => {
    expect(pourFailureReason(422, 'POUR_DATE_IN_FUTURE')).toBe('future');
    expect(pourFailureReason(422, 'POUR_WINDOW_ALREADY_BILLED')).toBe('billed');
    expect(pourFailureReason(409, 'DUPLICATE_COLLECTION')).toBe('duplicate');
    expect(pourFailureReason(422, 'NO_ACTIVE_RATE_CARD')).toBe('noCard');
    expect(pourFailureReason(409, 'POUR_NOT_AT_THIS_CENTRE')).toBe('notHere');
    expect(pourFailureReason(403, 'DAIRY_FORBIDDEN')).toBe('forbidden');
    expect(pourFailureReason(404, 'NOT_FOUND')).toBe('off');
    expect(pourFailureReason(500, undefined)).toBe('record');
  });
  it('the recorded pour round-trips, and anything tampered or malformed is refused (null)', () => {
    const r: RecordedPour = { id: M, memberCode: 'C-007', mccId: C, shift: 'morning', collectedOn: '2026-11-09', weightKg: '10.500', fatPct: '4.10', snfPct: '8.50',
      amountMinor: '43050', rateCardId: C, holdState: 'none', createdAt: '2026-11-09T01:12:40.000Z', waterFlag: false, adulterationFlags: [] };
    expect(decodeRecorded(encodeRecorded(r))).toEqual(r);
    expect(decodeRecorded(encodeRecorded({ ...r, amountMinor: '430.50' }))).toBeNull();
    expect(decodeRecorded(encodeRecorded({ ...r, memberCode: 'A Name' }))).toBeNull();
    expect(decodeRecorded('not-base64-json')).toBeNull();
    expect(recordedAtText(r.createdAt)).toBe('2026-11-09 01:12 UTC');
  });
  it('the counter states, and the centre is only ever one in custody', () => {
    expect([counterState(404, 0), counterState(403, 0), counterState(500, 0), counterState('ok', 0), counterState('ok', 2)]).toEqual(['off', 'forbidden', 'error', 'noCustody', 'ok']);
    const a = { id: C, code: 'C-01' } as never; const b = { id: M, code: 'C-02' } as never;
    expect(pickCentre([a], null)).toBe(a); expect(pickCentre([a, b], null)).toBeNull();
    expect(pickCentre([a, b], M)).toBe(b); expect(pickCentre([a], M)).toBeNull();
  });
  it('the pos chain\'s query states; the six canon addresses', () => {
    expect(chain3State('pos_act', { act: 'failure' })).toBe('failure');
    expect(chain3State('pos_act', { act: 'accept' })).toBeNull();
    expect(Object.values(POS)).toEqual(['/pos/home', '/pos/collect', '/pos/quality', '/pos/slip', '/pos/exceptions', '/pos/shift-close']);
    for (const p of Object.values(POS)) expect([p, fs.existsSync(path.join(SRC, 'app', p, 'page.tsx'))]).toEqual([p, true]);
  });
});
