// apps/web-partner/src/app/insurer/policies/[id]/page.tsx · PC-56 PARTNER-2a · W250 (canon `insurer/policies/[id]`) — ONE policy on this
// insurer's products, policy facts only (`GET /v1/partner/insurance/policies/:id`, audited). `?act=confirm|success|failure` is the W2888–W2890
// chain (PARITY-DECOR: Retry is a re-read; Issue / Cancel / Endorse are not done here — founder Q5), `?export=queued|ready` W2886–W2887 (DECOR:
// no policy document). Another insurer's policy or an absent id → "not found".
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { insurerFailure, insurerGate, isNotFound } from '../../../../lib/insurer';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerInsurancePolicy } from '@krishalaya/sdk-js';
import { InsurerPolicyView } from '../../../../components/partner2/InsurerPolicyView';
import { InsurerChain } from '../../../../components/partner2/InsurerChain';
import { chain2State } from '../../../../features/partner2/refusals';
import type { InsurerFailure } from '../../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.policy.title'), robots: { index: false, follow: false } };
}

export default async function InsurerPolicyPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const self = `/insurer/policies/${encodeURIComponent(params.id)}`;
  const exp = chain2State('policy_export', searchParams);
  if (exp) return <InsurerChain t={t} chain="policy_export" state={exp} back={self} mailbox={await partnersMailbox()} />;   // PC-56 PARTNER-2b (2b-1)
  const act = chain2State('policy_act', searchParams);
  if (act) return <InsurerChain t={t} chain="policy_act" state={act} back={self} />;
  let p: (PartnerInsurancePolicy & { computedAt: string }) | null = null;
  let failure: InsurerFailure | null = null; let notFound = false;
  try { p = await partnerClient().partner.insurance.policy(params.id); } catch (e) {
    if (isNotFound(e, 'PARTNER_POLICY_NOT_FOUND')) notFound = true; else failure = await insurerFailure(e);
  }
  return <InsurerPolicyView t={t} lang={lang} p={p} failure={failure} notFound={notFound} />;
}
