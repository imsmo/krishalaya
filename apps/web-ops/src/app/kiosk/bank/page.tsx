// apps/web-ops/src/app/kiosk/bank/page.tsx · PC-56 OPS-1c · W385 (canon `kiosk/bank`) — AN HONEST PAGE THAT READS NOTHING: what she does in her
// own sign-in, and why this desk does not. Zero inputs; no API call; every refused canon line printed by name (features/ops1/refusals.ts).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { KioskStepView } from '../../../components/ops1/KioskViews';
import { KIOSK_BANK } from '../../../features/ops1/kiosk';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.kiosk.bank.title'), robots: { index: false, follow: false } };
}
export default async function KioskStepPage() {
  await requireSession(KIOSK_BANK);
  return <KioskStepView t={getTranslator()} surface="kiosk_bank" />;
}
