// apps/web-partner/src/app/lender/kcc/[id]/drawls/page.tsx · PC-56 PARTNER-4c · W217 (canon `lender/kcc/[id]/drawls`) — AN HONEST PAGE: the
// drawl ledger is the organisation's own record of what it advanced and recovered against this loan, it is not a money movement on this
// platform, and it is NOT SHOWN HERE (founder 4c-1, taken under the founder's standing authority).
// The page makes NO READ — so it writes NO audit row and has NO error state of its own (the 3b rule) — and its state is the platform's
// public, client-safe flag map (`partner_console` OFF as OFF). Nothing is looked up, so every id prints the same page; `[id]` is a LOAN id.
// `?export=queued|ready` is the W2951–W2952 chain (DECOR + the partners-mailbox line) — this page's "Export (signed)" button is its ONLY
// trigger, though the canon's donor, crumb and Back all name W216; the built chain returns HERE. The crumb back to the KCC page is the
// canon's only non-chain inbound edge to W216 and FLOWMAP omits it. No nav item. An insurer is sent to its own dashboard.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../../../lib/lender';
import { partnersMailbox } from '../../../../../lib/partners-mailbox';
import { LenderKccDrawlsView } from '../../../../../components/partner4/LenderKccDrawlsView';
import { LenderChain } from '../../../../../components/partner4/LenderChain';
import { chain4State } from '../../../../../features/partner4/refusals';
import { kccDrawlsHref } from '../../../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.drawls.title'), robots: { index: false, follow: false } };
}

export default async function LenderKccDrawlsPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const exp = chain4State('kcc_export', searchParams);
  if (exp) return <LenderChain t={t} chain="kcc_export" state={exp} back={kccDrawlsHref(params.id)} mailbox={await partnersMailbox()} />;
  return <LenderKccDrawlsView t={t} state={await lenderSwitches()} loanId={params.id} />;
}
