// apps/web-storefront/src/test/session-refresh.spec.ts · PC-56 STORE-1a · C8 — THE 15-MINUTE LOGOUT IS GONE. The silent refresh used to
// call `auth.refresh(refreshToken)` with no tenant; the API requires one (422), so `clearSession()` ran and every buyer was signed out
// when the 15-minute access token lapsed. It now refreshes INTO THE SESSION'S OWN TENANT (`kv_tid`) and keeps the session.
// lib/session.ts is exercised for real; its request-scoped neighbours (cookies, the SDK client, next/navigation) are jest fakes.
const mockAuth = { refresh: jest.fn() };
const mockCookies = { access: undefined as string | undefined, refresh: 'r'.repeat(40) as string | undefined, tenant: '0190a8b2-0000-7000-8000-000000000001' as string | undefined };
const mockSet = jest.fn(); const mockClear = jest.fn();
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/api-client', () => ({ publicClient: () => ({ auth: mockAuth }) }));
jest.mock('../lib/auth', () => ({
  getSessionToken: () => mockCookies.access, getRefreshToken: () => mockCookies.refresh, getSessionTenant: () => mockCookies.tenant,
  setSession: (...a: unknown[]) => mockSet(...a), clearSession: () => mockClear(),
}));
import { refreshSession, requireSession } from '../lib/session';

const T = '0190a8b2-0000-7000-8000-000000000001';
beforeEach(() => { mockAuth.refresh.mockReset(); mockSet.mockReset(); mockClear.mockReset(); mockCookies.access = undefined; mockCookies.refresh = 'r'.repeat(40); mockCookies.tenant = T; });

describe('STORE-1a · silent refresh', () => {
  it('refreshes INTO the session tenant and keeps the session (no 15-minute logout)', async () => {
    const tokens = { accessToken: 'a2', refreshToken: 'n'.repeat(40), expiresInSec: 900 };
    mockAuth.refresh.mockResolvedValue(tokens);
    expect(await refreshSession()).toBe('a2');
    expect(mockAuth.refresh).toHaveBeenCalledWith('r'.repeat(40), T);
    expect(mockSet).toHaveBeenCalledWith(tokens, T);
    expect(mockClear).not.toHaveBeenCalled();
  });
  it('a refresh cookie with no tenant cookie is dropped (it can never refresh)', async () => {
    mockCookies.tenant = undefined;
    expect(await refreshSession()).toBeNull();
    expect(mockAuth.refresh).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalled();
  });
  it('a rejected refresh clears the session', async () => {
    mockAuth.refresh.mockRejectedValue({ status: 401, code: 'REFRESH_INVALID' });
    expect(await refreshSession()).toBeNull();
    expect(mockClear).toHaveBeenCalled();
  });
  it('requireSession sends a tenant page to THAT store\'s sign-in', async () => {
    mockCookies.refresh = undefined;
    await expect(requireSession('/anand-fpo/listings/9')).rejects.toThrow('REDIRECT /anand-fpo/login?next=%2Fanand-fpo%2Flistings%2F9');
    await expect(requireSession('/cart')).rejects.toThrow('REDIRECT /login?next=%2Fcart');
  });
});
