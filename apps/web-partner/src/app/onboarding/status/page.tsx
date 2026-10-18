// apps/web-partner/src/app/onboarding/status/page.tsx · PC-56 PARTNER-1b · founder D3 — YOUR STANDING WITH THE PLATFORM (canon W266, its own path
// `onboarding/status`; "Readiness" in the Account nav group; reached from /account/settings). Reads `GET /v1/partner/readiness` (any member):
// six facts from what exists + computedAt. The settlement page is linked from here only. components/partner1/ReadinessView.tsx renders.
import type { Metadata } from 'next';
import { SdkError, type PartnerReadiness } from '@krishalaya/sdk-js';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { partnerConsoleSwitch } from '../../../lib/console-flag';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import { ReadinessView, type ReadinessState } from '../../../components/partner1/ReadinessView';
import { failureOf } from '../../../features/partner1/dashboard';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.readiness.title'), robots: { index: false, follow: false } };
}

export default async function ReadinessPage() {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  let r: PartnerReadiness | null = null; let state: ReadinessState = 'ok';
  try { r = await partnerClient().partner.readiness(); } catch (e) {
    const status = e instanceof SdkError ? e.status : undefined;
    state = failureOf(status, status === 404 ? await partnerConsoleSwitch() : 'unknown');
  }
  return <ReadinessView t={t} lang={lang} state={state} r={r} mailbox={await partnersMailbox()} />;
}
