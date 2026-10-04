// apps/web-tenant/src/test/tenant-swf.spec.ts · PC-56 TENANT-SW-f · INSIGHTS, LEARNER INSIGHTS, OFFLINE (W193–W196, W318, W417).
// The pure helpers; the offline laws (the stale threshold, the degraded decision, verify-before-write's diff); every list mirrored from the
// API's OWN source (a second copy must agree); verify-before-write wired into EVERY sweep-wave act that changes an existing row; the "as of"
// banner on every sweep data page; no service worker anywhere; every key ×3 with the same {vars}.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { STALE_AFTER_MS, isStale, istClock, relativeParts, staleClass } from '../features/offline/stale';
import { NO_OFFLINE_WRITE_QUEUE, applySignal, signalMode, type SignalButton, type SignalDoc, type SignalForm } from '../features/offline/signal';
import {
  DIFF_PARAM, SEEN_FIELD, SEEN_MISSING, STALE_ROW, diffSnapshots, diffToken, fieldValue, isStaleFailure, readDiff, readSeen, seenToken, snapshot, staleHref,
  verifyBeforeWrite,
} from '../features/mutate/verify';
import { VERIFY_FIELDS } from '../features/mutate/verify-fields';
import {
  CADENCES, MAX_RANGE_DAYS, RECIPIENT_ROLES, REFUSED_CODES, SWF_CODES, WASTAGE_KINDS, WASTAGE_SOURCES, bpsPercent, daysInclusive, failedCodes, keyList,
  refusedKey, runDraftProblems, sharePercent, swfCodeKey, swfPageState, watermarkPairs, wordsFor,
} from '../features/swf/console';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(__dirname, '..', rel));
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules', rel), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0202_insights_offline.sql'), 'utf8');

describe('W318 §1 · the stale threshold (one hour, strictly more)', () => {
  const at = '2026-10-04T09:48:00.000Z';
  const plus = (ms: number) => new Date(Date.parse(at) + ms);
  it('exactly one hour old is NOT stale; one millisecond more IS', () => {
    expect(STALE_AFTER_MS).toBe(3_600_000);
    expect(isStale(at, plus(STALE_AFTER_MS))).toBe(false);
    expect(isStale(at, plus(STALE_AFTER_MS + 1))).toBe(true);
    expect(isStale(at, plus(59 * 60_000))).toBe(false);
  });
  it('an unknown instant is never called stale (unknown ≠ old)', () => {
    expect(isStale(null, plus(10 * STALE_AFTER_MS))).toBe(false);
    expect(isStale('not-a-date', plus(10 * STALE_AFTER_MS))).toBe(false);
  });
  it('the tint is a class (and the banner a word — AsOf), absolute IST + relative parts', () => {
    expect(staleClass(true)).toBe('kv-asof kv-asof--stale');
    expect(staleClass(false)).toBe('kv-asof');
    expect(istClock(at)).toBe('2026-10-04 15:18 IST');
    expect(relativeParts(at, plus(30_000))).toEqual({ unit: 'now', value: 0, minutes: 0 });
    expect(relativeParts(at, plus(3 * 60_000))).toEqual({ unit: 'minutes', value: 3, minutes: 0 });
    expect(relativeParts(at, plus(82 * 60_000))).toEqual({ unit: 'hours', value: 1, minutes: 22 });
    expect(relativeParts(at, plus(50 * 3_600_000))).toEqual({ unit: 'days', value: 2, minutes: 0 });
  });
});

describe('W318 §2 · degraded read-only mode', () => {
  it('offline, or a failed heartbeat → degraded; an unanswered heartbeat trusts the browser', () => {
    expect(signalMode(false, true)).toBe('degraded');
    expect(signalMode(true, false)).toBe('degraded');
    expect(signalMode(true, true)).toBe('live');
    expect(signalMode(true, null)).toBe('live');
  });
  const button = (text: string, disabled = false): SignalButton & { attrs: Record<string, string> } => {
    const attrs: Record<string, string> = {};
    return { disabled, textContent: text, dataset: {}, attrs, getAttribute: (n) => attrs[n] ?? null, setAttribute: (n, v) => { attrs[n] = v; }, removeAttribute: (n) => { delete attrs[n]; } };
  };
  const form = (method: string, buttons: SignalButton[]): SignalForm => ({ method, getAttribute: () => method, querySelectorAll: () => buttons });
  it('every submit of a POST (server action) form is disabled with "— needs signal"; GET forms and links stay usable; lifting restores', () => {
    const approve = button('Approve'); const already = button('Pay', true); const filter = button('Filter');
    const doc: SignalDoc = { querySelectorAll: () => [form('post', [approve, already]), form('get', [filter])] };
    expect(applySignal(doc, 'degraded', '— needs signal')).toBe(2);
    expect(approve.disabled).toBe(true); expect(approve.textContent).toBe('Approve — needs signal'); expect(approve.attrs['aria-disabled']).toBe('true');
    expect(filter.disabled).toBe(false); expect(filter.textContent).toBe('Filter');
    expect(applySignal(doc, 'degraded', '— needs signal')).toBe(0);                      // idempotent: never appended twice
    expect(applySignal(doc, 'live', '— needs signal')).toBe(2);
    expect(approve.disabled).toBe(false); expect(approve.textContent).toBe('Approve');
    expect(already.disabled).toBe(true);                                                  // a button that was already off stays off
  });
  it('NO SERVICE WORKER, NO DRAFT QUEUE: refused by name, and nothing in the console registers one', () => {
    expect(NO_OFFLINE_WRITE_QUEUE).toBe('NO_OFFLINE_WRITE_QUEUE');
    expect(REFUSED_CODES).toContain('NO_OFFLINE_WRITE_QUEUE');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(path.join(__dirname, '..')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`) && !f.includes('test-render'));
    for (const f of files) expect([f, /navigator\.serviceWorker|serviceWorker\.register|indexedDB\.open/.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
    expect(exists('../public/sw.js')).toBe(false);
    expect(src('app/layout.tsx')).toMatch(/<OnlineGuard labels=\{signalLabels\(t\)\} \/>/);
  });
});

describe('W318 §3 · verify-before-write (the shared chain)', () => {
  const row = { id: 'r1', status: 'proposed', amountMinor: '1500', nested: { a: 1 }, list: [{ id: 'x' }], gone: null };
  it('the token carries the fields and values the confirm step showed (nested + array index + length), and reads back', () => {
    expect(fieldValue(row, 'nested.a')).toBe('1');
    expect(fieldValue(row, 'list.0.id')).toBe('x');
    expect(fieldValue(row, 'list.length')).toBe('1');
    expect(fieldValue(row, 'gone')).toBe('—');
    expect(fieldValue(null, 'id')).toBe('—');
    const tok = seenToken(row, ['id', 'status', 'amountMinor']);
    expect(readSeen(tok)).toEqual({ fields: ['id', 'status', 'amountMinor'], values: { id: 'r1', status: 'proposed', amountMinor: '1500' } });
    expect(readSeen('garbage')).toBeNull();
    expect(readSeen(undefined)).toBeNull();
  });
  it('a row that moved → STALE_ROW with field · was · now; the same row → ok; a gone row → STALE_ROW (present → gone)', async () => {
    const tok = seenToken(row, ['id', 'status', 'amountMinor']);
    expect(await verifyBeforeWrite(tok, async () => ({ ...row }))).toEqual({ ok: true });
    const v = await verifyBeforeWrite(tok, async () => ({ ...row, status: 'confirmed' }));
    expect(v).toEqual({ ok: false, code: STALE_ROW, diffs: [{ field: 'status', was: 'proposed', now: 'confirmed' }] });
    expect(await verifyBeforeWrite(tok, async () => null)).toEqual({ ok: false, code: STALE_ROW, diffs: [{ field: '(row)', was: 'present', now: 'gone' }] });
    expect(await verifyBeforeWrite(tok, async () => { throw Object.assign(new Error('x'), { status: 404 }); })).toMatchObject({ ok: false, code: STALE_ROW });
    await expect(verifyBeforeWrite(tok, async () => { throw Object.assign(new Error('boom'), { status: 500 }); })).rejects.toThrow('boom');
  });
  it('a confirm form without its snapshot is refused SEEN_MISSING, and the re-read is not even made', async () => {
    let read = 0;
    expect(await verifyBeforeWrite(null, async () => { read++; return row; })).toEqual({ ok: false, code: SEEN_MISSING, diffs: [] });
    expect(read).toBe(0);
  });
  it('the failure URL keeps what was carried, names the code and the diff; the page reads the diff back; only the two codes are "stale"', () => {
    const diffs = diffSnapshots(snapshot(row, ['status']), { status: 'refused' });
    const href = staleHref('/x/act', { act: 'confirm', id: 'r1', empty: '' }, { ok: false, code: STALE_ROW, diffs });
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('act')).toBe('confirm'); expect(q.get('id')).toBe('r1'); expect(q.has('empty')).toBe(false);
    expect(q.get('step')).toBe('failure'); expect(q.get('error')).toBe('STALE_ROW');
    expect(readDiff(q.get(DIFF_PARAM) ?? '')).toEqual([{ field: 'status', was: 'proposed', now: 'refused' }]);
    expect(readDiff(diffToken(diffs))).toEqual(diffs);
    expect(isStaleFailure('STALE_ROW')).toBe(true); expect(isStaleFailure('SEEN_MISSING')).toBe(true); expect(isStaleFailure('FORBIDDEN')).toBe(false);
  });
  it('no listed field moves on every read (no "now", no counter of minutes)', () => {
    for (const [act, fields] of Object.entries(VERIFY_FIELDS)) for (const f of fields) expect([act, f, /^now|Now|[Tt]oday|[Mm]inutes|[Ss]econds|lastActivity/.test(f)]).toEqual([act, f, false]);
  });

  // Every act of the sweep waves (SW-a … SW-f) that changes an EXISTING row: its confirm page carries the snapshot and its server action
  // re-reads before writing. (Acts that only CREATE a row — propose, invite, add directly, backfill a new day — have nothing to re-read.)
  const COVERED: Array<[string, string]> = [
    ['app/money/commission/act/page.tsx', 'app/money/commission/act/actions.ts'],
    ['app/ops/logistics/cod/act/page.tsx', 'app/ops/logistics/cod/act/actions.ts'],
    ['app/ops/logistics/pod/[id]/act/page.tsx', 'app/ops/logistics/pod/[id]/act/actions.ts'],
    ['app/ops/logistics/zones/act/page.tsx', 'app/ops/logistics/zones/act/actions.ts'],
    ['app/ops/labour/attendance/act/page.tsx', 'app/ops/labour/attendance/act/actions.ts'],
    ['app/ops/labour/wages/act/page.tsx', 'app/ops/labour/wages/act/actions.ts'],
    ['app/ops/schemes/[code]/act/page.tsx', 'app/ops/schemes/[code]/act/actions.ts'],
    ['app/people/ambassadors/[id]/act/page.tsx', 'app/people/ambassadors/[id]/act/actions.ts'],
    ['app/people/ambassadors/earnings/act/page.tsx', 'app/people/ambassadors/earnings/act/actions.ts'],
    ['app/people/verification/[id]/act/page.tsx', 'app/people/verification/[id]/act/actions.ts'],
    ['app/settings/team/[id]/act/page.tsx', 'app/settings/team/team-actions.ts'],
    ['app/settings/team/act/page.tsx', 'app/settings/team/team-actions.ts'],
    ['app/governance/register/import/[id]/act/page.tsx', 'app/governance/register/import/[id]/act/actions.ts'],
    ['app/insights/governance/agm/[id]/act/page.tsx', 'app/insights/governance/agm/[id]/act/actions.ts'],
    ['app/ops/logistics/carriers/act/page.tsx', 'app/ops/logistics/carriers/act/actions.ts'],
    ['app/ops/logistics/cold-chain/breaches/act/page.tsx', 'app/ops/logistics/cold-chain/breaches/act/actions.ts'],
    ['app/ops/logistics/routes/[id]/act/page.tsx', 'app/ops/logistics/routes/[id]/act/actions.ts'],
    ['app/ops/logistics/slots/act/page.tsx', 'app/ops/logistics/slots/act/actions.ts'],
    ['app/insights/reports/act/page.tsx', 'app/insights/reports/act/actions.ts'],
  ];
  it.each(COVERED)('%s carries the snapshot; its action re-reads before it writes', (page, action) => {
    const p = src(page); const a = src(action);
    expect(p).toMatch(/name=\{SEEN_FIELD\} value=\{seenToken\(/);
    expect(p).toMatch(/VERIFY_FIELDS\.\w+|DEF_FIELDS|SCHED_FIELDS/);
    expect(p).toMatch(/isStaleFailure\((searchParams\.)?error\)/);
    expect(p).toContain('<StaleDiffChip ');
    expect(a).toMatch(/verifyBeforeWrite\(formData\.get\(SEEN_FIELD\)/);
    if (action.endsWith('team-actions.ts')) return;                         // one file, many acts: checked act by act below
    if (action.startsWith('app/insights/reports/')) {                        // archive / unschedule: the re-read precedes each write
      expect(a.indexOf('verifyBeforeWrite(formData.get(SEEN_FIELD)')).toBeLessThan(a.indexOf('archiveDefinition('));
      expect(a.lastIndexOf('verifyBeforeWrite(formData.get(SEEN_FIELD)')).toBeLessThan(a.indexOf('deactivateSchedule('));
      return;
    }
    // the re-read sits BEFORE the first write in the action file
    const firstVerify = a.indexOf('verifyBeforeWrite(formData.get(SEEN_FIELD)');
    const firstTry = a.indexOf('\n  try');
    expect(firstVerify).toBeGreaterThan(0);
    expect(firstVerify).toBeLessThan(firstTry);
  });
  it('the staff page carries one snapshot into all six of its act forms; every staff action verifies first', () => {
    const p = src('app/settings/team/[id]/act/page.tsx'); const a = src('app/settings/team/team-actions.ts');
    expect(p).toMatch(/const hidden = <><input type="hidden" name="userId"[^\n]*name=\{SEEN_FIELD\}/);
    expect((p.match(/\{hidden\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
    const inv = a.slice(a.indexOf('export async function revokeInviteAction('));
    expect(inv.indexOf('verifyBeforeWrite(formData.get(SEEN_FIELD)')).toBeLessThan(inv.indexOf('revokeInvite(id'));
    for (const fn of ['overrideAction', 'revokeOverrideAction', 'removeAction', 'declareConflictForAction', 'liftConflictAction', 'proposalAction']) {
      const body = a.slice(a.indexOf(`export async function ${fn}(`)); const end = body.indexOf('\n}\n');
      const f = body.slice(0, end);
      expect([fn, f.indexOf('await verifyStaff(') > 0 && f.indexOf('await verifyStaff(') < f.indexOf('\n  try')]).toEqual([fn, true]);
    }
  });
  it('the SEEN_FIELD the pages carry is the name the chain reads', () => { expect(SEEN_FIELD).toBe('kv_seen'); expect(DIFF_PARAM).toBe('kv_diff'); });
});

describe('the insights helpers', () => {
  it('percent from integers the API computed (never a division of money here)', () => {
    expect(bpsPercent(189)).toBe('+1.89%'); expect(bpsPercent(-5)).toBe('−0.05%'); expect(bpsPercent(0)).toBe('±0.00%'); expect(bpsPercent(1.5)).toBe('');
    expect(sharePercent(1234)).toBe('12.34%'); expect(sharePercent(7)).toBe('0.07%');
  });
  it('the report draft: 92 days accepted, 93 refused (RANGE_TOO_WIDE), order, dataset, measures, dimensions', () => {
    expect(MAX_RANGE_DAYS).toBe(92);
    expect(daysInclusive('2026-07-01', '2026-09-30')).toBe(92);
    const ok = { dataset: 'orders', dimensions: ['month'], measures: ['orders'], from: '2026-07-01', to: '2026-09-30' };
    expect(runDraftProblems(ok)).toEqual([]);
    expect(runDraftProblems({ ...ok, to: '2026-10-01' })).toEqual(['RANGE_TOO_WIDE']);
    expect(runDraftProblems({ ...ok, to: '2026-06-30' })).toEqual(['RANGE_ORDER']);
    expect(runDraftProblems({ dataset: '', dimensions: ['a', 'b', 'c', 'd'], measures: [], from: 'x', to: '' })).toEqual(['NO_DATASET', 'NO_MEASURE', 'TOO_MANY_DIMENSIONS', 'DATE_INVALID']);
  });
  it('key lists, failure codes, watermark pairs, sentences, page states', () => {
    expect(keyList(['month,crop', 'month', 'DROP TABLE'])).toEqual(['month', 'crop']);
    expect(failedCodes('ROW_CAP,<script>,STALE_ROW')).toEqual(['ROW_CAP', 'STALE_ROW']);
    expect(watermarkPairs('# report\tOrders\n# range\t2026-07-01..2026-09-30\nnot a pair')).toEqual([['report', 'Orders'], ['range', '2026-07-01..2026-09-30']]);
    expect(wordsFor({ X: { en: 'E', hi: 'H' } }, 'X', 'hi')).toBe('H');
    expect(wordsFor({ X: { en: 'E', hi: ' ' } }, 'X', 'hi')).toBe('E');
    expect(wordsFor(null, 'X', 'en')).toBeNull();
    expect(swfCodeKey('ROW_CAP')).toBe('swf.code.ROW_CAP'); expect(swfCodeKey('WHATEVER')).toBe('swf.code.unknown');
    expect(refusedKey('NO_GMV')).toBe('swf.refused.NO_GMV'); expect(refusedKey('X')).toBe('swf.refused.unknown');
    expect(swfPageState(403)).toBe('restricted'); expect(swfPageState(404)).toBe('flaggedOff'); expect(swfPageState(500)).toBe('error');
  });
});

describe('every list mirrors its source (a second copy must agree)', () => {
  it('the refused codes include every code the API refuses a figure with', () => {
    const insights = api('insights/domain/insights.ts'); const learner = api('education/domain/learner-insights.ts');
    const block = (s: string, start: string) => s.slice(s.indexOf(start), s.indexOf('}', s.indexOf(start)));
    const codes = [...block(insights, 'export const REFUSED = {').matchAll(/'([A-Z_]+)'/g), ...block(learner, 'export const LEARNER_REFUSED = {').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(13);
    for (const c of codes) expect(REFUSED_CODES).toContain(c);
    for (const c of ['NO_GMV', 'NO_MEASURED_LOSS', 'MIXED_CURRENCY']) expect(insights).toContain(`'${c}'`);
  });
  it('the 92-day cap, the cadences and the recipient roles are the API\'s', () => {
    const rb = api('insights/domain/report-builder.ts');
    expect(rb).toMatch(new RegExp(`export const MAX_RANGE_DAYS = ${MAX_RANGE_DAYS};`));
    const roles = [...rb.slice(rb.indexOf('export const RECIPIENT_ROLES'), rb.indexOf('] as const', rb.indexOf('export const RECIPIENT_ROLES'))).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(roles).toEqual([...RECIPIENT_ROLES]);
    for (const c of CADENCES) expect(migration).toContain(`'${c}'`);
  });
  it('wastage kinds and sources are the database\'s', () => {
    for (const k of WASTAGE_KINDS) expect(migration).toContain(`'${k}'`);
    for (const s of WASTAGE_SOURCES) expect(migration).toContain(`'${s}'`);
  });
  it('the database\'s own [CODE]s from 0202 are all named on these screens', () => {
    const dbCodes = [...new Set([...migration.matchAll(/\[([A-Z_]{6,})\]/g)].map((m) => m[1]))].filter((c) => !['LEARNER_CAPTURE_APPEND_ONLY', 'IDENTITY_FINAL', 'SHAPE_FINAL'].includes(c));
    expect(dbCodes.length).toBeGreaterThan(3);
    for (const c of dbCodes) expect([c, (SWF_CODES as readonly string[]).includes(c)]).toEqual([c, true]);
  });
});

describe('the pages', () => {
  const PAGES = [
    'app/insights/page.tsx', 'app/insights/InsightsNav.tsx', 'app/insights/RefusedLine.tsx',
    'app/insights/mandi-pulse/page.tsx', 'app/insights/mandi-pulse/actions.ts', 'app/insights/demand-map/page.tsx', 'app/insights/demand-map/actions.ts',
    'app/insights/wastage/page.tsx', 'app/insights/wastage/actions.ts', 'app/insights/wastage/act/page.tsx', 'app/insights/wastage/act/actions.ts',
    'app/insights/reports/page.tsx', 'app/insights/reports/act/page.tsx', 'app/insights/reports/act/actions.ts', 'app/insights/reports/runs/[id]/page.tsx',
    'app/insights/exports/[id]/page.tsx', 'app/insights/exports/[id]/actions.ts', 'app/insights/exports/[id]/download/route.ts', 'app/insights/retry/page.tsx',
    'app/studio/insights/page.tsx', 'app/canon/offline/page.tsx', 'app/api/ping/route.ts',
    'components/AsOf.tsx', 'components/OnlineGuard.tsx', 'components/StaleDiffChip.tsx',
  ];
  it.each(PAGES)('%s exists', (p) => expect(exists(p)).toBe(true));
  it('no figure is a literal: no currency symbol, no hard-coded percentage on the insights pages', () => {
    for (const p of PAGES.filter((x) => x.endsWith('.tsx'))) {
      const s = src(p).replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect([p, /₹|Rs\.|\d+(\.\d+)?%/.test(s)]).toEqual([p, false]);
    }
  });
  it('a manual wastage entry is refused by name on the screen, never offered as a form', () => {
    const w = src('app/insights/wastage/page.tsx');
    expect(w).toContain('w.refused.manualEntry.code');
    expect(w).not.toMatch(/recordWastage|manualWastage/);
  });
  const DATA_PAGES = [
    'app/dashboard/page.tsx', 'app/governance/register/import/page.tsx', 'app/governance/register/import/[id]/page.tsx', 'app/insights/governance/agm/page.tsx',
    'app/insights/governance/agm/[id]/page.tsx', 'app/money/commission/page.tsx', 'app/ops/labour/page.tsx', 'app/ops/labour/attendance/page.tsx', 'app/ops/labour/wages/page.tsx',
    'app/ops/logistics/carriers/page.tsx', 'app/ops/logistics/cod/page.tsx', 'app/ops/logistics/cold-chain/page.tsx', 'app/ops/logistics/cold-chain/[id]/page.tsx',
    'app/ops/logistics/cold-chain/breaches/page.tsx', 'app/ops/logistics/cold-chain/devices/page.tsx', 'app/ops/logistics/pod/page.tsx', 'app/ops/logistics/pod/[id]/page.tsx',
    'app/ops/logistics/routes/[id]/page.tsx', 'app/ops/logistics/routes/[id]/plan/page.tsx', 'app/ops/logistics/slots/page.tsx', 'app/ops/logistics/zones/page.tsx',
    'app/ops/schemes/page.tsx', 'app/ops/schemes/[code]/page.tsx', 'app/people/ambassadors/[id]/page.tsx', 'app/people/ambassadors/earnings/page.tsx',
    'app/people/verification/page.tsx', 'app/people/verification/[id]/page.tsx', 'app/settings/team/page.tsx', 'app/settings/team/[id]/page.tsx',
    'app/insights/mandi-pulse/page.tsx', 'app/insights/demand-map/page.tsx', 'app/insights/wastage/page.tsx', 'app/insights/reports/page.tsx', 'app/studio/insights/page.tsx',
  ];
  it.each(DATA_PAGES)('%s says how old its data is (AsOf under its heading)', (p) => expect(src(p)).toMatch(/<AsOf at=\{[^}]+\} labels=\{asOfLabels\(t\)\} \/>/));
});

describe('i18n — every SW-f key in the three launch languages with the same {vars}', () => {
  const swfKeys = Object.keys(en).filter((k) => k.startsWith('swf.') || k === 'nav.insights' || k === 'nav.learnerInsights');
  it('there are SW-f keys, and hi + gu carry every one, non-empty, with identical {vars}', () => {
    expect(swfKeys.length).toBeGreaterThan(400);
    for (const k of swfKeys) for (const [lang, cat] of CATS) {
      const v = (cat as Record<string, string>)[k];
      expect([lang, k, typeof v === 'string' && v.trim() !== '']).toEqual([lang, k, true]);
      expect([lang, k, vars(v)]).toEqual([lang, k, vars((en as Record<string, string>)[k])]);
    }
  });
  it('every code the screens can meet has a sentence; every refused code has one', () => {
    for (const c of SWF_CODES) expect((en as Record<string, string>)[`swf.code.${c}`]).toBeTruthy();
    for (const c of REFUSED_CODES) expect((en as Record<string, string>)[`swf.refused.${c}`]).toBeTruthy();
    for (const s of WASTAGE_SOURCES) expect((en as Record<string, string>)[`swf.wastage.source.${s}`]).toBeTruthy();
    for (const k of WASTAGE_KINDS) expect((en as Record<string, string>)[`swf.wastage.kind.${k}`]).toBeTruthy();
    for (const r of RECIPIENT_ROLES) expect((en as Record<string, string>)[`swf.role.${r}`]).toBeTruthy();
  });
  it('every report dataset, dimension and measure the API allows has a label', () => {
    const rb = api('insights/domain/report-builder.ts');
    const body = rb.slice(rb.indexOf('export const REPORT_DATASETS'), rb.indexOf('export interface ReportSpec'));
    expect(body.length).toBeGreaterThan(1000);
    const datasets = [...body.matchAll(/^\s{4}code: '([a-z_]+)'/gm)].map((m) => m[1]);
    expect(datasets).toEqual(['orders', 'settlements', 'listings', 'memberships', 'dairy_cycles', 'cold_chain_breaches', 'wastage_events', 'mandi_pulse']);
    for (const d of datasets) expect((en as Record<string, string>)[`swf.reports.ds.${d}`]).toBeTruthy();
    for (const m of body.matchAll(/dimensions: \[([^\n]*)/g)) for (const k of m[1].matchAll(/key: '([a-z_]+)'/g)) expect((en as Record<string, string>)[`swf.reports.dim.${k[1]}`]).toBeTruthy();
    for (const m of body.matchAll(/measures: \[([^\n]*)/g)) for (const k of m[1].matchAll(/key: '([a-z_]+)'/g)) expect((en as Record<string, string>)[`swf.reports.measure.${k[1]}`]).toBeTruthy();
  });
});
