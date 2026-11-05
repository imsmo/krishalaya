// apps/web-ops/src/components/ops1/AepsViews.tsx · PC-56 OPS-1b · W390–W393 — AePS AS A LOG, SAID AS A LOG (founder Q1-A), presentational.
//   • AepsHomeView (W390, /aeps/home) — HONEST, reads nothing: what the log is and is not; links to record, exceptions, receipt, policy.
//   • AepsRecordView (W391, /aeps/withdrawal; and the W3289 confirm state) — THE ONE FORM of the slice: the record act over the EXISTING keyed
//     `POST /v1/ambassadors/aeps/events`. The device box is UNTICKED (certification is the operator's word — HOTFIX-10 F-13). There is NO Aadhaar
//     box and NO customer box (Q7-A — the API refuses either field by name). The balance is "as the bank's device showed it after"; no
//     balance-before, no limit number, no commission or "free" line.
//   • AepsExceptionsView (W392, /aeps/exceptions) — a READ: the events that did not go straight through, own or (supervisor) all, with the
//     audited-read note. No customer, bank or account column; no row link. Amounts only through the money formatter.
//   • AepsReceiptView (W393, /aeps/receipt) — HONEST, reads nothing: there is no receipt here. Its "Retry" (FM:101) opens the chain's confirm.
// Every refused canon line is printed BY NAME (`Ops1Refusals`). No input on an honest view; no figure computed anywhere.
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { Tr } from '../../features/ops1/refusals';
import { AEPS_EXCEPTIONS, AEPS_RECEIPT, AEPS_RECORD, BIOMETRIC_CANON, isException, type ExceptionsState, type ExceptionsView } from '../../features/ops1/aeps';
import { EVENT_STATUSES, EXCEPTION_CODES, MAX_ATTEMPTS, SERVICE_KINDS, nextStep } from '../../features/aeps/service';
import { Ops1Refusals } from './Ops1Chain';

function Statement({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="aeps">
      <h2 className="kv-card__title">{t.t('ops1.aeps.statementTitle')}</h2>
      <p className="kv-statement" data-kv-statement="ops1.aeps.statement">{t.t('ops1.aeps.statement')}</p>
    </div>
  );
}

export function AepsHomeView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="aeps_home" data-kv-state="honest">
      <h1>{t.t('ops1.aeps.home.title')}</h1>
      <p className="kv-muted">{t.t('ops1.aeps.home.lead')}</p>
      <Statement t={t} />
      <div className="kv-card" data-kv-facts="aeps_home">
        <p data-kv-fact="kept">{t.t('ops1.aeps.home.kept')}</p>
        <p data-kv-fact="attempts">{t.t('ops1.aeps.home.attempts')}</p>
        <p data-kv-fact="enabled">{t.t('ops1.aeps.home.enabled')}</p>
      </div>
      <p className="kv-pager" data-kv-links="aeps_home">
        <Link className="kv-btn" href={AEPS_RECORD} data-kv-real="record">{t.t('ops1.aeps.home.recordLink')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={AEPS_EXCEPTIONS} data-kv-real="exceptions">{t.t('ops1.aeps.home.exceptionsLink')}</Link>{' '}
        <Link className="kv-btn--link" href={AEPS_RECEIPT} data-kv-real="receipt">{t.t('ops1.aeps.home.receiptLink')}</Link>{' '}
        <Link className="kv-btn--link" href={BIOMETRIC_CANON} data-kv-real="policy">{t.t('ops1.aeps.home.policyLink')}</Link>
      </p>
      <Ops1Refusals t={t} surface="aeps_home" />
    </section>
  );
}

export type AepsFormAction = string | ((formData: FormData) => void | Promise<void>);

/** W391 (mode 'page') and the W3289 confirm state (mode 'confirm'): the same single form, under the page's words or the confirm sentence. */
export function AepsRecordView({ t, mode, action }: { t: Tr; mode: 'page' | 'confirm'; action: AepsFormAction }) {
  const confirm = mode === 'confirm';
  return (
    <section data-kv-ops1="aeps_record" data-kv-state={confirm ? 'confirm' : 'form'} {...(confirm ? { 'data-kv-chain': 'aeps_act', 'data-kv-chain-state': 'confirm' } : {})}>
      <h1>{confirm ? t.t('ops1.chain.aepsAct.confirm.title') : t.t('ops1.aeps.record.title')}</h1>
      <Statement t={t} />
      <p className="kv-muted">{confirm ? t.t('ops1.chain.aepsAct.confirm.body') : t.t('ops1.aeps.record.lead')}</p>
      <p className="kv-notice" role="note" data-kv-fact="q7a">{t.t('ops1.aeps.record.keepsLeast')}</p>

      <form action={action} className="kv-card kv-form" data-kv-form="aeps_record">
        <div className="kv-field">
          <label htmlFor="ae-kind" className="kv-field__label">{t.t('ops1.aeps.record.kind')}</label>
          <select id="ae-kind" name="serviceKind" className="kv-select" required>
            {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.t(`ops1.aeps.kind.${k}`)}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('ops1.aeps.record.kindHint')}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="ae-bank" className="kv-field__label">{t.t('ops1.aeps.record.bank')}</label>
          <input id="ae-bank" name="bankName" className="kv-input" maxLength={120} />
          <label htmlFor="ae-acc" className="kv-field__label">{t.t('ops1.aeps.record.account')}</label>
          <input id="ae-acc" name="accountLast4" className="kv-input" inputMode="numeric" pattern="\d{4}" maxLength={4} aria-describedby="ae-acc-hint" />
          <p id="ae-acc-hint" className="kv-field__hint">{t.t('ops1.aeps.record.accountHint')}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="ae-amt" className="kv-field__label">{t.t('ops1.aeps.record.amount')}</label>
          <input id="ae-amt" name="amountMajor" className="kv-input" inputMode="decimal" aria-describedby="ae-amt-hint" />
          <p id="ae-amt-hint" className="kv-field__hint">{t.t('ops1.aeps.record.amountHint')}</p>
          <label htmlFor="ae-bal" className="kv-field__label">{t.t('ops1.aeps.record.balance')}</label>
          <input id="ae-bal" name="balanceAfterMajor" className="kv-input" inputMode="decimal" aria-describedby="ae-bal-hint" />
          <p id="ae-bal-hint" className="kv-field__hint">{t.t('ops1.aeps.record.balanceHint')}</p>
        </div>
        {/* UNTICKED by default (HOTFIX-10 F-13): certification is asserted by a deliberate tick, never by leaving a pre-ticked box alone. */}
        <fieldset className="kv-fieldset" data-kv-device="box">
          <legend>{t.t('ops1.aeps.record.deviceLegend')}</legend>
          <label className="kv-check"><input type="checkbox" name="deviceCertified" value="1" /> {t.t('ops1.aeps.record.device')}</label>
          <p className="kv-field__hint">{t.t('ops1.aeps.record.deviceHint')}</p>
        </fieldset>
        <div className="kv-field">
          <label htmlFor="ae-status" className="kv-field__label">{t.t('ops1.aeps.record.status')}</label>
          <select id="ae-status" name="status" className="kv-select" required>
            {EVENT_STATUSES.map((s) => <option key={s} value={s}>{t.t(`ops1.aeps.status.${s}`)}</option>)}
          </select>
          <label htmlFor="ae-exc" className="kv-field__label">{t.t('ops1.aeps.record.exception')}</label>
          <select id="ae-exc" name="exceptionCode" className="kv-select">
            <option value="">{t.t('ops1.aeps.exception.none')}</option>
            {EXCEPTION_CODES.map((c) => <option key={c} value={c}>{t.t(`ops1.aeps.exception.${c}`)}</option>)}
          </select>
        </div>
        <div className="kv-field">
          <label htmlFor="ae-att" className="kv-field__label">{t.t('ops1.aeps.record.attempt', { max: MAX_ATTEMPTS })}</label>
          <select id="ae-att" name="attemptNo" className="kv-select" required defaultValue="1">
            {Array.from({ length: MAX_ATTEMPTS }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('ops1.aeps.record.attemptHint', { max: MAX_ATTEMPTS })}</p>
        </div>
        <div className="kv-field">
          <label htmlFor="ae-esc" className="kv-field__label">{t.t('ops1.aeps.record.note')}</label>
          <textarea id="ae-esc" name="escalationNote" className="kv-textarea" rows={2} maxLength={200} aria-describedby="ae-esc-hint" />
          <p id="ae-esc-hint" className="kv-field__hint">{t.t('ops1.aeps.record.noteHint')}</p>
          <label htmlFor="ae-rrn" className="kv-field__label">{t.t('ops1.aeps.record.ref')}</label>
          <input id="ae-rrn" name="npciRrn" className="kv-input" maxLength={40} />
        </div>
        <div className="kv-form__actions">
          <button type="submit" className="kv-btn" data-kv-act="record">{t.t('ops1.aeps.record.submit')}</button>
        </div>
      </form>
      <p className="kv-pager">
        {confirm
          ? <Link className="kv-btn kv-btn--muted" href={AEPS_RECORD} data-kv-back={AEPS_RECORD}>{t.t('ops1.chain.back')}</Link>
          : <Link className="kv-btn--link" href={AEPS_EXCEPTIONS} data-kv-real="exceptions">{t.t('ops1.aeps.record.exceptionsLink')}</Link>}
      </p>
      <Ops1Refusals t={t} surface={confirm ? 'aeps_act' : 'aeps_record'} />
    </section>
  );
}

/** One event as `/events/mine` or `/events` returns it after Q7-A (no Aadhaar key, no customer key — and none is read here). */
export interface AepsEventView {
  id?: string; ambassadorId?: string; serviceKind?: string; status?: string; exceptionCode?: string | null; attemptNo?: number;
  amountMinor?: string | null; escalationNote?: string | null; deviceCertified?: boolean; occurredAt?: string;
}

export function AepsExceptionsView({ t, lang, view, state, rows }: { t: Tr; lang: string; view: ExceptionsView; state: ExceptionsState; rows: readonly AepsEventView[] }) {
  const shown = rows.filter(isException);
  const tab = (v: ExceptionsView, key: string) => (
    <Link href={v === 'all' ? `${AEPS_EXCEPTIONS}?view=all` : AEPS_EXCEPTIONS} className={`kv-tab${v === view ? ' kv-tab--active' : ''}`} aria-current={v === view ? 'page' : undefined} data-kv-view={v}>{t.t(key)}</Link>
  );
  return (
    <section data-kv-ops1="aeps_exceptions" data-kv-state={state} data-kv-view-current={view}>
      <h1>{t.t('ops1.aeps.exceptions.title')}</h1>
      <nav className="kv-tabs" aria-label={t.t('ops1.aeps.exceptions.views')}>{tab('mine', 'ops1.aeps.exceptions.viewMine')}{' '}{tab('all', 'ops1.aeps.exceptions.viewAll')}</nav>
      <p className="kv-muted">{t.t(view === 'all' ? 'ops1.aeps.exceptions.leadAll' : 'ops1.aeps.exceptions.leadMine')}</p>
      {view === 'all' && <p className="kv-notice" role="note" data-kv-note="audited">{t.t('ops1.aeps.exceptions.auditNote')}</p>}
      <p className="kv-field__hint" data-kv-note="no-person">{t.t('ops1.aeps.exceptions.noPerson')}</p>
      {state === 'ok' ? (
        <table className="kv-table" data-kv-rows="aeps_exceptions">
          <thead><tr>
            <th>{t.t('ops1.aeps.exceptions.colWhen')}</th>
            {view === 'all' && <th>{t.t('ops1.aeps.exceptions.colOperator')}</th>}
            <th>{t.t('ops1.aeps.record.kind')}</th><th>{t.t('ops1.aeps.record.status')}</th><th>{t.t('ops1.aeps.record.exception')}</th>
            <th>{t.t('ops1.aeps.exceptions.colAttempt')}</th><th>{t.t('ops1.aeps.exceptions.colAmount')}</th><th>{t.t('ops1.aeps.exceptions.colNext')}</th><th>{t.t('ops1.aeps.exceptions.colNote')}</th>
          </tr></thead>
          <tbody>
            {shown.map((e, i) => {
              const step = nextStep(e);
              return (
                <tr key={e.id ?? i} data-kv-event={e.id ?? String(i)} data-kv-status={e.status ?? ''}>
                  <td>{e.occurredAt ? formatDate(e.occurredAt, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : t.t('ops1.aeps.none')}</td>
                  {view === 'all' && <td>{e.ambassadorId ? `${e.ambassadorId.slice(0, 8)}` : t.t('ops1.aeps.none')}</td>}
                  <td>{e.serviceKind ? t.t(`ops1.aeps.kind.${e.serviceKind}`) : t.t('ops1.aeps.none')}</td>
                  <td><span className="kv-badge">{e.status ? t.t(`ops1.aeps.status.${e.status}`) : t.t('ops1.aeps.none')}</span></td>
                  <td>{e.exceptionCode ? t.t(`ops1.aeps.exception.${e.exceptionCode}`) : t.t('ops1.aeps.none')}</td>
                  <td>{t.t('ops1.aeps.attemptOf', { n: e.attemptNo ?? 1, max: MAX_ATTEMPTS })}</td>
                  <td>{e.amountMinor ? formatMoneyMinor(e.amountMinor, 'INR', lang) : t.t('ops1.aeps.none')}</td>
                  <td>{step === 'none' ? t.t('ops1.aeps.none') : t.t(`ops1.aeps.next.${step}`)}</td>
                  <td>{e.escalationNote ?? t.t('ops1.aeps.none')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className={state === 'empty' ? 'kv-empty-state' : 'kv-card'} role={state === 'empty' ? undefined : 'alert'} data-kv-empty={state}>
          <p>{t.t(`ops1.aeps.exceptions.state.${state}`)}</p>
        </div>
      )}
      <p className="kv-pager"><Link className="kv-btn--link" href={AEPS_RECORD} data-kv-real="record">{t.t('ops1.aeps.home.recordLink')}</Link></p>
      <Ops1Refusals t={t} surface="aeps_exceptions" />
    </section>
  );
}

export function AepsReceiptView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops1="aeps_receipt" data-kv-state="honest">
      <h1>{t.t('ops1.aeps.receipt.title')}</h1>
      <div className="kv-card" data-kv-statement="aeps_receipt">
        <p className="kv-statement" data-kv-statement="ops1.aeps.receipt.statement">{t.t('ops1.aeps.receipt.statement')}</p>
        <p data-kv-fact="why">{t.t('ops1.aeps.receipt.why')}</p>
        <p data-kv-fact="lost">{t.t('ops1.aeps.receipt.lost')}</p>
      </div>
      <Statement t={t} />
      <p className="kv-pager" data-kv-links="aeps_receipt">
        <Link className="kv-btn" href={`${AEPS_RECORD}?act=confirm`} data-kv-real="retry">{t.t('ops1.aeps.receipt.retry')}</Link>{' '}
        <Link className="kv-btn--link" href={BIOMETRIC_CANON} data-kv-real="policy">{t.t('ops1.aeps.home.policyLink')}</Link>
      </p>
      <Ops1Refusals t={t} surface="aeps_receipt" />
    </section>
  );
}
