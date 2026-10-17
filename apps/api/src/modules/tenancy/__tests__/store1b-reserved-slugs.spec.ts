// modules/tenancy/__tests__/store1b-reserved-slugs.spec.ts · PC-56 STORE-1b · A3 (GAP-B20) — no organisation can take a storefront route as
// its address. The code list mirrors migration 0204's seed (read from the file — a name added on one side only turns this red); signup
// never offers a reserved candidate; the database's refusal is recognised so the service answers SIGNUP_SLUG_RESERVED by name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESERVED_TENANT_SLUGS, isReservedSlug, isReservedSlugViolation, slugCandidates } from '../domain/signup';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations');
// PC-56 STORE-1c: migration 0205 adds ONE name (`for-organisations`, canon W307's route) — the code list mirrors BOTH seeds
// PC-56 STORE-2a: migration 0207 adds ONE more (`sellers`, the organisation's seller page under a tenant store) — all three seeds now
// PC-56 STORE-3c: migration 0212 adds ONE more (`g`, the platform door to a group lot — canon W279)
// PC-56 STORE-5b: migration 0219 adds ONE more (`certificates`, the platform's certificate page — canon W305)
// PC-56 HOTFIX-8: migration 0220 adds ONE more (`sw.js`, the service worker served by a route at the origin's root)
const MIGRATIONS = ['0204_storefront_home.sql', '0205_org_signup_flag_plans.sql', '0207_storefront_browse.sql', '0212_store3c_settlement_outcome.sql', '0219_store5b_trace_certificates.sql', '0220_hotfix8_reserved_slug_sw.sql'].map((f) => join(MIGRATIONS_DIR, f));
const STOREFRONT_APP = join(__dirname, '..', '..', '..', '..', '..', 'web-storefront', 'src', 'app');

function seededSlugs(): string[] {
  return MIGRATIONS.flatMap((file) => {
    const sql = readFileSync(file, 'utf8');
    const block = sql.slice(sql.indexOf('INSERT INTO reserved_tenant_slugs'), sql.indexOf('ON CONFLICT (slug) DO NOTHING;', sql.indexOf('INSERT INTO reserved_tenant_slugs')));
    return [...block.matchAll(/\('([^']+)',\s*'/g)].map((m) => m[1]);
  });
}

describe('STORE-1b · reserved tenant slugs', () => {
  it('the code list IS the migration\'s seed (same names, no duplicates)', () => {
    const seeded = seededSlugs();
    expect(seeded.length).toBe(51);   // 0204's 46 + 0205's for-organisations + 0207's sellers + 0212's g + 0219's certificates + 0220's sw.js
    expect([...seeded].sort()).toEqual([...RESERVED_TENANT_SLUGS].sort());
    expect(new Set(RESERVED_TENANT_SLUGS).size).toBe(RESERVED_TENANT_SLUGS.length);
  });

  it('every top-level static route of the storefront (and its route groups) is reserved', () => {
    const { readdirSync } = jest.requireActual('node:fs') as typeof import('node:fs');
    const segments = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (!e.isDirectory()) return [];
      if (/^\(.+\)$/.test(e.name)) return segments(join(dir, e.name));      // a route group adds no URL segment
      if (e.name.startsWith('[') || e.name.startsWith('_')) return [];        // the [tenantSlug] param itself, private folders
      return [e.name];
    });
    const routes = segments(STOREFRONT_APP);
    expect(routes.length).toBeGreaterThan(15);
    expect(routes.filter((r) => !isReservedSlug(r))).toEqual([]);
  });

  it('signup never offers a reserved candidate: "Cart" starts at cart-2; ordinary names are untouched', () => {
    const c = slugCandidates('Cart');
    expect(c[0]).toBe('cart-2');
    expect(c.every((x) => !isReservedSlug(x))).toBe(true);
    expect(slugCandidates('Login Farmers')[0]).toBe('login-farmers');
    expect(slugCandidates('Kisan Producer Company')[0]).toBe('kisan-producer-company');
    expect(isReservedSlug(' LOGIN ')).toBe(true); expect(isReservedSlug('anand-fpo')).toBe(false);
  });

  it('the database wall is recognised by its code AND its marker — nothing else is', () => {
    expect(isReservedSlugViolation({ code: '23514', message: '[TENANT_SLUG_RESERVED] "login" is a storefront route' })).toBe(true);
    expect(isReservedSlugViolation({ code: '23514', message: 'some other check' })).toBe(false);
    expect(isReservedSlugViolation({ code: '23505', message: '[TENANT_SLUG_RESERVED]' })).toBe(false);
    expect(isReservedSlugViolation(null)).toBe(false);
  });
});
