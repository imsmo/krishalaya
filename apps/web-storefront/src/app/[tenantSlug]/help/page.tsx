// apps/web-storefront/src/app/[tenantSlug]/help/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W311; founders D4 / D8) — Help under the ORGANISATION's
// chrome (`/help` on its own host — brand-theme.ts `hostRewritePath`). The SHARED screen with THIS store's public flags: the money answer is the
// store's `online_payments` (ON → the escrow sentence; OFF → pay on delivery, nothing held); an unreadable flag read prints both and says so.
// Organisation-neutral words — no platform name.
import type { Metadata } from 'next';
import type { StorefrontFlags } from '@krishalaya/sdk-js';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { HelpScreen } from '../../../components/sweep/HelpScreen';
import { tenantChrome } from '../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('help.title'), description: t.t('help.lead') };
}

export default async function TenantHelpPage({ params }: { params: { tenantSlug: string } }) {
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(params.tenantSlug).storefront.flags(); } catch { flags = null; }
  return <HelpScreen chrome={tenantChrome(params.tenantSlug)} flags={flags} />;
}
