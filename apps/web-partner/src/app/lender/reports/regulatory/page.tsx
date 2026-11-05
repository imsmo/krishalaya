// apps/web-partner/src/app/lender/reports/regulatory/page.tsx · PC-56 PARTNER-6b · W224 (canon `lender/reports/regulatory`) — AN HONEST PAGE
// THAT READS NOTHING (founder 6b-3, door Q6-A). NO partner read — no audit row, no error state of its own; the state is the platform's public
// flag map and the partners mailbox is the platform's published fact (neither is a partner read). `?form=error|review|success|failure` is the
// W2987–W2990 FORM chain (DECOR + the mailbox line, no input, no confirm page claimed) and `?act=confirm|success|failure` is W2991–W2993
// (DECOR); both are checked FIRST. Reached from W214 `/lender/reports` (the inbound edge the canon never drew). An insurer is sent to its own
// dashboard by `lenderGate()`. Certified readless by test/readless.spec.ts.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../../lib/lender';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import { LenderRegulatoryView } from '../../../../components/partner6/LenderRegulatoryView';
import { LenderChain6 } from '../../../../components/partner6/LenderChain6';
import { chain6State } from '../../../../features/partner6/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner6.regulatory.title'), robots: { index: false, follow: false } };
}

export default async function LenderRegulatoryPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const form = chain6State('regulatory_form', searchParams);
  if (form) return <LenderChain6 t={t} chain="regulatory_form" state={form} mailbox={await partnersMailbox()} />;
  const act = chain6State('regulatory_act', searchParams);
  if (act) return <LenderChain6 t={t} chain="regulatory_act" state={act} />;
  return <LenderRegulatoryView t={t} state={await lenderSwitches()} mailbox={await partnersMailbox()} />;
}
