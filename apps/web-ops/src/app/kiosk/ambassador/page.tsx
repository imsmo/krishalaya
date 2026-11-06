// apps/web-ops/src/app/kiosk/ambassador/page.tsx · PC-56 OPS-1c · W389 (canon `kiosk/ambassador`) — A READ of her OWN earning rows
// (`GET /v1/ambassadors/me/earnings`, newest first, the server's amounts through the money formatter). No total (none is returned), no rate, no
// "×" or "=", no percentage. No pay-run read: `GET /v1/ambassadors/payout-runs` needs `ambassador.payout.prepare` / `ambassador.payout`
// (payout-runs.controller.ts `assertRunReader`), so no run is her own to read — the page says so. Her organisation's ambassador managers
// (`ambassador.manage`) can also read her earnings (`GET /v1/ambassadors/:id/earnings`) — the page says that too.
import type { Metadata } from 'next';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { KioskEarningsView, type KioskEarningView } from '../../../components/ops1/KioskViews';
import { KIOSK_EARNINGS, kioskReadState } from '../../../features/ops1/kiosk';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.kiosk.earnings.title'), robots: { index: false, follow: false } };
}

export default async function KioskEarningsPage() {
  await requireSession(KIOSK_EARNINGS);
  const t = getTranslator(); const lang = getLang();
  let rows: KioskEarningView[] = []; let result: 'ok' | { status: number; code?: string } | 'failed' = 'ok';
  try { rows = (await opsClient().ambassadors.myEarnings({ limit: 100 })).items as KioskEarningView[]; }
  catch (e) { result = e instanceof SdkError ? { status: e.status, code: e.code } : 'failed'; }
  return <KioskEarningsView t={t} lang={lang} state={kioskReadState(result)} rows={rows} />;
}
