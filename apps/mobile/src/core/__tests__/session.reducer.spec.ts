// Unit tests for the pure session state machine. No React/expo — exercises every transition + the refresh-skew
// logic, including the guard that a late TOKENS_REFRESHED can't resurrect a signed-out session.
import { sessionReducer, initialSession, needsRefresh, type SessionState } from '../auth/session.reducer';
import type { AuthTokens } from '@krishalaya/sdk-js';

const tokens: AuthTokens = { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 };

describe('sessionReducer', () => {
  it('boots to anonymous when no tokens restored', () => {
    const s = sessionReducer(initialSession, { type: 'BOOT_RESTORED', language: 'hi' });
    expect(s.status).toBe('anonymous');
    expect(s.language).toBe('hi');
  });

  it('boots to authenticated when tokens restored', () => {
    const s = sessionReducer(initialSession, { type: 'BOOT_RESTORED', language: 'en', tokens: { ...tokens, expiresAtMs: 123 } });
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('a');
    expect(s.expiresAtMs).toBe(123);
  });

  it('signs in and computes absolute expiry from nowMs', () => {
    const s = sessionReducer({ ...initialSession, status: 'anonymous' }, { type: 'SIGNED_IN', tokens, nowMs: 1_000 });
    expect(s.status).toBe('authenticated');
    expect(s.expiresAtMs).toBe(1_000 + 900_000);
  });

  it('selects role and sets language', () => {
    let s: SessionState = sessionReducer(initialSession, { type: 'SIGNED_IN', tokens, nowMs: 0 });
    s = sessionReducer(s, { type: 'ROLE_SELECTED', role: 'farmer' });
    s = sessionReducer(s, { type: 'LANGUAGE_SET', language: 'gu' });
    expect(s.activeRole).toBe('farmer');
    expect(s.language).toBe('gu');
  });

  it('PROFILE_LOADED defaults activeRole to the first server role when unset', () => {
    const s0 = sessionReducer(initialSession, { type: 'SIGNED_IN', tokens, nowMs: 0 });
    const s = sessionReducer(s0, { type: 'PROFILE_LOADED', profile: { id: 'u1', displayName: 'Ramesh', roles: ['buyer', 'farmer'], locale: 'hi' } });
    expect(s.profile?.displayName).toBe('Ramesh');
    expect(s.activeRole).toBe('buyer');
  });

  it('PROFILE_LOADED does not crash when the server response has no `roles` field (the real API contract gap)', () => {
    const s0 = sessionReducer(initialSession, { type: 'SIGNED_IN', tokens, nowMs: 0 });
    // The API's actual GET /users/me shape today carries no `roles` — this reproduces the previously-crashing
    // payload (TypeError: Cannot convert undefined value to object from `undefined[0]`).
    const legacyProfile = { id: 'u1', displayName: 'Ramesh', locale: 'hi' } as unknown as { id: string; displayName: string | null; roles: string[]; locale: string };
    expect(() => sessionReducer(s0, { type: 'PROFILE_LOADED', profile: legacyProfile })).not.toThrow();
    const s = sessionReducer(s0, { type: 'PROFILE_LOADED', profile: legacyProfile });
    expect(s.profile?.displayName).toBe('Ramesh');
    expect(s.activeRole).toBeUndefined(); // no roles to default from — degrades instead of crashing
  });

  it('PROFILE_LOADED tolerates a null/undefined profile without throwing', () => {
    const s0 = sessionReducer(initialSession, { type: 'SIGNED_IN', tokens, nowMs: 0 });
    expect(() => sessionReducer(s0, { type: 'PROFILE_LOADED', profile: undefined as any })).not.toThrow();
  });

  it('BOOT_RESTORED discards a legacy/partial persisted-tokens payload (missing refreshToken) instead of crashing', () => {
    const legacyTokens = { accessToken: 'a' } as unknown as SessionState['accessToken'] extends never ? never : any;
    const s = sessionReducer(initialSession, { type: 'BOOT_RESTORED', language: 'en', tokens: legacyTokens });
    expect(s.status).toBe('anonymous');
    expect(s.accessToken).toBeUndefined();
  });

  it('BOOT_RESTORED discards a persisted-tokens payload with a non-string accessToken', () => {
    const corrupt = { accessToken: 12345, refreshToken: 'r', expiresAtMs: 999 } as unknown as any;
    const s = sessionReducer(initialSession, { type: 'BOOT_RESTORED', language: 'en', tokens: corrupt });
    expect(s.status).toBe('anonymous');
  });

  it('signs out and keeps only the language', () => {
    const s0 = sessionReducer({ ...initialSession, language: 'gu' }, { type: 'SIGNED_IN', tokens, nowMs: 0 });
    const s = sessionReducer(s0, { type: 'SIGNED_OUT' });
    expect(s.status).toBe('anonymous');
    expect(s.language).toBe('gu');
    expect(s.accessToken).toBeUndefined();
  });

  it('does NOT resurrect a signed-out session via a late refresh', () => {
    const out = sessionReducer(initialSession, { type: 'SIGNED_OUT' });
    const s = sessionReducer(out, { type: 'TOKENS_REFRESHED', tokens, nowMs: 0 });
    expect(s.status).toBe('anonymous');
  });
});

describe('needsRefresh', () => {
  const authed = (expiresAtMs?: number): SessionState => ({ status: 'authenticated', refreshToken: 'r', expiresAtMs, language: 'en' });
  it('is false for anonymous', () => expect(needsRefresh(initialSession, 0)).toBe(false));
  it('is true within the skew window', () => expect(needsRefresh(authed(10_000), 9_000, 60_000)).toBe(true));
  it('is false when comfortably valid', () => expect(needsRefresh(authed(10_000_000), 0, 60_000)).toBe(false));
  it('is true when expiry unknown', () => expect(needsRefresh(authed(undefined), 0)).toBe(true));
});
