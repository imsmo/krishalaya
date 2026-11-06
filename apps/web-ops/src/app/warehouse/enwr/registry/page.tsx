// apps/web-ops/src/app/warehouse/enwr/registry/page.tsx · PC-56 OPS-2b · W376 (canon `warehouse/enwr/registry`) — the eNWR REGISTER: a READ of the
// organisation's receipt RECORDS (founder Q3-A, Q4-A, Q9-A, Q10-A). The one read is the EXISTING `GET /v1/warehousing/nwr?box=all` (warehouse.manage;
// the SDK's `box` is this wave's minimal fix, as OPS-2c's was for warehouses), keyset-paged; the one input is a GET page-size select (25 / 50).
// `?export=queued|ready` is the W3313–W3314 chain (DECOR — "Export register", Q10-A), checked FIRST, before the read; its Back returns HERE.
import type { Metadata } from 'next';
import { SdkError, type NwrReceipt } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { opsClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { EnwrRegistryView } from '../../../../components/ops2/EnwrViews';
import { Ops2Chain } from '../../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../../features/ops2/refusals';
import { parseCursor } from '../../../../features/ops2/billing';
import { parsePageSize, registryState } from '../../../../features/ops2/receipts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.enwrRegistry.title'), robots: { index: false, follow: false } };
}

export default async function EnwrRegistryPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/enwr/registry');
  const t = getTranslator(); const lang = getLang();
  const exp = chain2State('enwr_export', searchParams);
  if (exp) return <Ops2Chain t={t} chain="enwr_export" state={exp} />;
  const size = parsePageSize(searchParams?.size);
  let receipts: NwrReceipt[] = []; let nextCursor: string | null = null; let status: 'ok' | number | 'failed' = 'ok';
  try {
    const p = await opsClient().warehousing.nwrs({ box: 'all', cursor: parseCursor(searchParams?.cursor), limit: size });
    receipts = p.items; nextCursor = p.nextCursor;
  } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  return <EnwrRegistryView t={t} lang={lang} state={registryState(status, receipts.length)} receipts={receipts} size={size} nextCursor={nextCursor} />;
}
