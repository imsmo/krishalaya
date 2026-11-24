// apps/web-admin/src/app/step-up/page.tsx · "Confirm with your key" (PC-56 ADMIN-AUTH-1).
//
// Sensitive actions need a strong re-auth within ADMIN_STEP_UP_MAX_AGE_SEC (StepUpReauthGuard). When one is refused, the
// console's actions redirect with `?error=elevation`; the layout then offers this screen with `next` = the page the operator
// was on. One WebAuthn assertion here → admin-api returns a fresh token for the SAME session → back to `next` to retry.
import type { Metadata } from 'next';
import { requireAdmin } from '../../lib/admin-auth';
import { getTranslator } from '../../lib/i18n';
import { authCopy, safeNext } from '../../features/admin-auth/admin-auth';
import { StepUpCeremony } from '../../components/auth/StepUpCeremony';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('stepUp.title'), robots: { index: false, follow: false } };
}

export default async function StepUpPage(props: { searchParams: Promise<{ next?: string }> }) {
  requireAdmin();
  const { next } = await props.searchParams;
  const t = getTranslator();
  return (
    <main className="kv-page">
      <header className="kv-page__head">
        <h1>{t.t('stepUp.title')}</h1>
        <p className="kv-page__sub">{t.t('stepUp.lead')}</p>
      </header>
      <StepUpCeremony next={safeNext(next)} copy={authCopy((k) => t.t(k))} />
    </main>
  );
}
