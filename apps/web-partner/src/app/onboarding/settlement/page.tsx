// apps/web-partner/src/app/onboarding/settlement/page.tsx · PC-56 PARTNER-1b · founder D3 / Q2 — THE SETTLEMENT ACCOUNT, HONEST (canon W265 at
// `onboarding/step-3`; DELTA: built at `/onboarding/settlement` — there are no steps; linked from the readiness page only). A static page:
// no settlement account is collected in Phase 1. The partner's kind comes from `/v1/partner/me` (TRUE vocabulary). `?form=…` (W2970–W2973)
// and `?act=…` (W2974–W2976) are the DECOR chains. components/partner1/SettlementView.tsx renders.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { ChainNotice } from '../../../components/partner1/ChainNotice';
import { SettlementView } from '../../../components/partner1/SettlementView';
import { chainState } from '../../../features/partner1/refusals';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.onboarding.title'), robots: { index: false, follow: false } };
}

export default async function SettlementPage({ searchParams }: { searchParams?: SP }) {
  await requirePartner();
  const t = getTranslator();
  const form = chainState('onboarding_form', searchParams);
  if (form) return <ChainNotice t={t} chain="onboarding_form" state={form} />;
  const act = chainState('onboarding_act', searchParams);
  if (act) return <ChainNotice t={t} chain="onboarding_act" state={act} />;
  const kind = (await partnerClient().partner.me().catch(() => null))?.organisation?.kind ?? null;
  return <SettlementView t={t} kind={kind} />;
}
