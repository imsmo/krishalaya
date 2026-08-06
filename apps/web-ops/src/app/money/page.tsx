// apps/web-ops/src/app/money/page.tsx · OW-5 assisted money — AePS service log (PC-55 B3, canon W390–W392).
// The screen an ambassador uses at a micro-ATM, and the first thing it says is what it is NOT: this platform does not
// move the money. AePS cash moves in the BANK's systems over NPCI; what gets recorded here is what the bank did.
//
// THE RULES ARE DRAWN, NOT JUST ENFORCED (Ledger Appendix 3 / W391–W392):
//   • masked identifiers only — the account and Aadhaar inputs accept EXACTLY four digits (maxLength=4,
//     inputMode=numeric), so a full Aadhaar cannot be typed into this console even by accident;
//   • at most THREE attempts, and there is NO OTP fallback — the copy says so instead of leaving an operator
//     hunting for an alternative that does not exist;
//   • an uncertified reader can only record a BLOCKED `device_not_rd_certified` event, and the page tells the
//     operator to switch to the certified backup device;
//   • the third finger-fail requires the escalation note (nearest bank mitra/branch) — the field is right there,
//     marked required, next to the sentence "the money is untouched";
//   • the per-transaction cap is BANK-SET and deliberately NOT printed as a number here (a hardcoded ₹10,000 would
//     become a lie the day a bank changes it);
//   • balance figures are bank-reported and labelled informational.
// "My events" below is the operator's own log. The supervisor's cross-operator view is /money/oversight.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { EVENT_STATUSES, EXCEPTION_CODES, MAX_ATTEMPTS, SERVICE_KINDS, attemptsLeft, maskLast4, moneyUntouched, nextStep } from '../../features/aeps/service';
import { recordAepsEventAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('aeps.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['recorded']);
const ERR = new Set(['record', 'rule', 'dup', 'notEnabled',
  'ev_serviceKind', 'ev_status', 'ev_attempt', 'ev_exception', 'ev_amountMissing', 'ev_amountNotAllowed', 'ev_amount',
  'ev_balance', 'ev_last4Account', 'ev_last4Aadhaar', 'ev_uncertified', 'ev_escalation', 'ev_successException', 'ev_rrn', 'ev_customer']);

type EventRow = {
  id?: string; createdAt?: string; serviceKind?: string; status?: string; attemptNo?: number;
  amountMinor?: string | null; balanceAfterMinor?: string | null; accountLast4?: string | null;
  aadhaarLast4?: string | null; bankName?: string | null; exceptionCode?: string | null;
  escalationNote?: string | null; deviceCertified?: boolean; npciRrn?: string | null;
};

export default async function AssistedMoneyPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/money');
  const t = getTranslator();
  const lang = getLang();

  let mine: EventRow[] = []; let mineFailed = false; let notEnabled = false;
  try { mine = (await opsClient().ambassadors.myAepsEvents(50)) as EventRow[]; }
  catch (e) {
    // 403 is the honest answer "you are not an AePS-enabled ambassador" — not a crash, and not an empty list that
    // would imply this operator simply has no events yet.
    notEnabled = (e as { status?: number }).status === 403;
    mineFailed = !notEnabled;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('aeps.title')}</h1>
        <Link href="/money/oversight" className="kv-btn--link">{t.t('aeps.oversightLink')} →</Link>
      </div>
      <p className="kv-field__hint">{t.t('aeps.hint')}</p>
      <p className="kv-notice" role="note">{t.t('aeps.logOnlyNotice')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`aeps.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`aeps.error.${errKey}`)}</p>}
      {notEnabled && <p className="kv-error" role="alert">{t.t('aeps.error.notEnabled')}</p>}

      <h2 className="kv-section-title">{t.t('aeps.recordTitle')}</h2>
      <form action={recordAepsEventAction} className="kv-card kv-form">
        <div className="kv-field">
          <label htmlFor="ae-kind" className="kv-field__label">{t.t('aeps.serviceKind')}</label>
          <select id="ae-kind" name="serviceKind" className="kv-select" required>
            {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.t(`aeps.kind.${k}`)}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('aeps.amountRuleHint')}</p>
        </div>

        <div className="kv-field">
          <label htmlFor="ae-bank" className="kv-field__label">{t.t('aeps.bankName')}</label>
          <input id="ae-bank" name="bankName" className="kv-input" maxLength={120} />
          <label htmlFor="ae-acc" className="kv-field__label">{t.t('aeps.accountLast4')}</label>
          <input id="ae-acc" name="accountLast4" className="kv-input" inputMode="numeric" pattern="\d{4}" maxLength={4} aria-describedby="ae-mask-hint" />
          <label htmlFor="ae-aad" className="kv-field__label">{t.t('aeps.aadhaarLast4')}</label>
          <input id="ae-aad" name="aadhaarLast4" className="kv-input" inputMode="numeric" pattern="\d{4}" maxLength={4} aria-describedby="ae-mask-hint" />
          <p id="ae-mask-hint" className="kv-field__hint">{t.t('aeps.maskHint')}</p>
        </div>

        <div className="kv-field">
          <label htmlFor="ae-amt" className="kv-field__label">{t.t('aeps.amount')}</label>
          <input id="ae-amt" name="amountMajor" className="kv-input" inputMode="decimal" aria-describedby="ae-amt-hint" />
          <p id="ae-amt-hint" className="kv-field__hint">{t.t('aeps.amountHint')}</p>
          <label htmlFor="ae-bal" className="kv-field__label">{t.t('aeps.balanceAfter')}</label>
          <input id="ae-bal" name="balanceAfterMajor" className="kv-input" inputMode="decimal" aria-describedby="ae-bal-hint" />
          <p id="ae-bal-hint" className="kv-field__hint">{t.t('aeps.balanceHint')}</p>
        </div>

        <fieldset className="kv-fieldset">
          <legend>{t.t('aeps.deviceLegend')}</legend>
          <label className="kv-check"><input type="checkbox" name="deviceCertified" value="1" defaultChecked /> {t.t('aeps.deviceCertified')}</label>
          <p className="kv-field__hint">{t.t('aeps.deviceHint')}</p>
        </fieldset>

        <div className="kv-field">
          <label htmlFor="ae-status" className="kv-field__label">{t.t('aeps.status')}</label>
          <select id="ae-status" name="status" className="kv-select" required>
            {EVENT_STATUSES.map((s) => <option key={s} value={s}>{t.t(`aeps.status.${s}`)}</option>)}
          </select>
          <label htmlFor="ae-exc" className="kv-field__label">{t.t('aeps.exceptionCode')}</label>
          <select id="ae-exc" name="exceptionCode" className="kv-select">
            <option value="">{t.t('aeps.exception.none')}</option>
            {EXCEPTION_CODES.map((c) => <option key={c} value={c}>{t.t(`aeps.exception.${c}`)}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('aeps.exceptionHint')}</p>
        </div>

        <div className="kv-field">
          <label htmlFor="ae-att" className="kv-field__label">{t.t('aeps.attemptNo', { max: String(MAX_ATTEMPTS) })}</label>
          <select id="ae-att" name="attemptNo" className="kv-select" required defaultValue="1">
            {Array.from({ length: MAX_ATTEMPTS }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('aeps.noOtpHint', { max: String(MAX_ATTEMPTS) })}</p>
        </div>

        <div className="kv-field">
          <label htmlFor="ae-esc" className="kv-field__label">{t.t('aeps.escalationNote')}</label>
          <textarea id="ae-esc" name="escalationNote" className="kv-textarea" rows={2} maxLength={200} aria-describedby="ae-esc-hint" />
          <p id="ae-esc-hint" className="kv-field__hint">{t.t('aeps.escalationHint', { max: String(MAX_ATTEMPTS) })}</p>
        </div>

        <div className="kv-field">
          <label htmlFor="ae-rrn" className="kv-field__label">{t.t('aeps.npciRrn')}</label>
          <input id="ae-rrn" name="npciRrn" className="kv-input" maxLength={40} />
          <label htmlFor="ae-cust" className="kv-field__label">{t.t('aeps.customerUserId')}</label>
          <input id="ae-cust" name="customerUserId" className="kv-input" aria-describedby="ae-cust-hint" />
          <p id="ae-cust-hint" className="kv-field__hint">{t.t('aeps.customerHint')}</p>
        </div>

        <div className="kv-form__actions">
          <button type="submit" className="kv-btn">{t.t('aeps.recordBtn')}</button>
        </div>
      </form>

      <h2 className="kv-section-title">{t.t('aeps.mineTitle')}</h2>
      {mineFailed && <p className="kv-error" role="alert">{t.t('aeps.loadError')}</p>}
      {!mineFailed && !notEnabled && (
        <DataTable
          rows={mine}
          empty={t.t('aeps.mineEmpty')}
          columns={[
            { header: t.t('aeps.colWhen'), cell: (e) => (e.createdAt ? formatDate(e.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash')) },
            { header: t.t('aeps.serviceKind'), cell: (e) => t.t(`aeps.kind.${e.serviceKind}`) || String(e.serviceKind ?? '') },
            { header: t.t('aeps.colCustomerBank'), cell: (e) => `${e.bankName ?? t.t('common.dash')} ${maskLast4(e.accountLast4)}`.trim() },
            { header: t.t('aeps.amount'), cell: (e) => (e.amountMinor ? formatMoneyMinor(e.amountMinor, 'INR', lang) : t.t('common.dash')) },
            { header: t.t('aeps.status'), cell: (e) => <span className="kv-badge">{t.t(`aeps.status.${e.status}`) || String(e.status ?? '')}</span> },
            {
              header: t.t('aeps.colNext'),
              cell: (e) => {
                const step = nextStep(e);
                return (
                  <>
                    {step !== 'none' && <span className="kv-badge">{t.t(`aeps.next.${step}`)}</span>}
                    {e.exceptionCode ? <span className="kv-notif-meta"> {t.t(`aeps.exception.${e.exceptionCode}`) || e.exceptionCode}</span> : null}
                    {moneyUntouched(e) ? <span className="kv-notif-meta"> {t.t('aeps.moneyUntouched')}</span> : null}
                    {e.exceptionCode === 'finger_fail' ? <span className="kv-notif-meta"> {t.t('aeps.attemptsLeft', { n: String(attemptsLeft(e.attemptNo)) })}</span> : null}
                  </>
                );
              },
            },
          ]}
        />
      )}
      <p className="kv-field__hint kv-note">{t.t('aeps.commissionNote')}</p>
    </section>
  );
}
