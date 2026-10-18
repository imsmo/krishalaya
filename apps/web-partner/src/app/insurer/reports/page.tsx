// apps/web-partner/src/app/insurer/reports/page.tsx · PC-56 PARTNER-2b · W254 (canon `insurer/reports`) — AN HONEST PAGE: "Signed extracts for
// your filings are not available from the partner console yet" (no partner export plane — P2-B6, founder 2b-1); "we never file for you" (true);
// "View policies" (real); every regulatory and payout claim refused by name. It reads NO insurer figure (so it writes no audit row): its state
// is the platform's public flag map (`partner_console`, `insurance` — OFF as OFF). `?form=error|review|success|failure` is the reports page's
// own DECOR state for "Generate Q1 pack" (the canon sends it to the PRODUCT form chain — F-18). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { insurerGate, insurerSwitches } from '../../../lib/insurer';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import { InsurerReportsView } from '../../../components/partner2/InsurerReportsView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.reports.title'), robots: { index: false, follow: false } };
}

export default async function InsurerReportsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await insurerGate();
  const form = chain2State('reports_form', searchParams);
  if (form) return <InsurerChain t={t} chain="reports_form" state={form} mailbox={await partnersMailbox()} />;
  return <InsurerReportsView t={t} state={await insurerSwitches()} />;
}
