// apps/web-admin/src/test/tenant.spec.ts · unit tests for the pure tenant state machine + limit-override validator.
import { canApprove, canSuspend, canArchive, canTransition, isLive, isTerminal, statusKey, buildLimitOverride, validReason } from '../features/tenants/tenant';

describe('tenant state machine (mirrors admin-api)', () => {
  it('approve only from pending/trial', () => {
    expect(canApprove('pending')).toBe(true);
    expect(canApprove('trial')).toBe(true);
    expect(canApprove('active')).toBe(false);
    expect(canApprove('suspended')).toBe(false);
  });
  it('suspend only from live states', () => {
    expect(canSuspend('active')).toBe(true);
    expect(canSuspend('trial')).toBe(true);
    expect(canSuspend('grace')).toBe(true);
    expect(canSuspend('pending')).toBe(false);
    expect(canSuspend('archived')).toBe(false);
  });
  it('archive from any non-terminal/non-archived state', () => {
    expect(canArchive('pending')).toBe(true);
    expect(canArchive('active')).toBe(true);
    expect(canArchive('suspended')).toBe(true);
    expect(canArchive('archived')).toBe(false);
    expect(canArchive('terminated')).toBe(false);
  });
  it('canTransition / isLive / isTerminal', () => {
    expect(canTransition('suspended', 'active')).toBe(true);
    expect(canTransition('archived', 'active')).toBe(false);
    expect(isLive('active')).toBe(true);
    expect(isLive('suspended')).toBe(false);
    expect(isTerminal('terminated')).toBe(true);
  });
  it('statusKey guards unknown values', () => {
    expect(statusKey('active')).toBe('active');
    expect(statusKey('weird')).toBe('pending');
    expect(statusKey(null)).toBe('pending');
  });
});

describe('buildLimitOverride (float-free, mirrors zod DTO)', () => {
  it('accepts an integer-string value + reason', () => {
    expect(buildLimitOverride({ limitCode: 'max_listings', limitValue: '500', reason: 'Black Friday bump' }))
      .toEqual({ ok: true, value: { limitCode: 'max_listings', limitValue: '500', reason: 'Black Friday bump' } });
  });
  it('accepts -1 (unlimited) and an ISO expiry', () => {
    const r = buildLimitOverride({ limitCode: 'max_users', limitValue: '-1', reason: 'enterprise', expiresAt: '2026-12-31T00:00' });
    expect(r.ok).toBe(true);
    // TZ-independent (PC-29 fix — same local-midnight ISO issue as report.spec):
    if (r.ok) { expect(r.value.limitValue).toBe('-1'); expect(new Date(r.value.expiresAt as string).getTime()).toBe(new Date('2026-12-31T00:00').getTime()); }
  });
  it('rejects a bad code / float value / short reason / bad expiry', () => {
    expect(buildLimitOverride({ limitCode: 'BAD CODE', limitValue: '5', reason: 'ok x' })).toEqual({ ok: false, error: 'limitCode' });
    expect(buildLimitOverride({ limitCode: 'max_listings', limitValue: '5.5', reason: 'ok x' })).toEqual({ ok: false, error: 'limitValue' });
    expect(buildLimitOverride({ limitCode: 'max_listings', limitValue: '5', reason: 'no' })).toEqual({ ok: false, error: 'reason' });
    expect(buildLimitOverride({ limitCode: 'max_listings', limitValue: '5', reason: 'okay', expiresAt: 'not-a-date' })).toEqual({ ok: false, error: 'expiresAt' });
  });
});

describe('validReason', () => {
  it('enforces 3..500 chars', () => {
    expect(validReason('ok')).toBe(false);
    expect(validReason('valid reason')).toBe(true);
    expect(validReason('')).toBe(false);
    expect(validReason(null)).toBe(false);
  });
});
