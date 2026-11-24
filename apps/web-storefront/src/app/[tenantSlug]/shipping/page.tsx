// apps/web-storefront/src/app/[tenantSlug]/shipping/page.tsx · PC-56 LEGAL-1 — a STORE's shipping policy under the organisation's chrome (`/<slug>/shipping`,
// and `/shipping` on its own host — brand-theme.ts `hostRewritePath`). The API answers the store's own published policy or the platform's (`source`);
// the tenant rides the client's X-Tenant-Slug. No flag (0223's named Law 10 exception: legal / info pages have no kill-switch).
import type { Metadata } from 'next';
import { policyMetadata, renderPolicyRoute } from '../../../components/legal/PolicyScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return policyMetadata('shipping');
}

export default async function TenantShippingPage(props: { params: Promise<{ tenantSlug: string }> }) {
  const params = await props.params;
  return renderPolicyRoute('shipping', params.tenantSlug);
}
