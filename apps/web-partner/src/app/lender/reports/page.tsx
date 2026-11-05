// apps/web-partner/src/app/lender/reports/page.tsx · PC-56 PARTNER-5c · W214 (canon `lender/reports`) — THE PROMISE THE PLATFORM SETS
// (founder 5c-1 / 5c-2; door Q7 option A). ONE read: PARTNER-1a's `GET /v1/partner/dashboard` (one partner-realm audit row per read, already
// written by that service), of which ONLY the `sla` block and `computedAt` are printed — no new route, no new SDK method, no second
// percentile, no latency arithmetic here. The partner's own name comes from the `/me` the kind gate already read; the partners mailbox from
// the platform's published facts. `?export=queued|ready` is the W3009–W3010 chain (DECOR + the mailbox line) and is checked FIRST;
// `?act=confirm|success|failure` is W3011–W3013 (PARITY-DECOR: the only trigger is Retry, a re-read). Both BEFORE any read. An insurer is
// sent to its own dashboard.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../lib/lender';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import type { PartnerDashboard } from '@krishalaya/sdk-js';
import { LenderReportsView } from '../../../components/partner5/LenderReportsView';
import { LenderChain5 } from '../../../components/partner5/LenderChain5';
import { chain5State } from '../../../features/partner5/refusals';
import { slaState } from '../../../features/partner5/figures';
import type { LenderFailure } from '../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner5.sla.title'), robots: { index: false, follow: false } };
}

export default async function LenderReportsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  const me = await lenderGate();
  const exp = chain5State('sla_export', searchParams);
  if (exp) return <LenderChain5 t={t} chain="sla_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain5State('sla_act', searchParams);
  if (act) return <LenderChain5 t={t} chain="sla_act" state={act} />;
  let d: PartnerDashboard | null = null; let failure: LenderFailure | null = null;
  try {
    d = await partnerClient().partner.dashboard();
  } catch (e) { failure = await lenderFailure(e); }
  const sla = d?.sla ?? null;
  return (
    <LenderReportsView t={t} lang={lang} state={slaState(sla, failure)} sla={sla} computedAt={d?.computedAt ?? null}
      orgName={me?.organisation?.name ?? null} mailbox={await partnersMailbox()} />
  );
}
