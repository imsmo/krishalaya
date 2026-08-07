// PC-56 ADMIN-5c · the breach notification checklist, the posture page, and the receipt digest. Pure domain only.
// The central claim: `notified` must not be recordable on the strength of two timestamps somebody typed.
import {
  NOTIFICATION_STEPS, isNotificationStep, notifyClock, containmentMinutes, checklist, assertNotifiable,
  assertStep, totalReached, unreached, NOTIFY_WINDOW_HOURS, type StepRow,
} from '../domain/breach-notification';
import {
  CERTIFICATIONS, isHeld, publicCertificationView, tile, retentionCoverage, orderAttention, allQuietClaimable,
  type AttentionItem,
} from '../domain/posture';
import { InvalidBreachUpdateError } from '../domain/compliance-ops.errors';
import { contentDigest, canonicalise, buildReceipt, watermarkPreamble, withWatermark, DIGEST_BASIS } from '../../../core/export/receipt';

const step = (over: Partial<StepRow> = {}): StepRow => ({
  step: 'board_filing', outcome: 'done', evidenceRef: 'DPB/2026/00412', reachedCount: null,
  channel: null, note: null, performedBy: 'op-a', performedAt: '2026-07-12T09:00:00.000Z', ...over,
});
const HOUR = 3_600_000;
const DETECTED = new Date('2026-07-11T22:40:00.000Z');

describe('ADMIN-5c · THE NOTIFY GUARD — the point of the wave', () => {
  it('REFUSES when steps are outstanding, and names them', () => {
    // Before 0109 this state produced `notified` on the strength of two typed timestamps.
    const r = assertNotifiable([step()], 'op-dpo');
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'steps_outstanding') throw new Error('unreachable');
    expect(r.outstanding.sort()).toEqual(['principals_notified', 'tenant_briefed']);
  });
  it('REFUSES when every step is recorded but nobody signed off', () => {
    const all = NOTIFICATION_STEPS.map((s) => step({ step: s }));
    const r = assertNotifiable(all, null);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('no_dpo_signoff');
  });
  it('ALLOWS once all three are recorded and signed', () => {
    const all = NOTIFICATION_STEPS.map((s) => step({ step: s }));
    const r = assertNotifiable(all, 'op-dpo');
    expect(r.ok).toBe(true);
  });
  it('NOT-APPLICABLE counts as a recorded outcome', () => {
    // A synthetic-data breach affects nobody and has no tenant. Demanding a fabricated "notified 0 principals" row
    // would teach operators to type something untrue to pass a gate.
    const all = [
      step({ step: 'board_filing' }),
      step({ step: 'principals_notified', outcome: 'not_applicable', evidenceRef: null, note: 'synthetic data, no principals' }),
      step({ step: 'tenant_briefed', outcome: 'not_applicable', evidenceRef: null, note: 'platform-level, no tenant' }),
    ];
    expect(assertNotifiable(all, 'op-dpo').ok).toBe(true);
  });
  it('a RETRACTED step does not count — that is what retracting means', () => {
    const all = [
      step({ step: 'board_filing', outcome: 'retracted' }),
      step({ step: 'principals_notified' }),
      step({ step: 'tenant_briefed' }),
    ];
    const r = assertNotifiable(all, 'op-dpo');
    if (r.ok || r.reason !== 'steps_outstanding') throw new Error('unreachable');
    expect(r.outstanding).toEqual(['board_filing']);
  });
  it('an EMPTY checklist is outstanding on all three, not vacuously satisfied', () => {
    const r = assertNotifiable([], 'op-dpo');
    if (r.ok || r.reason !== 'steps_outstanding') throw new Error('unreachable');
    expect(r.outstanding.length).toBe(3);
  });
  it('the checklist reports an absent step as null, distinct from not_applicable', () => {
    const lines = checklist([step()]);
    expect(lines.find((l) => l.step === 'board_filing')!.outcome).toBe('done');
    // null = nobody looked. not_applicable = somebody decided. Different facts.
    expect(lines.find((l) => l.step === 'tenant_briefed')!.outcome).toBeNull();
  });
  it('recognises exactly the three acts W043 lists', () => {
    expect([...NOTIFICATION_STEPS]).toEqual(['board_filing', 'principals_notified', 'tenant_briefed']);
    expect(isNotificationStep('press_release')).toBe(false);
  });
});

describe('ADMIN-5c · recording a step', () => {
  it('a DONE step must carry its evidence', () => {
    expect(() => assertStep({ step: 'board_filing', outcome: 'done' })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'board_filing', outcome: 'done', evidenceRef: 'DPB/2026/00412' })).not.toThrow();
  });
  it('a NOT-APPLICABLE step must carry a reason', () => {
    // Without one it is indistinguishable from skipping.
    expect(() => assertStep({ step: 'tenant_briefed', outcome: 'not_applicable' })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'tenant_briefed', outcome: 'not_applicable', note: 'platform-level breach, no tenant' })).not.toThrow();
  });
  it('REFUSES anything that looks like raw contact details', () => {
    // A breach register is read by regulators, shared with tenants and exported — and the natural thing for somebody
    // documenting a leak at 22:40 is to paste the affected values.
    expect(() => assertStep({ step: 'board_filing', outcome: 'done', evidenceRef: 'ramesh@example.com' })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'board_filing', outcome: 'done', evidenceRef: '+919812345210' })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'principals_notified', outcome: 'done', evidenceRef: 'SMS', note: 'sent to 9812345210' })).toThrow(InvalidBreachUpdateError);
  });
  it('allows a filing reference with a short digit run', () => {
    expect(() => assertStep({ step: 'board_filing', outcome: 'done', evidenceRef: 'DPB/2026/00412' })).not.toThrow();
  });
  it('an OMITTED count stays null and is not zero', () => {
    // Omitting means nobody counted; zero means we counted and reached none.
    expect(assertStep({ step: 'principals_notified', outcome: 'done', evidenceRef: 'SMS' }).reachedCount).toBeNull();
    expect(assertStep({ step: 'principals_notified', outcome: 'done', evidenceRef: 'SMS', reachedCount: 0 }).reachedCount).toBe(0);
    expect(assertStep({ step: 'principals_notified', outcome: 'done', evidenceRef: 'SMS', reachedCount: 64 }).reachedCount).toBe(64);
  });
  it('refuses a fractional or negative count and an unknown step or outcome', () => {
    expect(() => assertStep({ step: 'principals_notified', outcome: 'done', evidenceRef: 'SMS', reachedCount: 1.5 })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'principals_notified', outcome: 'done', evidenceRef: 'SMS', reachedCount: -1 })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'press_release', outcome: 'done', evidenceRef: 'x' })).toThrow(InvalidBreachUpdateError);
    expect(() => assertStep({ step: 'board_filing', outcome: 'maybe', evidenceRef: 'x' })).toThrow(InvalidBreachUpdateError);
  });
});

describe('ADMIN-5c · the 72-hour clock', () => {
  it('states the window', () => { expect(NOTIFY_WINDOW_HOURS).toBe(72); });
  it('counts down from DETECTION', () => {
    const now = new Date(DETECTED.getTime() + 48 * HOUR);
    expect(notifyClock(DETECTED, null, now)).toEqual({ kind: 'due', hoursLeft: 24 });
  });
  it('breaches past the window', () => {
    const now = new Date(DETECTED.getTime() + 80 * HOUR);
    const c = notifyClock(DETECTED, null, now);
    expect(c.kind).toBe('breached');
    expect(c.kind === 'breached' && c.hoursOver).toBe(8);
  });
  it('a notification inside the window is MET, and late is BREACHED even though it happened', () => {
    expect(notifyClock(DETECTED, new Date(DETECTED.getTime() + 20 * HOUR), new Date()).kind).toBe('met');
    expect(notifyClock(DETECTED, new Date(DETECTED.getTime() + 100 * HOUR), new Date()).kind).toBe('breached');
  });
  it('NO DETECTION TIME is UNMEASURED, not met', () => {
    // A breach with no detection time cannot be shown to have been notified in time.
    expect(notifyClock(null, null, new Date())).toEqual({ kind: 'unmeasured' });
    expect(notifyClock(null, new Date(), new Date())).toEqual({ kind: 'unmeasured' });
  });
  it('CONTAINMENT DOES NOT STOP THE CLOCK', () => {
    // Containing fast is a different achievement. Stopping the notify clock at containment would let a
    // contained-but-unreported breach sit past its window showing green.
    const contained = new Date(DETECTED.getTime() + 25 * 60_000);
    expect(containmentMinutes(DETECTED, contained)).toBe(25);
    // …and the notify clock, given no notification, is still running past the window
    expect(notifyClock(DETECTED, null, new Date(DETECTED.getTime() + 90 * HOUR)).kind).toBe('breached');
  });
  it('containment is null when either end is missing', () => {
    expect(containmentMinutes(null, new Date())).toBeNull();
    expect(containmentMinutes(DETECTED, null)).toBeNull();
  });
});

describe('ADMIN-5c · reach', () => {
  it('sums only the steps that recorded a count', () => {
    expect(totalReached([step({ step: 'principals_notified', reachedCount: 64 }), step()])).toBe(64);
  });
  it('is NULL when nothing was counted — 0 would say we reached nobody', () => {
    expect(totalReached([step()])).toBeNull();
    expect(totalReached([])).toBeNull();
  });
  it('the shortfall is NULL when either side is unknown', () => {
    // A fabricated "0 unreached" converts "nobody counted" into "everybody was told".
    expect(unreached(64, null)).toBeNull();
    expect(unreached(null, 64)).toBeNull();
    expect(unreached(64, 60)).toBe(4);
    expect(unreached(60, 64)).toBe(0);
  });
});

describe('ADMIN-5c · the posture page', () => {
  it('a tile with no value reports a REASON, never 0', () => {
    expect(tile(null, 'the register could not be read')).toEqual({ kind: 'unavailable', reason: 'the register could not be read' });
    expect(tile(undefined, 'x')).toEqual({ kind: 'unavailable', reason: 'x' });
    expect(tile(0, 'x')).toEqual({ kind: 'value', value: 0 });
  });
  it('a NON-FINITE value is unavailable — the guard, not just the null path', () => {
    // SECOND WAVE RUNNING that a mutation test caught this exact weakness in my own tests (ADMIN-5b's optInText was the
    // first). Every case above is a shape the PRODUCER emits — null, undefined, a real 0 — so none of them exercised the
    // finiteness guard, and dropping it survived. A NaN reaching this page renders the literal text "NaN" on the screen
    // W048 calls "the page a regulator would ask to see".
    //
    // THE RULE, now stated twice: to test a guard, feed it the value the guard exists for, not the values the caller
    // usually sends.
    expect(tile(Number.NaN, 'x')).toEqual({ kind: 'unavailable', reason: 'x' });
    expect(tile(Number.POSITIVE_INFINITY, 'x')).toEqual({ kind: 'unavailable', reason: 'x' });
  });
  it('retention coverage separates runnable from unrunnable', () => {
    // The worker implements delete only; anonymise and archive have no pipeline.
    const c = retentionCoverage([
      { action: 'delete', isActive: true }, { action: 'keep_forever', isActive: true },
      { action: 'anonymise', isActive: true }, { action: 'archive', isActive: true },
      { action: 'delete', isActive: false },
    ]);
    expect(c.runnable).toBe(2);
    expect(c.unrunnable).toBe(2);
    expect(c.total).toBe(4);
    expect(c.unrunnableActions).toEqual(['anonymise', 'archive']);
    expect(c.complete).toBe(false);
  });
  it('NO policies is not "complete"', () => {
    // Otherwise an unconfigured platform reports full retention coverage.
    expect(retentionCoverage([]).complete).toBe(false);
    expect(retentionCoverage([{ action: 'delete', isActive: false }]).complete).toBe(false);
  });
  it('orders attention by severity, not recency', () => {
    const items: AttentionItem[] = [
      { id: 'c', severity: 'info', messageKey: 'x' },
      { id: 'a', severity: 'due_soon', messageKey: 'x' },
      { id: 'b', severity: 'overdue', messageKey: 'x' },
      { id: 'd', severity: 'blocking', messageKey: 'x' },
    ];
    expect(orderAttention(items).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('ALL QUIET needs an empty list AND every source read', () => {
    // An empty list assembled from registers that failed to load says "nothing needs attention" when the truth is
    // "we could not look".
    const allRead = { dsr: true, breaches: true, retention: true, consent: true };
    expect(allQuietClaimable([], allRead)).toBe(true);
    expect(allQuietClaimable([], { ...allRead, breaches: false })).toBe(false);
    expect(allQuietClaimable([{ id: 'x', severity: 'info', messageKey: 'y' }], allRead)).toBe(false);
  });
  it('only a LIVE certification is claimable', () => {
    // W048: "No certification is claimed before it is held."
    expect(isHeld({ code: 'x', name: 'x', state: 'live', note: '' })).toBe(true);
    for (const s of ['in_progress', 'planned', 'roadmap'] as const) {
      expect(isHeld({ code: 'x', name: 'x', state: s, note: '' })).toBe(false);
    }
    const view = publicCertificationView();
    expect(view.filter((c) => c.claimable).map((c) => c.code)).toEqual(['dpdp_2023']);
    // the unheld ones are LISTED, not filtered out — a page showing only what we hold looks curated
    expect(view.length).toBe(CERTIFICATIONS.length);
  });
});

describe('ADMIN-5c · the receipt digest the law promised on five surfaces and never carried', () => {
  const cols = [['a', 'a'], ['b', 'b']];
  const rows = [{ a: 1, b: 2 }];

  it('is a sha256 hex digest', () => {
    expect(contentDigest(cols, rows)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is STABLE across key order — the same data hashes the same', () => {
    expect(contentDigest(cols, [{ a: 1, b: 2 }])).toBe(contentDigest(cols, [{ b: 2, a: 1 }]));
  });
  it('CHANGES when the data changes', () => {
    expect(contentDigest(cols, [{ a: 1, b: 2 }])).not.toBe(contentDigest(cols, [{ a: 1, b: 3 }]));
  });
  it('CHANGES when only the COLUMNS change', () => {
    // The same values under different headers are a different file to whoever reads it.
    expect(contentDigest([['a', 'a']], rows)).not.toBe(contentDigest([['A', 'a']], rows));
  });
  it('does NOT sort arrays — row order is meaning', () => {
    expect(contentDigest(cols, [{ a: 1 }, { a: 2 }])).not.toBe(contentDigest(cols, [{ a: 2 }, { a: 1 }]));
  });
  it('canonicalises dates and undefined deterministically', () => {
    expect(canonicalise({ d: new Date('2026-08-07T00:00:00.000Z') })).toBe('{"d":"2026-08-07T00:00:00.000Z"}');
    expect(canonicalise({ u: undefined })).toBe('{"u":null}');
  });
  it('the receipt carries the digest AND names what it covers', () => {
    // Overstating the guarantee would be the same mistake as omitting it: this covers the DATA, not the delivered bytes.
    const r = buildReceipt({ id: 'r1', report: 'schemes', generatedAt: new Date('2026-08-07T00:00:00.000Z'), generatedBy: 'op-a', columns: cols, rows, truncated: false, fileName: 'f.csv' });
    expect(r.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.digestBasis).toBe(DIGEST_BASIS);
    expect(r.rowCount).toBe(1);
  });
  it('the watermark names the receipt, the requester and the digest — and does NOT claim a signature', () => {
    const r = buildReceipt({ id: 'r1', report: 'schemes', generatedAt: new Date(), generatedBy: 'op-a', columns: cols, rows, truncated: false, fileName: 'f.csv' });
    const lines = watermarkPreamble(r);
    expect(lines.join(' ')).toContain('receipt=r1');
    expect(lines.join(' ')).toContain('requested-by=op-a');
    expect(lines.join(' ')).toContain(r.contentSha256);
    // The one thing it must not imply.
    expect(lines.join(' ')).toMatch(/NOT cryptographically signed/);
    // every line is a CSV comment, so a parser can skip them
    for (const l of lines) expect(l.startsWith('#')).toBe(true);
  });
  it('the watermark goes ABOVE the csv, leaving the csv intact', () => {
    const r = buildReceipt({ id: 'r1', report: 'x', generatedAt: new Date(), generatedBy: 'op', columns: cols, rows, truncated: false, fileName: 'f.csv' });
    const out = withWatermark('a,b\r\n1,2', r);
    expect(out.endsWith('a,b\r\n1,2')).toBe(true);
    expect(out.split('\r\n')[0].startsWith('#')).toBe(true);
  });
});
