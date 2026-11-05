// apps/web-partner/src/app/account/notifications/page.tsx · PC-56 PARTNER-6c · W270 (canon `account/notifications`) — AN HONEST PAGE THAT READS
// NOTHING (founder 6c-1, door Q5-A), for EVERY partner person (no kind gate: any partner kind may open it). The page makes NO partner read — so
// it writes NO audit row and has NO error state of its own — and its state is the platform's public, client-safe flag map
// (lib/console-flag.ts; `partner_console` OFF prints OFF). `?act=confirm|success|failure` is the W2967–W2969 chain ("Mark all read", DECOR,
// refused by name), checked FIRST. `/notifications` answers a real 307 here (next.config.js). Certified readless by test/readless.spec.ts.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { partnerConsoleSwitch } from '../../../lib/console-flag';
import { AccountNotificationsView } from '../../../components/partner6/AccountNotificationsView';
import { AccountChain6 } from '../../../components/partner6/AccountChain6';
import { chain6State } from '../../../features/partner6/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner6.notifications.title'), robots: { index: false, follow: false } };
}

export default async function AccountNotificationsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  const act = chain6State('notifications_act', searchParams);
  if (act) return <AccountChain6 t={t} chain="notifications_act" state={act} />;
  return <AccountNotificationsView t={t} state={await partnerConsoleSwitch()} />;
}
