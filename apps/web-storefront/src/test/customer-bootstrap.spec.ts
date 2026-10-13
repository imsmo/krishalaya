// apps/web-storefront/src/test/customer-bootstrap.spec.ts · PC-56 STORE-1a · C7 (founder D4) — "Buying needs nothing more": after
// sign-in the storefront grants `customer` ONLY when the token lacks it, then refreshes INTO THE SAME TENANT; the flag OFF is a named
// state; nothing is granted to someone who already buys.
import { tokenRoles, needsCustomerGrant, ensureBuyer, type TokenPair } from '../features/auth/buyer';

const jwt = (roles: string[]) => `h.${Buffer.from(JSON.stringify({ sub: 'u', tid: 't', roles })).toString('base64url')}.s`;
const pair = (roles: string[]): TokenPair => ({ accessToken: jwt(roles), refreshToken: 'r'.repeat(30), expiresInSec: 900 });
const T = '0190a8b2-0000-7000-8000-000000000001';

describe('STORE-1a · customer bootstrap', () => {
  it('reads the roles claim; a garbage token reads as no roles', () => {
    expect(tokenRoles(jwt(['farmer', 'customer']))).toEqual(['farmer', 'customer']);
    expect(tokenRoles('not-a-jwt')).toEqual([]);
    expect(needsCustomerGrant(jwt([]))).toBe(true);
    expect(needsCustomerGrant(jwt(['customer']))).toBe(false);
  });
  it('a fresh buyer: grant customer → refresh into the same tenant → granted, with the NEW tokens', async () => {
    const fresh = pair(['customer']);
    const grantCustomer = jest.fn(async () => ({ roleCode: 'customer', alreadyGranted: false, roles: ['customer'] }));
    const refresh = jest.fn(async () => fresh);
    const r = await ensureBuyer(pair([]), T, { grantCustomer, refresh });
    expect(grantCustomer).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('r'.repeat(30), T);
    expect(r).toEqual({ tokens: fresh, buyer: 'granted' });
  });
  it('already a customer: nothing is called', async () => {
    const grantCustomer = jest.fn(); const refresh = jest.fn();
    const p = pair(['customer']);
    expect(await ensureBuyer(p, T, { grantCustomer, refresh })).toEqual({ tokens: p, buyer: 'ready' });
    expect(grantCustomer).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  });
  it('selfserve_onboarding OFF (404) → signed in, buyer state "off"; any other failure → "unavailable"; the original tokens kept', async () => {
    const p = pair([]);
    expect(await ensureBuyer(p, T, { grantCustomer: async () => { throw { status: 404, code: 'NOT_FOUND' }; }, refresh: jest.fn() })).toEqual({ tokens: p, buyer: 'off' });
    expect(await ensureBuyer(p, T, { grantCustomer: async () => { throw { status: 503 }; }, refresh: jest.fn() })).toEqual({ tokens: p, buyer: 'unavailable' });
    expect(await ensureBuyer(p, T, { grantCustomer: async () => ({}), refresh: async () => { throw new Error('down'); } })).toEqual({ tokens: p, buyer: 'unavailable' });
  });
});
