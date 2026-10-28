// apps/web-partner/src/app/lender/queue/[id]/page.tsx · PC-56 PARTNER-4a · W207 (canon `lender/queue/[id]`) — ONE loan application over the
// PARTNER read (`GET /v1/partner/applications/:id`: admitted only with the applicant's live consent to THIS lender for THIS application,
// else the consent-gate state — the realm is not an existence oracle, so a withdrawn application, an expired consent and another lender's
// application all answer the same thing). The two REAL acts (approve, reject) are server actions carrying an Idempotency-Key MINTED HERE AT
// RENDER. Disbursal has no button: a sentence says who the lender of record is.
// `?act=confirm|success|failure` is the W2878–W2880 chain (PARITY-DECOR), linking back to THIS application — never to the queue, which is
// where the canon's own Cancel and Back point. An insurer is sent to its own dashboard.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../../lib/lender';
import { SdkError, type PartnerApplication } from '@krishalaya/sdk-js';
import { LenderApplicationView } from '../../../../components/partner4/LenderApplicationView';
import { LenderChain } from '../../../../components/partner4/LenderChain';
import { chain4State } from '../../../../features/partner4/refusals';
import type { LenderFailure } from '../../../../features/partner4/figures';
import { reviewAction, approveAction, rejectAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.application.title'), robots: { index: false, follow: false } };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LenderApplicationPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const persona = await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const self = `/lender/queue/${encodeURIComponent(params.id)}`;
  const act = chain4State('application_act', searchParams);
  if (act) return <LenderChain t={t} chain="application_act" state={act} back={self} />;
  let a: PartnerApplication | null = null; let failure: LenderFailure | null = null; let notFound = false;
  try { a = await partnerClient().partner.applications.get(params.id); } catch (e) {
    if (e instanceof SdkError && e.status === 404 && e.code !== 'PARTNER_INSURANCE_SWITCHED_OFF') {
      const f = await lenderFailure(e);
      if (f === 'off') failure = 'off'; else notFound = true;
    } else { failure = await lenderFailure(e); }
  }
  return (
    <LenderApplicationView
      t={t} lang={lang} a={a} failure={failure} notFound={notFound} perms={persona.perms} idemKey={randomUUID()}
      ok={one(searchParams?.ok)} error={one(searchParams?.error)}
      actions={{ review: reviewAction, approve: approveAction, reject: rejectAction }}
    />
  );
}
