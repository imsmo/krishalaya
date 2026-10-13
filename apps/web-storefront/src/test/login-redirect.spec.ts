// apps/web-storefront/src/test/login-redirect.spec.ts · PC-56 STORE-1a · C4/C7 — where sign-in may send a person (same-origin only), which
// store's sign-in a protected page uses, and which tenant a sign-in page belongs to (route → host → platform).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeNext, loginPathFor, tenantSlugOfPath, pickTenantSlug, STATIC_TOP_SEGMENTS } from '../features/auth/redirect';

describe('STORE-1a · sign-in redirects', () => {
  it('safeNext: same-origin paths only', () => {
    expect(safeNext('/cart')).toBe('/cart');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', null, undefined, '/x\u0000y']) expect(safeNext(bad as string)).toBe('/');
  });
  it('a tenant page sends to THAT store\'s sign-in; a platform page to /login', () => {
    expect(loginPathFor('/anand-fpo/listings/42')).toBe('/anand-fpo/login?next=%2Fanand-fpo%2Flistings%2F42');
    expect(loginPathFor('/cart')).toBe('/login?next=%2Fcart');
    expect(loginPathFor('/checkout/pay?o=1')).toBe('/login?next=%2Fcheckout%2Fpay%3Fo%3D1');
    expect(tenantSlugOfPath('/offers/1')).toBeNull();
  });
  it('the static top-level list IS the app directory (a new route cannot be mistaken for a tenant slug)', () => {
    const dirs = readdirSync(join(__dirname, '..', 'app'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('(')).map((d) => d.name).sort();
    expect([...STATIC_TOP_SEGMENTS].sort()).toEqual(dirs);
  });
  it('which tenant a sign-in belongs to: route param, then the host header, then the platform slug', () => {
    expect(pickTenantSlug('anand-fpo', 'host-co', 'bazaar')).toBe('anand-fpo');
    expect(pickTenantSlug(null, 'host-co', 'bazaar')).toBe('host-co');
    expect(pickTenantSlug(undefined, null, 'Bazaar')).toBe('bazaar');
    expect(pickTenantSlug(null, null, null)).toBeNull();
    expect(pickTenantSlug('../etc', null, null)).toBeNull();
  });
});
