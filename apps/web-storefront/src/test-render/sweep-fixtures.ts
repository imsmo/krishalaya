// apps/web-storefront/src/test-render/sweep-fixtures.ts · PC-56 STORE-SWEEP-a — the shared fixture for the help, quality-promise, trust, contact,
// store-contact, about, press, store-footer and rtl-sweep-a render tests (not a test file: jest.render.config.js matches *.render.test.tsx only).
// One mutable state `S` the module mocks read: the request headers, the language, the STORE's public flags (or a failure), the platform facts
// (or a failure), the precomputed stats (or a failure), the organisation's brand, and every API call made. Every mailbox here is a synthetic
// `@example.test` value — never a real mailbox or domain.
import type { PlatformFacts, StorefrontStats, TenantBranding } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const ORG = 'Anand FPO Mandi';
export const EMPTY_FACTS: PlatformFacts = {
  legal: { entityName: null, registeredOffice: null },
  grievance: { officerName: null, address: null, email: null, ackHours: null, resolveDays: null },
  contact: { securityEmail: null, partnersEmail: null, pressEmail: null, generalEmail: null },
};
export const FULL_FACTS: PlatformFacts = {
  legal: { entityName: 'Example Agritech Private Limited', registeredOffice: '12 Example Road, Example City' },
  grievance: { officerName: 'A. Example', address: '12 Example Road, Example City', email: 'grievance@example.test', ackHours: 48, resolveDays: 30 },
  contact: { securityEmail: 'security@example.test', partnersEmail: 'partners@example.test', pressEmail: 'press@example.test', generalEmail: 'hello@example.test' },
};
export const STATS: StorefrontStats = { liveListings: 2418, verifiedOrganisations: 312, districts: 41, computedAt: '2026-10-17T09:45:00.000Z' };

export const brand = (): TenantBranding => ({
  displayName: 'Anand FPO', logoUrl: null,
  brand: { version: 3, displayName: ORG, appShortName: 'Anand Mandi', logoPath: null, logoMime: null,
    colours: { primary: '#7a3e00', accent: '#f39c12', ink: '#232a33', surface: '#ffffff' }, poweredByHidden: false, publishedAt: '2026-10-03T10:00:00.000Z' } as never,
});

export const S: {
  lang: string; headers: Record<string, string>; flags: Record<string, unknown> | Error; facts: PlatformFacts | Error; stats: StorefrontStats | Error;
  branding: TenantBranding | null; api: unknown[][];
} = { lang: 'en', headers: {}, flags: {}, facts: EMPTY_FACTS, stats: STATS, branding: brand(), api: [] };

export function reset(): void {
  S.lang = 'en'; S.headers = {}; S.flags = { online_payments: false, disputes: false, communication: true }; S.facts = EMPTY_FACTS; S.stats = STATS;
  S.branding = brand(); S.api = [];
}

const jar = () => new Map<string, string>([['kv_lang', S.lang]]);
export const cookiesImpl = () => ({
  get: (n: string) => (jar().has(n) ? { name: n, value: jar().get(n) } : undefined),
  has: (n: string) => jar().has(n),
  getAll: () => [...jar()].map(([name, value]) => ({ name, value })),
  set: () => undefined, delete: () => undefined,
});
export const headersImpl = () => new Headers({ 'accept-language': 'en', ...S.headers });

const answer = async <T>(v: T | Error): Promise<T> => { if (v instanceof Error) throw Object.assign(v, { status: 503 }); return v; };
export const publicClient = (slug?: string) => ({
  storefront: {
    flags: async () => { S.api.push(['flags', slug ?? null]); return answer(S.flags); },
    platformFacts: async () => { S.api.push(['platformFacts', slug ?? null]); return answer(S.facts); },
    stats: async () => { S.api.push(['stats', slug ?? null]); return answer(S.stats); },
    tenant: async () => ({ slug: slug ?? SLUG, displayName: 'Anand FPO' }),
  },
  lookups: { tenantBranding: async () => S.branding, categories: async () => [] },
});
export const serverClient = () => ({ cart: { get: async () => ({ items: [] }) } });
export const loadTenantShell = async (slug: string) => {
  S.api.push(['shell', slug]);
  return { kind: 'ok' as const, tenant: { slug, displayName: 'Anand FPO' }, branding: S.branding };
};
