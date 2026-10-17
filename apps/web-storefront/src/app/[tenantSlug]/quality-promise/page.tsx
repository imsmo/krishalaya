// apps/web-storefront/src/app/[tenantSlug]/quality-promise/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W309; founders D1 / D4) — the quality promise
// under the ORGANISATION's chrome (`/quality-promise` on its own host). The SHARED screen with THIS store's `disputes` flag (the public flags read:
// ON → the dispute rules; OFF → "this organisation has not switched on disputes"; unreadable → said so).
import type { Metadata } from 'next';
import type { StorefrontFlags } from '@krishalaya/sdk-js';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { QualityPromiseScreen } from '../../../components/sweep/QualityPromiseScreen';
import { tenantChrome } from '../../../features/store4a/account';
import { disputesState } from '../../../features/sweep/quality-rules';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.quality.title'), description: t.t('sweep.quality.lead') };
}

export default async function TenantQualityPromisePage({ params }: { params: { tenantSlug: string } }) {
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(params.tenantSlug).storefront.flags(); } catch { flags = null; }
  return <QualityPromiseScreen chrome={tenantChrome(params.tenantSlug)} disputes={disputesState(flags)} />;
}
