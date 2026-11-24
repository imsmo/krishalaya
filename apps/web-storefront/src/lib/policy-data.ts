// apps/web-storefront/src/lib/policy-data.ts · PC-56 LEGAL-1 — the policy pages' two reads, side by side: the policy itself
// (`storefront.policy(slug, lang)` — the platform's on a platform route, the store's on `/<slug>/…`: the tenant rides the client's
// X-Tenant-Slug, never a parameter) in the CURRENT language, and the platform facts the body's tokens print. Three outcomes for the policy
// (features/home/load-result.ts): published, NOT FOUND (404 — nothing published yet: the page says so, never placeholder legal text), and
// UNAVAILABLE (anything else: said, with a reload). The facts read is best-effort: a failure leaves `facts` null and every token reads
// "not published yet" — the page itself never fails on it.
import type { PlatformFacts, PolicyPage, PolicySlug } from '@krishalaya/sdk-js';
import { publicClient } from './api-client';
import { loadResult, type LoadResult } from '../features/home/load-result';

export type PolicyRead = { policy: LoadResult<PolicyPage>; facts: PlatformFacts | null };

export async function loadPolicy(slug: PolicySlug, lang: string, tenantSlug?: string): Promise<PolicyRead> {
  const client = tenantSlug ? publicClient(tenantSlug) : publicClient();
  const [policy, facts] = await Promise.all([
    loadResult(() => client.storefront.policy(slug, lang)),
    loadResult(() => publicClient().storefront.platformFacts()),
  ]);
  return { policy, facts: facts.ok ? facts.data : null };
}
