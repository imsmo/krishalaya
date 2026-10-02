// apps/web-tenant/src/app/esg/report/page.tsx · W424 · THE ESG REPORT — the guard, built; the signature, refused · PC-56 TENANT-9d.
//
// The canon: *"Export builder — signed, reproducible, and blocked if any number lacks its method."* The guard is the right law
// and it is BUILT — over every metric, not "4 of 13": each row says whether the file carries it and, if not, why. The
// signature is not (no signing key — founder-physical, F-11): the file is UNSIGNED and says so, on this page and on its
// receipt. Blocking the whole file until eleven methods exist would make an export impossible, so the canon's own way out
// is taken — *"Remove the metric … to proceed"*: the file leaves each one out and names it on the receipt. *Generate report*
// enqueues the `esg.metrics` dataset on the 6e-2 plane (queued → ready, sha256, 15-minute link, every fetch logged). The key
// is minted on THIS page (the guard is the review). Audience, Pending sign, watermark, document id / QR verify URL,
// byte-identical, PDF: refused by name. *Retry* (Couldn't compile → W2602) is a page load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { EsgReport } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { ESG_HREF, PILLARS, REPORT_HREF, REPORT_REFUSED_BY_NAME, byNameKey, esgState, methodHref, noValueKey, pick, pillarKey, refusalKey } from '../../../features/esg/esg';
import { enqueueEsgReportAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('esg.report.title'), robots: { index: false, follow: false } };
}

export default async function EsgReportPage({ searchParams }: { searchParams: { error?: string } }) {
  if (!env.featureEsg) notFound();
  await requireSession(REPORT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));

  let r: EsgReport | null = null; let state: string | null = null;
  try { r = await tenantClient().esg.report(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = esgState(err?.code, err?.status, true); }

  return (
    <section>
      <nav aria-label={t.t('esg.breadcrumb')} className="kv-field__hint"><Link href={ESG_HREF}>{t.t('esg.title')}</Link>{' / '}{t.t('esg.report.title')}</nav>
      <h1>{t.t('esg.report.title')}</h1>
      <p>{t.t('esg.report.lead')}</p>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('esg.report.unsigned')}</p></div>

      {failed.length > 0 && (
        <div className="kv-error" role="alert">
          <p>{t.t('esg.report.failed')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(refusalKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t('esg.report.failedUntouched')}</p>
        </div>
      )}

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`esg.state.${state}.title`)}</strong><p>{t.t(`esg.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={REPORT_HREF} className="kv-btn--link">{t.t('esg.state.reload')}</Link> <span className="kv-field__hint">{t.t(byNameKey('retry'))}</span></p>}
        </div>
      )}

      {r && (
        <>
          {r.included === 0 && <div className="kv-card kv-card--notice" role="status"><strong>{t.t('esg.report.nothing.title')}</strong><p>{t.t('esg.report.nothing.body')}</p></div>}
          <div className="kv-card">
            <h2>{t.t('esg.report.guard')}</h2>
            <p className="kv-field__hint">{t.t('esg.report.guardLead', { included: fmt(r.included), excluded: fmt(r.excluded), total: fmt(r.checklist.length) })}</p>
            {PILLARS.map((p) => (
              <div key={p}>
                <h3>{t.t(pillarKey(p))}</h3>
                <ul className="kv-list">{r!.checklist.filter((c) => c.pillar === p).map((c) => (
                  <li key={c.metricCode}>
                    <strong>{t.t(c.included ? 'esg.report.in' : 'esg.report.out')}</strong> {pick(c.name, lang)} — {c.included
                      ? t.t('esg.report.inBecause', { ref: c.methodRef ?? '', version: String(c.methodVersion ?? '') })
                      : t.t(noValueKey(c.verdict))}{' '}
                    <Link href={methodHref(c.metricCode)} className="kv-btn--link">{t.t('esg.report.seeMethod')}</Link>
                  </li>
                ))}</ul>
              </div>
            ))}
            <p className="kv-field__hint">{t.t('esg.report.disclosures', { n: fmt(r.disclosures) })}</p>
          </div>

          <div className="kv-card">
            <h2>{t.t('esg.report.properties')}</h2>
            <ul className="kv-list">
              <li>{t.t('esg.report.prop.appendix')}</li>
              <li>{t.t('esg.report.prop.receipt')}</li>
              {REPORT_REFUSED_BY_NAME.filter((x) => x !== 'retry').map((x) => <li key={x}>{t.t(byNameKey(x))}</li>)}
            </ul>
          </div>

          {r.canGenerate ? (
            <form action={enqueueEsgReportAction} className="kv-card kv-form">
              <label className="kv-field" htmlFor="esg-lang"><span>{t.t('esg.report.lang')}</span>
                <select id="esg-lang" name="lang" className="kv-select" defaultValue={r.languages.includes(lang) ? lang : 'en'}>
                  {r.languages.map((l) => <option key={l} value={l}>{l}</option>)}
                </select></label>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('esg.report.generate')}</button>
              <p className="kv-field__hint">{t.t('esg.report.generateHint')}</p>
            </form>
          ) : (
            <div className="kv-card kv-card--notice" role="note"><strong>{t.t('esg.report.restricted.title')}</strong><p>{t.t('esg.report.restricted.body')}</p></div>
          )}
          <p className="kv-field__hint"><em>{t.t('esg.footer.quote')}</em> · {t.t('esg.footer.carbon')}</p>
        </>
      )}
    </section>
  );
}
