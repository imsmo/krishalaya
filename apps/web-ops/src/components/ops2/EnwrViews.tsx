// apps/web-ops/src/components/ops2/EnwrViews.tsx · PC-56 OPS-2b · W375 eNWR ISSUE, W376 eNWR REGISTRY and the receipt drill-in — presentational
// (founder Q3-A, Q4-A, Q5-A, Q9-A, Q10-A, 2026-11-06).
//
// W375 (`/warehouse/enwr/issue`) is HONEST and reads nothing: "This platform does not issue an eNWR. No receipt is recorded here in a depositor's
// name." Zero inputs; "Send OTP to farmer", the issue button, the valuation and "repository confirmed" are refused by name. A real link to W376.
// W376 (`/warehouse/enwr/registry`) prints what `GET …/nwr?box=all` answered: each record's number (→ its own page), the repository as recorded, the
// quantity as recorded (the receipt stores no unit), the status VERBATIM, the dates — each "recorded, not confirmed" (the founder's Q3-A words). The
// ONE input is a GET page-size select. NO holder (Q9-A), NO value (Q4-A — the SDK type does not even carry them), NO total, NO release or cancel.
// The drill-in (`/warehouse/enwr/[id]`) prints one record the same way, with its booking's unit when the booking can be read; zero inputs.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { NwrReceipt } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops2/refusals';
import { ENWR_ISSUE_PAGE, ENWR_REGISTRY_PAGE, NWR_REACHABLE, NWR_UNREACHABLE, PAGE_SIZES, enwrReceiptHref, isNwrStatus, isQuantityString, isUnitCode,
  registryHref, type RegistryState } from '../../features/ops2/receipts';
import { Ops2Refusals } from './Ops2Chain';

/** The founder's Q3-A words, printed against every receipt record. */
export function RecordedNotConfirmed({ t }: { t: Tr }) {
  return <span className="kv-badge" data-kv-label="recorded-not-confirmed">{t.t('ops2.enwr.recordedNotConfirmed')}</span>;
}
/** The status VERBATIM (the enum value) with its gloss in the reader's language. */
export function NwrStatus({ t, status }: { t: Tr; status: string }) {
  return isNwrStatus(status)
    ? <span data-kv-status={status}><code>{status}</code> <span className="kv-muted">{t.t(`ops2.enwr.status.${status}`)}</span></span>
    : <span data-kv-status="unknown">{t.t('ops2.enwr.status.unknown')}</span>;
}
/** Which statuses can occur here, and which cannot (survey §1G: the three unreachable ones said so). */
export function StatusLegend({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-legend="status">
      <h2 className="kv-card__title">{t.t('ops2.enwr.legendTitle')}</h2>
      <p>{t.t('ops2.enwr.legendReachable')} {NWR_REACHABLE.map((s) => <code key={s} data-kv-reachable={s}>{s} </code>)}</p>
      <p>{t.t('ops2.enwr.legendUnreachable')} {NWR_UNREACHABLE.map((s) => <code key={s} data-kv-unreachable={s}>{s} </code>)}</p>
    </div>
  );
}
const date = (v: string | null | undefined, lang: string, t: Tr) => (v ? formatDate(v, lang) : t.t('ops2.enwr.noDate'));

export function EnwrIssueView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops2="enwr_issue" data-kv-state="honest">
      <h1>{t.t('ops2.enwrIssue.title')}</h1>
      <div className="kv-card" data-kv-statement="enwr_issue">
        <p className="kv-statement" data-kv-statement="ops2.enwrIssue.statement">{t.t('ops2.enwrIssue.statement')}</p>
        <p data-kv-fact="refused">{t.t('ops2.enwrIssue.refusedAtApi')}</p>
        <p data-kv-fact="records">{t.t('ops2.enwrIssue.records')}</p>
      </div>
      <p className="kv-pager" data-kv-acts="enwr_issue">
        <Link className="kv-btn" href={ENWR_REGISTRY_PAGE} data-kv-real="registry">{t.t('ops2.enwrIssue.registryLink')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${ENWR_ISSUE_PAGE}?act=confirm`} data-kv-decor="send">{t.t('ops2.enwrIssue.sendAct')}</Link>
      </p>
      <Ops2Refusals t={t} surface="enwr_issue" />
    </section>
  );
}

export interface EnwrRegistryViewProps { t: Tr; lang: string; state: RegistryState; receipts: readonly NwrReceipt[]; size: number; nextCursor: string | null }
export function EnwrRegistryView({ t, lang, state, receipts, size, nextCursor }: EnwrRegistryViewProps) {
  return (
    <section data-kv-ops2="enwr_registry" data-kv-state={state}>
      <h1>{t.t('ops2.enwrRegistry.title')}</h1>
      <p className="kv-muted">{t.t('ops2.enwrRegistry.lead')}</p>
      {state === 'off' ? (
        <div className="kv-card" data-kv-off="warehousing"><h2 className="kv-card__title">{t.t('ops2.enwrRegistry.off.title')}</h2><p>{t.t('ops2.enwrRegistry.off.body')}</p></div>
      ) : state === 'forbidden' ? (
        <div className="kv-card" role="alert" data-kv-error="forbidden"><h2 className="kv-card__title">{t.t('ops2.enwrRegistry.forbidden.title')}</h2><p>{t.t('ops2.enwrRegistry.forbidden.body')}</p></div>
      ) : state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="register">
          <h2 className="kv-card__title">{t.t('ops2.enwrRegistry.error.title')}</h2><p>{t.t('ops2.enwrRegistry.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={registryHref(size)} data-kv-real="reread">{t.t('ops2.enwrRegistry.error.reread')}</Link></p>
        </div>
      ) : (
        <>
          <form method="get" action={ENWR_REGISTRY_PAGE} className="kv-inline-form" data-kv-form="page-size">
            <label htmlFor="enwr-size" className="kv-field__label">{t.t('ops2.enwrRegistry.pageSize')}</label>
            <select id="enwr-size" name="size" defaultValue={String(size)} className="kv-input">
              {PAGE_SIZES.map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops2.enwrRegistry.apply')}</button>
          </form>
          {state === 'none' ? (
            <div className="kv-empty-state" data-kv-empty="receipts"><h2>{t.t('ops2.enwrRegistry.none.title')}</h2><p>{t.t('ops2.enwrRegistry.none.body')}</p></div>
          ) : (
            <div className="kv-card" data-kv-register="enwr">
              <p className="kv-muted" data-kv-note="quantity">{t.t('ops2.enwr.quantityNote')}</p>
              <table className="kv-table">
                <thead><tr>
                  <th>{t.t('ops2.enwr.colNumber')}</th><th>{t.t('ops2.enwr.colRepository')}</th><th>{t.t('ops2.enwr.colQuantity')}</th>
                  <th>{t.t('ops2.enwr.colStatus')}</th><th>{t.t('ops2.enwr.colRecorded')}</th><th>{t.t('ops2.enwr.colExpires')}</th><th>{t.t('ops2.enwr.colStanding')}</th>
                </tr></thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id} data-kv-receipt={r.id}>
                      <td data-kv-cell="number"><Link className="kv-link kv-mono" href={enwrReceiptHref(r.id)} data-kv-real="receipt">{r.enwrNo}</Link></td>
                      <td data-kv-cell="repository">{t.t('ops2.enwr.repositoryAsRecorded', { repository: r.repository })}</td>
                      <td data-kv-cell="quantity">{isQuantityString(r.quantity) ? <span className="kv-mono" data-kv-quantity={r.quantity}>{r.quantity}</span> : t.t('ops2.enwr.noQuantity')}</td>
                      <td data-kv-cell="status"><NwrStatus t={t} status={r.status} /></td>
                      <td data-kv-cell="recorded">{date(r.issuedAt ?? r.createdAt, lang, t)}</td>
                      <td data-kv-cell="expires">{date(r.expiresAt, lang, t)}</td>
                      <td data-kv-cell="standing"><RecordedNotConfirmed t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextCursor ? <p className="kv-pager"><Link className="kv-btn" href={registryHref(size, nextCursor)} data-kv-real="next">{t.t('ops2.enwrRegistry.next')}</Link></p> : null}
            </div>
          )}
          <StatusLegend t={t} />
        </>
      )}
      <p className="kv-pager" data-kv-acts="enwr_registry">
        <Link className="kv-btn kv-btn--muted" href={`${ENWR_REGISTRY_PAGE}?export=queued`} data-kv-decor="export">{t.t('ops2.enwrRegistry.exportAct')}</Link>{' '}
        <Link className="kv-btn" href={ENWR_ISSUE_PAGE} data-kv-real="issue">{t.t('ops2.enwrRegistry.issueLink')}</Link>
      </p>
      <Ops2Refusals t={t} surface="enwr_registry" />
    </section>
  );
}

export type ReceiptState = 'ok' | 'unavailable' | 'error';
export function EnwrReceiptView({ t, lang, state, receipt, unitCode }: { t: Tr; lang: string; state: ReceiptState; receipt?: NwrReceipt | null; unitCode?: string | null }) {
  return (
    <section data-kv-ops2="enwr_receipt" data-kv-state={state}>
      <h1>{t.t('ops2.enwrReceipt.title')}</h1>
      {state === 'ok' && receipt ? (
        <>
          <p><RecordedNotConfirmed t={t} /></p>
          <dl className="kv-facts" data-kv-receipt={receipt.id}>
            <div className="kv-facts__row"><dt>{t.t('ops2.enwr.colNumber')}</dt><dd data-kv-cell="number" className="kv-mono">{receipt.enwrNo}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.enwr.colRepository')}</dt><dd data-kv-cell="repository">{t.t('ops2.enwr.repositoryAsRecorded', { repository: receipt.repository })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.enwr.colQuantity')}</dt><dd data-kv-cell="quantity">
              {isQuantityString(receipt.quantity) ? <span className="kv-mono" data-kv-quantity={receipt.quantity}>{receipt.quantity}</span> : t.t('ops2.enwr.noQuantity')}{' '}
              <span className="kv-muted" data-kv-unit={isUnitCode(unitCode) ? unitCode : 'none'}>{isUnitCode(unitCode) ? t.t('ops2.enwrReceipt.unitFromBooking', { unit: unitCode }) : t.t('ops2.enwrReceipt.noUnit')}</span>
            </dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.enwr.colStatus')}</dt><dd data-kv-cell="status"><NwrStatus t={t} status={receipt.status} /></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.enwr.colRecorded')}</dt><dd data-kv-cell="recorded">{date(receipt.issuedAt ?? receipt.createdAt, lang, t)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops2.enwr.colExpires')}</dt><dd data-kv-cell="expires">{date(receipt.expiresAt, lang, t)}</dd></div>
          </dl>
          <p className="kv-notice" role="note" data-kv-fact="acts">{t.t('ops2.enwrReceipt.acts')}</p>
        </>
      ) : (
        <div className="kv-card" role="alert" data-kv-error={state}><h2 className="kv-card__title">{t.t(`ops2.enwrReceipt.${state === 'ok' ? 'unavailable' : state}.title`)}</h2><p>{t.t(`ops2.enwrReceipt.${state === 'ok' ? 'unavailable' : state}.body`)}</p></div>
      )}
      <p className="kv-pager"><Link className="kv-btn" href={ENWR_REGISTRY_PAGE} data-kv-real="registry">{t.t('ops2.enwrReceipt.backToRegister')}</Link></p>
      <Ops2Refusals t={t} surface="enwr_receipt" />
    </section>
  );
}
