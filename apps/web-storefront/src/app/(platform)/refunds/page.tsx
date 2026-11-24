// apps/web-storefront/src/app/(platform)/refunds/page.tsx · PC-56 LEGAL-1 — the PLATFORM's published refunds policy under the platform chrome
// (`/refunds`). Thin: the shared screen (components/legal/PolicyScreen.tsx) reads the policy in the page's language and the platform facts for its
// tokens. No flag (0223's named Law 10 exception: legal / info pages have no kill-switch). `refunds` is a reserved tenant slug (LEGAL-1).
import type { Metadata } from 'next';
import { policyMetadata, renderPolicyRoute } from '../../../components/legal/PolicyScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return policyMetadata('refunds');
}

export default async function RefundsPage() {
  return renderPolicyRoute('refunds');
}
