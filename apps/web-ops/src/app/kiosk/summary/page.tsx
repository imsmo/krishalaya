// apps/web-ops/src/app/kiosk/summary/page.tsx · PC-56 OPS-1c · W388 (canon `kiosk/summary`) — AN HONEST PAGE THAT READS NOTHING: what this desk
// did (an account for a new number — never "member": no tenant role is written), the founder's Q4-A′ sentence ("Creating your account at this
// desk pays the helper nothing, and you pay nothing." — no plan read, no amount), Q11-A's helpline line (no organisation helpline field exists,
// so "not published yet"), and that nothing done here can be undone from this desk.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { KioskSummaryView } from '../../../components/ops1/KioskViews';
import { KIOSK_SUMMARY } from '../../../features/ops1/kiosk';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.kiosk.summary.title'), robots: { index: false, follow: false } };
}
export default async function KioskSummaryPage() {
  await requireSession(KIOSK_SUMMARY);
  return <KioskSummaryView t={getTranslator()} />;
}
