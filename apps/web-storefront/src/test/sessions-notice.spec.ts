// apps/web-storefront/src/test/sessions-notice.spec.ts · PC-56 STORE-1a · C7 (founder D5) — the "other session" notice: device family +
// last active, the most recent OTHER live session; never a city (the input has no place to carry one).
import { otherSessionNotice, agoOf, familyKey } from '../features/auth/sessions-notice';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const s = (id: string, o: Partial<{ deviceFamily: 'android' | 'ios' | 'web' | null; current: boolean; lastSeenAt: string; expiresAt: string; revokedAt: string | null }>) => ({
  id, deviceFamily: null, current: false, lastSeenAt: '2026-10-13T10:00:00Z', expiresAt: '2026-11-01T00:00:00Z', revokedAt: null, ...o,
});

describe('STORE-1a · other-session notice', () => {
  it('only this session → no notice', () => {
    expect(otherSessionNotice([s('a', { current: true })], NOW)).toBeNull();
  });
  it('the most recent other LIVE session (revoked / expired / current ignored)', () => {
    const n = otherSessionNotice([
      s('me', { current: true, lastSeenAt: '2026-10-13T11:59:00Z' }),
      s('old', { deviceFamily: 'web', lastSeenAt: '2026-10-10T12:00:00Z' }),
      s('phone', { deviceFamily: 'android', lastSeenAt: '2026-10-13T10:00:00Z' }),
      s('gone', { deviceFamily: 'ios', lastSeenAt: '2026-10-13T11:58:00Z', revokedAt: '2026-10-13T11:58:30Z' }),
      s('dead', { deviceFamily: 'ios', lastSeenAt: '2026-10-13T11:57:00Z', expiresAt: '2026-10-13T11:00:00Z' }),
    ], NOW);
    expect(n).toEqual({ familyKey: 'auth.device.android', agoKey: 'auth.ago.hours', agoN: 2, count: 2 });
  });
  it('families and ages', () => {
    expect(familyKey(null)).toBe('auth.device.unknown');
    expect(familyKey('ios')).toBe('auth.device.ios');
    expect(agoOf('2026-10-13T11:59:30Z', NOW)).toEqual({ key: 'auth.ago.now', n: 0 });
    expect(agoOf('2026-10-13T11:15:00Z', NOW)).toEqual({ key: 'auth.ago.minutes', n: 45 });
    expect(agoOf('2026-10-10T12:00:00Z', NOW)).toEqual({ key: 'auth.ago.days', n: 3 });
  });
});
