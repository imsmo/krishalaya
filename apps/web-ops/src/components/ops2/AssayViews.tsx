// apps/web-ops/src/components/ops2/AssayViews.tsx · PC-56 OPS-2b · W372 ASSAY LAB and W373 ASSAY RECORD — presentational (founder Q13-A, Q11-A,
// Q9-A, Q10-A, 2026-11-06).
//
// W372 (`/warehouse/assay?booking=<id>`): what `GET …/storage-bookings/:id/assays` answered for ONE booking — each entry under the founder's Q13-A
// words "the warehouse's own entry — not a lab certificate, and it sets no price"; the assayer's name as the warehouse typed it; each parameter
// `name = value` EXACTLY as entered (no unit, no percentage added — E3); a valid-until date only if one was entered; a link to the entry's own page
// (W373). The record form (assayer, parameters, valid-until — as built, minus nothing) is shown ONLY to that warehouse's named operator, and only on a
// STORED booking (F-16); the server refuses everyone else by name. No depositor (Q9-A), no booking name — the booking is an id in the URL only.
// W373 (`/warehouse/assay/certificate?booking=&assay=`): ONE entry, titled "Assay record" — never "certificate" — with the Q13-A label first; zero
// inputs; "Download PDF" is DECOR → the W3295–W3296 chain on THIS page (Q10-A). Every refused canon line is printed BY NAME (`Ops2Refusals`).
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { AssayReport } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops2/refusals';
import { WAREHOUSE_PAGE, assayHref, assayParamLines, assayRecordHref, canRecordAssay, type AssayPageState } from '../../features/ops2/receipts';
import { Ops2Refusals } from './Ops2Chain';

export type AssayFormAction = string | ((formData: FormData) => void | Promise<void>);

/** The founder's Q13-A words, printed first on every assay surface. */
export function AssayLabel({ t }: { t: Tr }) {
  return <p className="kv-statement" data-kv-statement="ops2.assay.label">{t.t('ops2.assay.label')}</p>;
}

/** The record form (W372 and the W3297 confirm state): the existing act, labelled per Q13-A. Its submit IS the act. */
export function AssayForm({ t, bookingId, action }: { t: Tr; bookingId: string; action: AssayFormAction }) {
  return (
    <form action={action} className="kv-card kv-form" data-kv-form="assay_record">
      <h2 className="kv-card__title">{t.t('ops2.assay.form.title')}</h2>
      <AssayLabel t={t} />
      <input type="hidden" name="booking" value={bookingId} />
      <label htmlFor="as-name" className="kv-field__label">{t.t('ops2.assay.form.assayer')}</label>
      <input id="as-name" name="assayerName" className="kv-input" required maxLength={200} />
      <label htmlFor="as-params" className="kv-field__label">{t.t('ops2.assay.form.params')}</label>
      <textarea id="as-params" name="paramsText" className="kv-textarea" rows={4} required aria-describedby="as-params-hint" />
      <p id="as-params-hint" className="kv-field__hint">{t.t('ops2.assay.form.paramsHint')}</p>
      <label htmlFor="as-valid" className="kv-field__label">{t.t('ops2.assay.form.validUntil')}</label>
      <input id="as-valid" name="validUntil" type="date" className="kv-input" />
      <button type="submit" className="kv-btn">{t.t('ops2.assay.form.submit')}</button>
    </form>
  );
}

export interface AssayLabViewProps {
  t: Tr; lang: string; state: AssayPageState; bookingId?: string; bookingStatus?: string | null; isOperator: boolean;
  assays: readonly AssayReport[]; action: AssayFormAction;
}

export function AssayLabView({ t, lang, state, bookingId, bookingStatus, isOperator, assays, action }: AssayLabViewProps) {
  return (
    <section data-kv-ops2="assay_lab" data-kv-state={state}>
      <h1>{t.t('ops2.assay.title')}</h1>
      <AssayLabel t={t} />
      {state === 'pick' ? (
        <div className="kv-empty-state" data-kv-empty="booking">
          <h2>{t.t('ops2.assay.pick.title')}</h2><p>{t.t('ops2.assay.pick.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={WAREHOUSE_PAGE} data-kv-real="bookings">{t.t('ops2.assay.pick.link')}</Link></p>
        </div>
      ) : state === 'unavailable' ? (
        <div className="kv-card" role="alert" data-kv-error="unavailable"><h2 className="kv-card__title">{t.t('ops2.assay.unavailable.title')}</h2><p>{t.t('ops2.assay.unavailable.body')}</p></div>
      ) : state === 'error' || !bookingId ? (
        <div className="kv-card" role="alert" data-kv-error="assays">
          <h2 className="kv-card__title">{t.t('ops2.assay.error.title')}</h2><p>{t.t('ops2.assay.error.body')}</p>
          {bookingId ? <p className="kv-pager"><Link className="kv-btn" href={assayHref(bookingId)} data-kv-real="reread">{t.t('ops2.assay.error.reread')}</Link></p> : null}
        </div>
      ) : (
        <>
          <div className="kv-card" data-kv-assays="list">
            <h2 className="kv-card__title">{t.t('ops2.assay.listTitle')}</h2>
            {assays.length === 0 ? <p className="kv-muted" data-kv-empty="assays">{t.t('ops2.assay.empty')}</p> : (
              <table className="kv-table">
                <thead><tr><th>{t.t('ops2.assay.colAssayer')}</th><th>{t.t('ops2.assay.colParams')}</th><th>{t.t('ops2.assay.colValid')}</th><th>{t.t('ops2.assay.colEntry')}</th></tr></thead>
                <tbody>
                  {assays.map((a) => (
                    <tr key={a.id} data-kv-assay={a.id}>
                      <td data-kv-cell="assayer">{a.assayerName} <span className="kv-muted">{t.t('ops2.assay.asTyped')}</span></td>
                      <td data-kv-cell="params" className="kv-mono">{assayParamLines(a.parameters).map((l) => <span key={l} data-kv-param="">{l}<br /></span>)}</td>
                      <td data-kv-cell="valid">{a.validUntil ? formatDate(a.validUntil, lang) : t.t('ops2.assay.noValid')}</td>
                      <td data-kv-cell="entry"><Link className="kv-link" href={assayRecordHref(bookingId, a.id)} data-kv-real="record">{t.t('ops2.assay.openEntry')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canRecordAssay(bookingStatus, isOperator) ? (
            <AssayForm t={t} bookingId={bookingId} action={action} />
          ) : (
            <p className="kv-notice" role="note" data-kv-form-hidden={bookingStatus === 'stored' ? 'not-operator' : 'not-stored'}>
              {t.t(bookingStatus === 'stored' ? 'ops2.assay.formNotOperator' : 'ops2.assay.formNotStored')}
            </p>
          )}
        </>
      )}
      <Ops2Refusals t={t} surface="assay_lab" />
    </section>
  );
}

export type AssayRecordState = 'ok' | 'missing' | 'pick' | 'unavailable' | 'error';
export function AssayRecordView({ t, lang, state, bookingId, assay }: { t: Tr; lang: string; state: AssayRecordState; bookingId?: string; assay?: AssayReport | null }) {
  return (
    <section data-kv-ops2="assay_record" data-kv-state={state}>
      <h1>{t.t('ops2.assayRecord.title')}</h1>
      <AssayLabel t={t} />
      {state === 'ok' && assay && bookingId ? (
        <>
          <dl className="kv-facts" data-kv-assay={assay.id}>
            <div className="kv-facts__row"><dt>{t.t('ops2.assay.colAssayer')}</dt><dd data-kv-cell="assayer">{assay.assayerName} <span className="kv-muted">{t.t('ops2.assay.asTyped')}</span></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.assay.colParams')}</dt><dd data-kv-cell="params" className="kv-mono">{assayParamLines(assay.parameters).map((l) => <span key={l} data-kv-param="">{l}<br /></span>)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.assayRecord.grade')}</dt><dd data-kv-cell="grade">{t.t(assay.gradeOptionId ? 'ops2.assayRecord.gradeRecorded' : 'ops2.assayRecord.gradeNone')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.assayRecord.entered')}</dt><dd data-kv-cell="entered">{assay.assayedAt ? formatDate(assay.assayedAt, lang) : assay.createdAt ? formatDate(assay.createdAt, lang) : t.t('ops2.assay.noValid')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.assay.colValid')}</dt><dd data-kv-cell="valid">{assay.validUntil ? formatDate(assay.validUntil, lang) : t.t('ops2.assay.noValid')}</dd></div>
          </dl>
          <p className="kv-pager" data-kv-acts="assay_record">
            <Link className="kv-btn" href={assayHref(bookingId)} data-kv-real="assays">{t.t('ops2.assayRecord.others')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href={assayRecordHref(bookingId, assay.id, { export: 'queued' })} data-kv-decor="pdf">{t.t('ops2.assayRecord.pdfAct')}</Link>
          </p>
        </>
      ) : (
        <div className="kv-card" role="alert" data-kv-error={state}>
          <h2 className="kv-card__title">{t.t(`ops2.assayRecord.${state === 'ok' ? 'missing' : state}.title`)}</h2>
          <p>{t.t(`ops2.assayRecord.${state === 'ok' ? 'missing' : state}.body`)}</p>
          <p className="kv-pager"><Link className="kv-btn" href={bookingId ? assayHref(bookingId) : WAREHOUSE_PAGE} data-kv-real="back">{t.t('ops2.assayRecord.backToList')}</Link></p>
        </div>
      )}
      <Ops2Refusals t={t} surface="assay_record" />
    </section>
  );
}
