// apps/web-partner/src/app/lender/consents/page.tsx · PC-56 PARTNER-6b · W213 (canon `lender/consents`) — AN HONEST PAGE THAT READS NOTHING AND
// SHOWS NO ONE (founder 6b-1, door Q3-A; 6b-2 / Q4-A for its words). The page makes NO partner read — so it writes NO audit row and has NO
// error state of its own — and its state is the platform's public, client-safe flag map (`partner_console` OFF prints OFF).
// `?export=queued|ready` is the W2921–W2922 chain (DECOR + the partners mailbox line) and `?act=confirm|success|failure` is W2923–W2925 (DECOR —
// Retry on a page that reads nothing re-reads nothing); both are checked FIRST. An insurer is sent to its own dashboard by `lenderGate()`.
// `/consents` answers a real 307 here (next.config.js). Certified readless by test/readless.spec.ts.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../lib/lender';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import { LenderConsentsView } from '../../../components/partner6/LenderConsentsView';
import { LenderChain6 } from '../../../components/partner6/LenderChain6';
import { chain6State } from '../../../features/partner6/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner6.consents.title'), robots: { index: false, follow: false } };
}

export default async function LenderConsentsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const exp = chain6State('consents_export', searchParams);
  if (exp) return <LenderChain6 t={t} chain="consents_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain6State('consents_act', searchParams);
  if (act) return <LenderChain6 t={t} chain="consents_act" state={act} />;
  return <LenderConsentsView t={t} state={await lenderSwitches()} />;
}
