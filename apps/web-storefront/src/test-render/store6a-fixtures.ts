// apps/web-storefront/src/test-render/store6a-fixtures.ts · PC-56 STORE-6a — the shared fixture for the offline / queued / install / chain / chrome
// render tests (not a test file: jest.render.config.js matches *.render.test.tsx only). One mutable state `C` the module mocks read:
//   • a cookie JAR that records every name asked for (so a test can prove the shell read no session cookie);
//   • the REQUEST headers the middleware would have set (`x-kv-shell`, `x-kv-cacheable`, `x-kv-tenant-slug`);
//   • the organisation's public brand and public flags, and every API call made.
import type { TenantBranding } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const ORG = 'Anand FPO Mandi';
export const SESSION = {
  kv_session: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMTkwYThiMi0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMGEifQ.sig', kv_refresh: 'refresh-token-6a',
  kv_tid: '0190a8b2-0000-7000-8000-0000000000aa', kvs_owner: 'AAAAAAAAAAAAAAAAAAAAAA',
};
export const T = '01a10000-0000-7000-8000-00000000000a';
export const brandWith = (o: Record<string, unknown> = {}): TenantBranding => ({
  displayName: 'Anand FPO', logoUrl: null,
  brand: { version: 3, displayName: ORG, appShortName: 'Anand Mandi', logoPath: null, logoMime: null,
    colours: { primary: '#7a3e00', accent: '#f39c12', ink: '#232a33', surface: '#ffffff' }, poweredByHidden: false, publishedAt: '2026-10-03T10:00:00.000Z', ...o } as never,
});

export const C: {
  lang: string; jar: Map<string, string>; read: string[]; headers: Record<string, string>;
  flags: Record<string, unknown> | Error; branding: TenantBranding | null; api: unknown[][]; cart: number;
} = { lang: 'en', jar: new Map(), read: [], headers: {}, flags: { storefront_offline_reads: true, storefront_pwa: true }, branding: brandWith(), api: [], cart: 3 };

export function reset(): void {
  C.lang = 'en'; C.jar = new Map(); C.read = []; C.headers = {}; C.flags = { storefront_offline_reads: true, storefront_pwa: true };
  C.branding = brandWith(); C.api = []; C.cart = 3;
}
export function withCookies(c: Record<string, string>): void { C.jar = new Map(Object.entries(c)); C.read = []; }

export const cookiesImpl = () => ({
  get: (n: string) => { C.read.push(n); return C.jar.has(n) ? { name: n, value: C.jar.get(n) } : undefined; },
  has: (n: string) => { C.read.push(n); return C.jar.has(n); },
  getAll: () => { C.read.push('*'); return [...C.jar].map(([name, value]) => ({ name, value })); },
  set: () => undefined, delete: () => undefined,
});
export const headersImpl = () => new Headers({ 'accept-language': 'en', ...C.headers });

export const publicClient = (slug?: string) => ({
  storefront: {
    flags: async () => { C.api.push(['flags', slug ?? null]); if (C.flags instanceof Error) throw C.flags; return C.flags; },
    tenant: async () => { C.api.push(['tenant', slug ?? null]); return { slug: slug ?? SLUG, displayName: 'Anand FPO' }; },
  },
  lookups: { tenantBranding: async () => { C.api.push(['branding', slug ?? null]); return C.branding; }, categories: async () => { C.api.push(['categories', slug ?? null]); return []; } },
});
export const serverClient = () => ({ cart: { get: async () => { C.api.push(['cart']); return { items: Array.from({ length: C.cart }, () => ({})) }; } } });
export const loadTenantShell = async (slug: string) => {
  C.api.push(['shell', slug]);
  return { kind: 'ok' as const, tenant: { slug, displayName: 'Anand FPO' }, branding: C.branding };
};
