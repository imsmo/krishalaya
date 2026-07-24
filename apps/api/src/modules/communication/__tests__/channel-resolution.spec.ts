// modules/communication/__tests__/channel-resolution.spec.ts · DEV-07: pure unit tests for the new
// applyRoutinePolicy() (Q24/DELTA-059) — no I/O, no fakes needed beyond a plain Map, matching this domain
// function's own float-free/deterministic house style (see channel-resolution.ts's own header comment).
import { applyRoutinePolicy, ROUTINE_TIERS } from '../domain/channel-resolution';
import { NotifChannel, NotifPriority } from '../domain/communication.events';

const noPrefs = new Map<NotifChannel, boolean>();

describe('ROUTINE_TIERS (Q24 tier mapping)', () => {
  it('maps exactly informational + promotional to "routine" — critical/important excluded', () => {
    expect(ROUTINE_TIERS.has('informational')).toBe(true);
    expect(ROUTINE_TIERS.has('promotional')).toBe(true);
    expect(ROUTINE_TIERS.has('critical')).toBe(false);
    expect(ROUTINE_TIERS.has('important')).toBe(false);
  });
});

describe('applyRoutinePolicy', () => {
  it('critical/important: pass-through, unchanged, no primary/fallback tracked (Q24: "unaffected")', () => {
    (['critical', 'important'] as NotifPriority[]).forEach((priority) => {
      const resolved: NotifChannel[] = ['push', 'sms', 'whatsapp'];
      const r = applyRoutinePolicy(priority, resolved, noPrefs);
      expect(r.toSendNow).toEqual(resolved);
      expect(r.primary).toBeNull();
      expect(r.fallback).toBeNull();
    });
  });

  it('informational/promotional: collapses to ONE primary (first non-passive channel) + keeps passive (inapp)', () => {
    const r = applyRoutinePolicy('informational', ['push', 'inapp'], noPrefs);
    expect(r.primary).toBe('push');
    expect(r.toSendNow.sort()).toEqual(['inapp', 'push']);
    expect(r.fallback).toBe('sms');   // sms not opted out, not already primary ⇒ eligible fallback
  });

  it('3+ candidate channels still collapse to exactly one primary — never all of them', () => {
    const r = applyRoutinePolicy('promotional', ['whatsapp', 'sms', 'push', 'email'], noPrefs);
    expect(r.primary).toBe('whatsapp');
    expect(r.toSendNow).toEqual(['whatsapp']);   // no passive channel in this list, so toSendNow is just the primary
  });

  it('no fallback proposed when the primary IS sms already (no self-fallback)', () => {
    const r = applyRoutinePolicy('promotional', ['sms', 'email'], noPrefs);
    expect(r.primary).toBe('sms');
    expect(r.fallback).toBeNull();
  });

  it('no fallback proposed when the farmer has explicitly opted out of sms for this event', () => {
    const prefs = new Map<NotifChannel, boolean>([['sms', false]]);
    const r = applyRoutinePolicy('informational', ['push', 'inapp'], prefs);
    expect(r.primary).toBe('push');
    expect(r.fallback).toBeNull();
  });

  it('empty resolved list (everything suppressed upstream) ⇒ nothing to send, no fallback', () => {
    const r = applyRoutinePolicy('promotional', [], noPrefs);
    expect(r.toSendNow).toEqual([]);
    expect(r.primary).toBeNull();
    expect(r.fallback).toBeNull();
  });

  it('only a passive channel resolved (e.g. every intrusive channel opted out) ⇒ passive kept, no primary/fallback', () => {
    const r = applyRoutinePolicy('informational', ['inapp'], noPrefs);
    expect(r.toSendNow).toEqual(['inapp']);
    expect(r.primary).toBeNull();
    expect(r.fallback).toBeNull();
  });
});
