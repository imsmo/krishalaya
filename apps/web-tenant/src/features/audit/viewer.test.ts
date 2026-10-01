// apps/web-tenant/src/features/audit/viewer.test.ts · pure unit tests for the auditor viewer helpers.
import { validateFilters, buildAuditQuery, summarizeChange, compact, changedKeys, isUuid } from './viewer';

const UID = '11111111-1111-4111-8111-111111111111';

describe('audit/viewer — filter validation', () => {
  it('rejects bad UUIDs, bad dates, and inverted ranges', () => {
    expect(validateFilters({ entityId: 'not-a-uuid' })).toBe('entityId');
    expect(validateFilters({ actorUserId: 'nope' })).toBe('actorUserId');
    expect(validateFilters({ from: '24-06-2026' })).toBe('from');
    expect(validateFilters({ from: '2026-06-30', to: '2026-06-01' })).toBe('range');
    expect(validateFilters({ action: 'x'.repeat(121) })).toBe('action');
  });
  it('accepts a valid filter set (and empties)', () => {
    expect(validateFilters({})).toBeNull();
    expect(validateFilters({ action: 'kyc.approved', entityId: UID, from: '2026-06-01', to: '2026-06-30' })).toBeNull();
  });
  it('isUuid', () => { expect(isUuid(UID)).toBe(true); expect(isUuid('x')).toBe(false); });
});

describe('audit/viewer — query building', () => {
  it('drops empties + maps date bounds to inclusive-day ISO', () => {
    expect(buildAuditQuery({ action: ' ', entityType: 'user' })).toEqual({ entityType: 'user' });
    expect(buildAuditQuery({ from: '2026-06-01', to: '2026-06-30' })).toEqual({
      from: '2026-06-01', to: '2026-06-30',   // PC-56 TENANT-9c: the cooperative's days, not UTC instants
    });
  });
  it('ignores malformed dates', () => {
    expect(buildAuditQuery({ from: 'bad' })).toEqual({});
  });
});

describe('audit/viewer — change presentation', () => {
  it('compact renders sorted-key objects + primitives + arrays', () => {
    expect(compact({ b: 2, a: 1 })).toBe('a=1, b=2');
    expect(compact('approved')).toBe('approved');
    expect(compact([1, 2])).toBe('1, 2');
    expect(compact(null)).toBe('');
  });
  it('summarizeChange shows old → new, clips long output', () => {
    expect(summarizeChange({ status: 'pending' }, { status: 'approved' })).toBe('status=pending → status=approved');
    expect(summarizeChange(null, { status: 'approved' })).toBe('status=approved');
    expect(summarizeChange(null, null)).toBe('—');
    expect(summarizeChange(null, { note: 'x'.repeat(200) }).endsWith('…')).toBe(true);
  });
  it('changedKeys returns only the differing keys, sorted', () => {
    expect(changedKeys({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, c: 3 })).toEqual(['b']);
    expect(changedKeys({ x: 1 }, { x: 1, y: 2 })).toEqual(['y']);
    expect(changedKeys(null, { z: 1 })).toEqual(['z']);
  });
});
