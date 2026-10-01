// modules/audit/__tests__/audit-cursor.spec.ts · pure keyset-cursor codec (no DB).
// [PC-56 TENANT-9a · F-7] the cursor carries the MICROSECOND instant the database printed; a millisecond one is refused.
import { encodeAuditCursor, decodeAuditCursor } from '../domain/audit.cursor';

describe('audit/cursor — opaque keyset codec', () => {
  it('round-trips the microsecond instant + id', () => {
    const ts = '2026-06-24T10:00:00.123456Z';
    expect(decodeAuditCursor(encodeAuditCursor(ts, '12345'))).toEqual({ ts, id: '12345' });
  });
  it('refuses a millisecond instant (the F-7 defect) at encode, and a legacy millisecond cursor decodes to page one', () => {
    expect(() => encodeAuditCursor('2026-06-24T10:00:00.000Z', '9')).toThrow();
    expect(decodeAuditCursor(Buffer.from('2026-06-24T10:00:00.000Z|9').toString('base64'))).toBeUndefined();
  });
  it('returns undefined for empty / malformed cursors (never throws)', () => {
    expect(decodeAuditCursor(undefined)).toBeUndefined();
    expect(decodeAuditCursor('')).toBeUndefined();
    expect(decodeAuditCursor(Buffer.from('no-delimiter').toString('base64'))).toBeUndefined();
    expect(decodeAuditCursor('!!!not base64!!!')).toBeUndefined();
  });
});
