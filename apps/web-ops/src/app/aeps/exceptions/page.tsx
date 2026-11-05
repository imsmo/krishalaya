// apps/web-ops/src/app/aeps/exceptions/page.tsx · PC-56 OPS-1b · W392 (canon `aeps/exceptions`) — A READ: the AePS events that did not go
// straight through. Default: the operator's OWN events (`GET /v1/ambassadors/aeps/events/mine`, not audited — her own log). `?view=all`: the
// supervisor read (`GET /v1/ambassadors/aeps/events`, `ambassador.manage`) — the server writes ONE audit row per read (HOTFIX-10), so this page
// asks for it only when the supervisor view is chosen, and says so. `/money/oversight` answers a REAL 307 to `?view=all`. No customer, bank
// or account column (Q7-A: a record holds no person); no row drill-in; amounts through the money formatter only.
import type { Metadata } from 'next';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { AepsExceptionsView, type AepsEventView } from '../../../components/ops1/AepsViews';
import { AEPS_EXCEPTIONS, exceptionsState, exceptionsView, isException } from '../../../features/ops1/aeps';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.aeps.exceptions.title'), robots: { index: false, follow: false } };
}

export default async function AepsExceptionsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(AEPS_EXCEPTIONS);
  const t = getTranslator(); const lang = getLang();
  const view = exceptionsView(searchParams);
  let rows: AepsEventView[] = []; let result: 'ok' | number | 'failed' = 'ok';
  try {
    const client = opsClient();
    rows = (view === 'all' ? await client.ambassadors.aepsOversight({ limit: 200 }) : await client.ambassadors.myAepsEvents(200)) as AepsEventView[];
  } catch (e) { result = e instanceof SdkError ? e.status : 'failed'; }
  return <AepsExceptionsView t={t} lang={lang} view={view} state={exceptionsState(view, result, rows.filter(isException).length)} rows={rows} />;
}
