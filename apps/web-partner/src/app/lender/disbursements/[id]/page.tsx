// apps/web-partner/src/app/lender/disbursements/[id]/page.tsx · PC-56 PARTNER-4b · W218 (canon `lender/disbursements/[id]`) — AN HONEST PAGE:
// a batch is prepared and confirmed by the organisation that serves the farmer, not from this console; the platform never moves a lender's
// money and a lender never moves the organisation's; and no second signature worth the name exists on the platform today (founder 4b-3 / 4b-4).
// The page makes NO read — so it writes NO audit row and has NO error state of its own (the 3b rule) — and its state is the platform's
// public, client-safe flag map (`partner_console` OFF as OFF). `[id]` is a disbursement RUN id this axis never holds, and nothing is looked
// up: every id prints this same page, which is why the inbound edge from W210 is `/lender/disbursements/pending` (recorded as a DELTA).
// `?act=confirm|success|failure` is the W2860–W2862 chain (DECOR). No nav item: the lending sub-navigation and W210 reach it.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../../lib/lender';
import { LenderBatchView } from '../../../../components/partner4/LenderBatchView';
import { LenderChain } from '../../../../components/partner4/LenderChain';
import { chain4State } from '../../../../features/partner4/refusals';
import { batchHref } from '../../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.batch.title'), robots: { index: false, follow: false } };
}

export default async function LenderBatchPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const act = chain4State('disbursement_act', searchParams);
  if (act) return <LenderChain t={t} chain="disbursement_act" state={act} back={batchHref(params.id)} />;
  return <LenderBatchView t={t} state={await lenderSwitches()} />;
}
