// apps/web-storefront/src/app/(platform)/terms/page.tsx · PC-56 LEGAL-1 — the PLATFORM's published terms policy under the platform chrome
// (`/terms`). Thin: the shared screen (components/legal/PolicyScreen.tsx) reads the policy in the page's language and the platform facts for its
// tokens. No flag (0223's named Law 10 exception: legal / info pages have no kill-switch). `terms` is a reserved tenant slug (LEGAL-1).
import type { Metadata } from 'next';
import { policyMetadata, renderPolicyRoute } from '../../../components/legal/PolicyScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return policyMetadata('terms');
}

export default async function TermsPage() {
  return renderPolicyRoute('terms');
}
