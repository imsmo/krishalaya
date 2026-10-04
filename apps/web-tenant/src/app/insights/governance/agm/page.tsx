// apps/web-tenant/src/app/insights/governance/agm/page.tsx · W199 "AGM pack" overview — PC-56 TENANT-SW-d.
// The FY selector lists only years that have ENDED under the organisation's DECLARED fiscal-year basis (printed, with where it comes
// from: the organisation's own setting or the country default). No basis → a sentence, not a guessed year. Below: the history of packs
// (drafts, issued documents, addenda, withdrawn), µs keyset. Every figure lives on the pack page, read from the API — none here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AgmOverview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { AGM_HREF, agmExportHref, agmPackHref, agmStatusKey, istLabel, swdCodeKey, swdPageState, verifyAgmHref } from '../../../../features/swd/console';
import { parseCodes } from '../../../../features/swc/console';
import { MediaUploader } from '../../../../components/MediaUploader';
import { draftAgmPackAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.agm.title'), robots: { index: false, follow: false } };
}

export default async function AgmOverviewPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(AGM_HREF);
  const t = getTranslator();
  let view: AgmOverview | null = null; let state: string | null = null;
  try { view = await tenantClient().agmPacks.overview(searchParams.cursor); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status); }
  const errors = parseCodes(searchParams.error);
  const years = view?.endedYears ?? [];
  const picked = years.find((y) => String(y.startYear) === searchParams.fy) ?? years[0] ?? null;

  return (
    <section>
      <nav className="kv-field__hint"><Link href="/governance/register" className="kv-btn--link">{t.t('swd.agm.breadcrumb')}</Link> › {t.t('swd.agm.title')}</nav>
      <h1>{t.t('swd.agm.title')}</h1>
      <p className="kv-field__hint">{t.t('swd.agm.lede')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={AGM_HREF} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}</div>}
      {errors.length > 0 && <div className="kv-error" role="alert"><strong>{t.t('swd.chain.failure')}</strong><ul className="kv-list">{errors.map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul><p>{t.t('swd.chain.untouched')}</p></div>}

      {view && (
        <div className="kv-card">
          <h2>{t.t('swd.agm.basis.title')}</h2>
          {view.fyBasis
            ? <p>{t.t(view.fyBasis.source === 'tenant_setting' ? 'swd.agm.basis.own' : 'swd.agm.basis.country', { month: t.t(`swd.month.${view.fyBasis.startMonth}`), zone: view.zone })}</p>
            : <p className="kv-card--notice">{t.t('swd.code.AGM_FY_BASIS_UNDECLARED')}</p>}
          {view.fyBasis && years.length === 0 && <p className="kv-field__hint">{t.t('swd.agm.noEndedYear')}</p>}
          {view.fyBasis && years.length > 0 && (
            <form action={draftAgmPackAction} className="kv-form">
              <input type="hidden" name="key" value={randomUUID()} />
              <label className="kv-field" htmlFor="agm-fy"><span>{t.t('swd.agm.field.fy')}</span>
                <select id="agm-fy" name="fyStartYear" className="kv-select" defaultValue={picked ? String(picked.startYear) : undefined}>
                  {years.map((y) => <option key={y.startYear} value={y.startYear}>{t.t('swd.agm.fyOption', { label: y.label, start: y.start, end: y.endInclusive })}</option>)}
                </select></label>
              <label className="kv-field" htmlFor="agm-lang"><span>{t.t('swd.agm.field.secondLanguage')}</span>
                <select id="agm-lang" name="secondLanguage" className="kv-select" defaultValue={view.defaultSecondLanguage ?? 'hi'}>
                  <option value="hi">{t.t('swd.go.lang.hi')}</option><option value="gu">{t.t('swd.go.lang.gu')}</option></select></label>
              <p className="kv-field__hint">{t.t('swd.agm.indicRefused')}</p>
              <MediaUploader labels={{ add: t.t('swd.upload.add'), hint: t.t('swd.upload.hint'), uploading: t.t('swd.upload.uploading'), failed: t.t('swd.upload.failed'), remove: t.t('swd.upload.remove') }} fieldName="auditorMediaId" single kind="document" inputId="agm-aud-file" />
              <label className="kv-field" htmlFor="agm-aud"><span>{t.t('swd.agm.field.auditorMediaId')}</span>
                <input id="agm-aud" name="auditorMediaId" className="kv-input" pattern="[0-9a-fA-F-]{36}" /></label>
              <p className="kv-field__hint">{t.t('swd.agm.draftHint')}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('swd.agm.draft')}</button>
            </form>
          )}
        </div>
      )}

      {view && (
        <>
          <h2>{t.t('swd.agm.history')}</h2>
          {view.items.length === 0 ? <p className="kv-field__hint">{t.t('swd.agm.empty')}</p> : (
            <table className="kv-table"><thead><tr><th>{t.t('swd.agm.col.fy')}</th><th>{t.t('swd.agm.col.status')}</th><th>{t.t('swd.agm.col.document')}</th><th>{t.t('swd.agm.col.issuedAt')}</th><th>{t.t('swd.agm.col.export')}</th></tr></thead>
              <tbody>{view.items.map((p) => (
                <tr key={p.id}>
                  <td><Link href={agmPackHref(p.id)} className="kv-btn--link">{p.fiscalYearLabel}</Link>{p.addendumNo > 0 && <> · {t.t('swd.agm.addendumNo', { n: p.addendumNo })}</>}</td>
                  <td>{t.t(agmStatusKey(p.status))}{p.supersededBy && <> · {t.t('swd.agm.superseded')}</>}</td>
                  <td>{p.documentId ? <Link href={verifyAgmHref(p.documentId)} className="kv-btn--link"><code>{p.documentId}</code></Link> : '—'}</td>
                  <td>{p.issuedAt ? istLabel(p.issuedAt) : '—'}</td>
                  <td>{p.exportJobId ? <Link href={agmExportHref(p.exportJobId)} className="kv-btn--link">{t.t('swd.agm.export.open')}</Link> : '—'}</td>
                </tr>))}</tbody></table>
          )}
          {view.nextCursor && <p><Link href={`${AGM_HREF}?cursor=${encodeURIComponent(view.nextCursor)}`} className="kv-btn--link">{t.t('swd.more')}</Link></p>}
        </>
      )}
    </section>
  );
}
