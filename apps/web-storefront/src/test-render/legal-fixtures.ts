// apps/web-storefront/src/test-render/legal-fixtures.ts · PC-56 LEGAL-1 — the policy pages' render fixture (not a test file). One mutable state `L`
// the api-client mock reads: the policy answer per slug (a PolicyPage, or an Error carrying the API's status), the platform facts (or a failure),
// and every call made (slug, lang, tenant). Mailboxes are synthetic `@example.test` values.
import type { PlatformFacts, PolicyPage, PolicySlug } from '@krishalaya/sdk-js';

export const policy = (over: Partial<PolicyPage> = {}): PolicyPage => ({
  slug: 'terms', source: 'platform', title: 'Terms of use', body: '## Who we are\n\nRun by {{platform.legal.entity_name}}.\n\n### Contact\n\n- Write to {{platform.grievance.email}}',
  language: 'en', requestedLanguage: 'en', fallbackLanguage: null, version: 3, publishedAt: '2026-11-02T10:00:00.000Z', ...over,
});
export const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

export const L: { policy: Partial<Record<PolicySlug, PolicyPage | Error>>; facts: PlatformFacts | Error | null; calls: Array<[string, string | null, string | null]> } = { policy: {}, facts: null, calls: [] };
export function resetLegal(facts: PlatformFacts): void { L.policy = {}; L.facts = facts; L.calls = []; }

const answer = async <T>(v: T | Error | undefined): Promise<T> => { if (v instanceof Error) throw v; if (v === undefined) throw httpError(404); return v; };
export const publicClient = (tenant?: string) => ({
  storefront: {
    policy: async (slug: PolicySlug, lang?: string) => { L.calls.push([`policy:${slug}`, lang ?? null, tenant ?? null]); return answer(L.policy[slug]); },
    platformFacts: async () => { L.calls.push(['platformFacts', null, tenant ?? null]); return answer(L.facts); },
  },
});
export const serverClient = () => ({});
