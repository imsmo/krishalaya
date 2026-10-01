// apps/web-tenant/src/app/auditor/exports/new/page.tsx · THE EXPORT CHAIN — W2500 confirm → W2498 queued (the job's page) →
// W2502 failure · PC-56 TENANT-9c.
//
// The canon's auditor mutate chain names one act, *Retry* — a load retry, which is a PAGE LOAD and is refused by name
// (`retryIsMutation() === false`). The realm's ONE real act is the export enqueue (W201 *New export*, W2498), and it is the
// only thing this chain confirms: the dataset, its period (≤ 366 days; a pack section ≤ 92), what the file will and will not
// hold, and that it will be UNSIGNED. Confirming writes a queue row, an audit row and a read-log row — and changes no business
// data, which is why it is the AuditorReadOnlyGuard's named exception. THE KEY IS MINTED HERE (Law 3). Success is the job's
// own page (queued → ready); failure carries the API's code back here with *Retry — back to confirm*.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../features/mutate/chain';
import {
  EXPORTS_HREF, NEW_EXPORT_HREF, PAGE_REFUSALS, UNSIGNED_EXPORT_KEY, datasetKey, dayOrUndefined, enqueueFailureKey, isDataset, isSection,
  newExportHref, refusedKey, sectionKey,
} from '../../../../features/auditor/realm';
import { enqueueAuditorExportAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auditor.chain.confirmTitle'), robots: { index: false, follow: false } };
}

export default async function NewAuditorExportPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!env.featureAuditor) notFound();
  await requireSession(NEW_EXPORT_HREF);
  const t = getTranslator();
  const step = mutateStep(searchParams.step);
  const dataset = isDataset(searchParams.dataset) ? searchParams.dataset : null;
  const section = isSection(searchParams.section) ? searchParams.section : undefined;
  const from = dayOrUndefined(searchParams.from); const to = dayOrUndefined(searchParams.to);
  const error = typeof searchParams.error === 'string' && /^[A-Za-z_]{2,60}$/.test(searchParams.error) ? searchParams.error : null;
  const ready = !!dataset && !!from && !!to && (dataset !== 'compliance.pack' || !!section);

  return (
    <section>
      <h1>{t.t('auditor.chain.confirmTitle')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step === 'success' ? 'confirm' : step))} · {t.t('auditor.chain.module')}</p>
      <p className="kv-field__hint"><Link href={EXPORTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step !== 'failure' && (
        <>
          {!ready && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auditor.chain.incomplete')}</p></div>}
          {ready && (
            <>
              <div className="kv-card">
                <dl className="kv-dl">
                  <dt>{t.t('auditor.chain.dataset')}</dt><dd>{t.t(datasetKey(dataset!))}{section ? ` · ${t.t(sectionKey(section))}` : ''}</dd>
                  <dt>{t.t('auditor.chain.period')}</dt><dd>{from} – {to}</dd>
                </dl>
                <p>{t.t(`auditor.chain.holds.${dataset!.replace('.', '_')}`)}</p>
                <p className="kv-field__hint">{t.t(UNSIGNED_EXPORT_KEY)}</p>
                <p className="kv-field__hint">{t.t('auditor.chain.writes')}</p>
              </div>
              <form method="get" action={NEW_EXPORT_HREF} className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="dataset" value={dataset!} />
                {section && <input type="hidden" name="section" value={section} />}
                <label className="kv-label">{t.t('auditor.window.from')}<input className="kv-input" name="from" type="date" defaultValue={from} required /></label>
                <label className="kv-label">{t.t('auditor.window.to')}<input className="kv-input" name="to" type="date" defaultValue={to} required /></label>
                <button type="submit" className="kv-btn--link">{t.t('auditor.chain.changePeriod')}</button>
              </form>
              <form action={enqueueAuditorExportAction}>
                <input type="hidden" name="dataset" value={dataset!} />
                {section && <input type="hidden" name="section" value={section} />}
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <button type="submit" className="kv-btn kv-btn--primary">{t.t('auditor.chain.proceed')}</button>{' '}
                <Link href={EXPORTS_HREF} className="kv-btn--link">{t.t('kyc.act.cancel')}</Link>
              </form>
            </>
          )}
          {PAGE_REFUSALS.chain.map((r) => <p key={r} className="kv-field__hint">{t.t(refusedKey(r))}</p>)}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          {error && <p>{t.t(enqueueFailureKey(error))} <code>{error}</code></p>}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          {dataset && from && to && <p><Link href={newExportHref(dataset, { from, to, section })} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>}
        </div>
      )}
    </section>
  );
}
