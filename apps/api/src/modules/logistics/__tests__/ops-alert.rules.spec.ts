// PC-55 A6 · alert rules. An alert that cries wolf gets muted by the very people who need it, so these tests
// are about precision: validated thresholds, a dedupe key that survives a multi-pod race, honest severity.
import { validateThreshold, defaultsFor, dedupeKey, severityFor, alertTitle, ALERT_KINDS } from '../domain/ops-alert.rules';

describe('threshold validation (a typo must never silently disable a rule)', () => {
  it('accepts each kind\'s own shape', () => {
    expect(validateThreshold('cold_chain_breach', { windowHours: 6, minBreaches: 2 })).toEqual({ ok: true });
    expect(validateThreshold('device_silent', { silentHours: 12 })).toEqual({ ok: true });
    expect(validateThreshold('maintenance_due', { alert: 'service_due' })).toEqual({ ok: true });
    expect(validateThreshold('cold_chain_breach', {})).toEqual({ ok: true });      // defaults apply
  });
  it('rejects unknown keys instead of ignoring them', () => {
    expect(validateThreshold('device_silent', { silentHrs: 12 }).ok).toBe(false);   // the classic typo
    expect(validateThreshold('cold_chain_breach', { windowHours: 6, foo: 1 }).ok).toBe(false);
    expect(validateThreshold('maintenance_due', { alert: 'service_due', extra: true }).ok).toBe(false);
  });
  it('rejects out-of-range and wrong-typed values', () => {
    expect(validateThreshold('cold_chain_breach', { windowHours: 0 }).ok).toBe(false);
    expect(validateThreshold('cold_chain_breach', { windowHours: 1000 }).ok).toBe(false);
    expect(validateThreshold('device_silent', { silentHours: 1.5 }).ok).toBe(false);
    expect(validateThreshold('maintenance_due', { alert: 'whenever' }).ok).toBe(false);
  });
  it('every kind has usable day-one defaults', () => {
    for (const k of ALERT_KINDS) expect(validateThreshold(k, defaultsFor(k))).toEqual({ ok: true });
  });
});

describe('dedupeKey (never page the same human twice for one breach)', () => {
  const t0 = Date.parse('2026-08-05T10:00:00.000Z');
  it('is stable inside a cooldown bucket and changes once it passes', () => {
    const a = dedupeKey('r1', 'dev-9', t0, 60);
    expect(dedupeKey('r1', 'dev-9', t0 + 59 * 60_000, 60)).toBe(a);          // same hour bucket → suppressed
    expect(dedupeKey('r1', 'dev-9', t0 + 61 * 60_000, 60)).not.toBe(a);      // next bucket → may fire again
  });
  it('separates subjects and rules, and handles a subject-less alert', () => {
    expect(dedupeKey('r1', 'dev-9', t0, 60)).not.toBe(dedupeKey('r1', 'dev-8', t0, 60));
    expect(dedupeKey('r1', 'dev-9', t0, 60)).not.toBe(dedupeKey('r2', 'dev-9', t0, 60));
    expect(dedupeKey('r1', null, t0, 60)).toContain(':-:');
  });
  it('a shorter cooldown means more buckets (an operator can choose to be paged more often)', () => {
    expect(dedupeKey('r1', 'd', t0, 5)).not.toBe(dedupeKey('r1', 'd', t0 + 6 * 60_000, 5));
  });
});

describe('severity comes from the evidence, not the rule\'s mood', () => {
  it('escalates repeated cold-chain breaches and long silences', () => {
    expect(severityFor('cold_chain_breach', { breaches: 1 })).toBe('warning');
    expect(severityFor('cold_chain_breach', { breaches: 5 })).toBe('critical');
    expect(severityFor('device_silent', { silentHours: 12 })).toBe('warning');
    expect(severityFor('device_silent', { silentHours: 48 })).toBe('critical');
    expect(severityFor('maintenance_due', { alert: 'needs_attention' })).toBe('warning');
    expect(severityFor('maintenance_due', { alert: 'service_due' })).toBe('info');
  });
  it('titles are plain language a warehouse manager can act on', () => {
    expect(alertTitle('cold_chain_breach')).toMatch(/breach/i);
    expect(alertTitle('device_silent')).toMatch(/report/i);
    expect(alertTitle('maintenance_due')).toMatch(/maintenance/i);
  });
});
