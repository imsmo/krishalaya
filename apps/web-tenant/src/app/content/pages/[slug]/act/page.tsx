// apps/web-tenant/src/app/content/pages/[slug]/act/page.tsx · the page MUTATE chain — W2700 confirm → W2701 success →
// W2702 failure · PC-56 TENANT-8c.
//
// W2700 names the acts: *"Archive · Publish v3 · Retry now."* PUBLISH (the checker's verb, `cms.pages.publish`; a
// POLICY page never by its author or last editor — the verdict and 0177's trigger), ARCHIVE (a reason from the
// vocabulary AND a sentence; archiving the live version is the UNPUBLISH — the confirm screen says what a member would
// be served after: the platform's page, or nothing), and RESTORE (an archived version comes back as the next DRAFT —
// history is never rewritten). *Retry now* is W176's "Couldn't save draft" card — a re-save, which is the form chain's
// own Retry, not an act (PARITY-DECOR). The reason is mandatory, never pre-filled, and is what the audit row holds. The
// Idempotency-Key is minted HERE and travels in the form (F-17).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsPageAct, CmsPageActs } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey,
  repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../../features/mutate/chain';
import {
  PAGE_MUTATE, actDoneKey, actLabelKey, archiveReasonKey, isKnownArchiveReason, isPageAct, kindKey, pageHref, refusedKey, servingKey, statusKey, verdictFor,
} from '../../../../../features/pages/pages';
import { pageActAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.page.title'), robots: { index: false, follow: false } };
}

const FIELDS = ['act', 'reason', 'archiveReason', 'id'] as const;

export default async function PageActPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const slug = decodeURIComponent(params.slug);
  const PATH = `${pageHref(slug)}/act`;
  await requireSession(PATH);
  const t = getTranslator();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const act: CmsPageAct | null = isPageAct(values.act) ? values.act : null;
  const backHref = pageHref(slug);

  let preview: CmsPageActs | null = null; let previewError: string | null = null;
  if (step === 'confirm' && act && values.id) {
    try { preview = await tenantClient().cms.pages.acts(values.id, { reason: values.reason ?? '', archiveReason: values.archiveReason ?? '' }); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? verdictFor(preview.verdicts, act) : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);
  const ver = preview?.version ?? null;
  const vNo = act === 'restore' ? preview?.restoreAs : ver?.version;

  return (
    <section>
      <h1>{act ? t.t(actLabelKey(act), { v: String(vNo ?? '') }) : t.t('mutate.page.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.page.noAct')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('unpublish'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('keptLocally'))}</p>
        </div>
      )}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && preview && verdict && ver && (
        <>
          {/* ---- THE OBJECT ---- */}
          <div className="kv-card">
            <h2 lang={ver.languageCode ?? undefined}>{ver.defaultTitle}</h2>
            <p className="kv-field__hint"><code>/{preview.view.slug}</code> · {t.t(kindKey(ver.pageKind))} · v{ver.version} · {t.t(statusKey(ver.status))}</p>
            {act === 'publish' && (
              <>
                <p>{preview.supersedes !== null ? t.t('mutate.page.publishSupersedes', { v: String(ver.version), old: String(preview.supersedes) }) : t.t('mutate.page.publishFirst', { v: String(ver.version) })}</p>
                <p className="kv-field__hint">{t.t('mutate.page.servingAfter')} {t.t(servingKey(preview.servingAfter.publish), { v: String(preview.servingAfter.publish.version ?? '') })}</p>
                {ver.pageKind === 'policy' && <p><strong>{t.t('mutate.page.policyChecker')}</strong></p>}
              </>
            )}
            {act === 'archive' && (
              <>
                <p className="kv-field__hint">{t.t('mutate.page.servingAfter')} {t.t(servingKey(preview.servingAfter.archive), { v: String(preview.servingAfter.archive.version ?? '') })}</p>
                {ver.status === 'published' && <p className="kv-field__hint">{t.t('mutate.page.archiveIsUnpublish')}</p>}
                {ver.pageKind === 'policy' && <p className="kv-field__hint">{t.t(refusedKey('archiveWhileOrders'))}</p>}
              </>
            )}
            {act === 'restore' && <p>{t.t('mutate.page.restoreNote', { v: String(ver.version), next: String(preview.restoreAs) })}</p>}
            <pre className="kv-page-body" lang={ver.languageCode ?? undefined}>{ver.body}</pre>
            <p className="kv-field__hint">{t.t('pages.reader.none')}</p>
          </div>

          {verdict.refusals.map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(PAGE_MUTATE, code))}</p></div>)}

          {/* ---- THE REASON (and for archive, the vocabulary), WHICH IS THE AUDIT ROW ---- */}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            <input type="hidden" name="id" value={ver.id} />
            {act === 'archive' && (
              <label className="kv-field" htmlFor="act-archive-reason">
                <span>{t.t('mutate.page.archiveReasonLabel')}</span>
                <select id="act-archive-reason" name="archiveReason" defaultValue={values.archiveReason ?? ''}>
                  <option value="">{t.t('mutate.page.archiveReasonChoose')}</option>
                  {preview.archiveReasons.map((r) => <option key={r.code} value={r.code}>{isKnownArchiveReason(r.code) ? t.t(archiveReasonKey(r.code)) : r.name}</option>)}
                </select>
              </label>
            )}
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t('mutate.page.reasonLabel')}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>

          {canConfirm(verdict, reason) ? (
            <form action={pageActAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={ver.id} />
              <input type="hidden" name="act" value={act} />
              <input type="hidden" name="reason" value={reason} />
              {values.archiveReason && <input type="hidden" name="archiveReason" value={values.archiveReason} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(actDoneKey(act), { v: typeof searchParams.version === 'string' ? searchParams.version : '' }) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('cms_page', values.id ?? null) && <p><Link href={auditHref('cms_page', values.id as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
