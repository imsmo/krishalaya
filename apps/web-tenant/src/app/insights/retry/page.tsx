// apps/web-tenant/src/app/insights/retry/page.tsx · W2680 / W2681 / W2682 (mandi), W2571 / W2572 / W2573 (demand) and the Retry of W2826–W2828
// (wastage) — PC-56 TENANT-SW-f. These chains' ONLY act is "Retry", and a retry is a PAGE LOAD, not a mutation (TENANT-6a's ruling, kept
// by the shared mutate chain: `gapRetryIsMutation() === false`). So the three canon steps are served honestly: the confirm step says what
// pressing it does (re-reads the screen; nothing is written, nothing audited), "success" IS the screen read again, and the failure step
// is the screen's own error state with this same Retry.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { mutateStep, mutateStepKey, gapRetryIsMutation } from '../../../features/mutate/chain';
import { RETRY_HREF, backHrefFor, isInsightFrom } from '../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.retry'), robots: { index: false, follow: false } }; }

export default async function InsightsRetryPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const from = isInsightFrom(searchParams.from) ? searchParams.from : 'mandi';
  const back = backHrefFor(from);
  await requireSession(`${RETRY_HREF}?from=${from}`);
  const t = getTranslator();
  const step = mutateStep(searchParams.step);
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t(`swf.nav.${from}`)}><Link href={back}>{t.t(`swf.nav.${from}`)}</Link> / <span aria-current="page">{t.t('swf.retry')}</span></nav>
      <h1>{t.t('swf.retry')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (
        <div className="kv-card">
          <p>{t.t('swf.retryDecor.what')}</p>
          <p className="kv-field__hint">{t.t(gapRetryIsMutation() ? 'swf.retryDecor.audited' : 'swf.retryDecor.notAudited')}</p>
          <p><Link href={back} className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</Link>{' '}<Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </div>
      )}
      {step === 'success' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('swf.retryDecor.done')}</p><p><Link href={back} className="kv-btn--link">{t.t('swf.backToScreen')}</Link></p></div>}
      {step === 'failure' && <div className="kv-error" role="alert"><p>{t.t('swf.retryDecor.failed')}</p><p><Link href={`${RETRY_HREF}?from=${from}`} className="kv-btn--link">{t.t('swf.retry')}</Link>{' · '}<Link href={back} className="kv-btn--link">{t.t('swf.backToScreen')}</Link></p></div>}
    </section>
  );
}
