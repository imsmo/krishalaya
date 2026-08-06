// apps/web-ops/src/app/money/oversight/page.tsx · OW-5 AePS oversight (PC-55 B3, canon W392 taxonomy).
// The supervisor's cross-operator view, and it is ordered around the two rows that mean a person did not get their
// money: a THIRD finger-fail (escalated to a bank mitra) and a BLOCKED uncertified device. Filters mirror the API's
// own vocabulary exactly, so a filter can never ask for a status the server does not have.
//
// This page is read-only on purpose. There is no "resolve", no "retry", no "reverse": the platform cannot move AePS
// cash — the bank did or did not, over NPCI. What a supervisor can do with this list is human work (call the mitra,
// swap the device, check on the customer), and pretending otherwise with a button would be the dishonest part.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { EVENT_STATUSES, EXCEPTION_CODES, attemptsLeft, isEventStatus, isExceptionCode, maskLast4, moneyUntouched, nextStep } from '../../../features/aeps/service';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('aeps.oversightTitle'), robots: { index: false, follow: false } };
}

type EventRow = {
  id?: string; createdAt?: string; ambassadorId?: string; serviceKind?: string; status?: string; attemptNo?: number;
  amountMinor?: string | null; accountLast4?: string | null; bankName?: string | null;
  exceptionCode?: string | null; escalationNote?: string | null; deviceCertified?: boolean; npciRrn?: string | null;
};

export default async function AepsOversightPage({ searchParams }: { searchParams: { status?: string; exceptionCode?: string } }) {
  await requireSession('/money/oversight');
  const t = getTranslator();
  const lang = getLang();

  const status = isEventStatus(searchParams.status) ? searchParams.status : undefined;
  const exceptionCode = isExceptionCode(searchParams.exceptionCode) ? searchParams.exceptionCode : undefined;

  let rows: EventRow[] = []; let failed = false; let forbidden = false;
  try { rows = (await opsClient().ambassadors.aepsOversight({ status, exceptionCode, limit: 200 })) as EventRow[]; }
  catch (e) { forbidden = (e as { status?: number }).status === 403; failed = !forbidden; }

  const escalations = rows.filter((r) => nextStep(r) === 'escalate').length;
  const blocked = rows.filter((r) => nextStep(r) === 'switch_device').length;
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, exceptionCode, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/money/oversight?${s}` : '/money/oversight';
  };

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('aeps.oversightTitle')}</h1>
        <Link href="/money" className="kv-btn--link">← {t.t('aeps.title')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('aeps.oversightHint')}</p>

      {forbidden && <p className="kv-error" role="alert">{t.t('aeps.error.oversightForbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('aeps.loadError')}</p>}

      {!forbidden && !failed && (
        <>
          {(escalations > 0 || blocked > 0) && (
            <p className="kv-notice" role="note">
              {escalations > 0 ? t.t('aeps.escalationsNotice', { n: String(escalations) }) : ''}
              {escalations > 0 && blocked > 0 ? ' ' : ''}
              {blocked > 0 ? t.t('aeps.blockedNotice', { n: String(blocked) }) : ''}
            </p>
          )}

          <nav className="kv-tabs" aria-label={t.t('aeps.filterStatus')}>
            <a href={q({ status: undefined })} className={`kv-tab${!status ? ' kv-tab--active' : ''}`} aria-current={!status ? 'page' : undefined}>{t.t('aeps.allStatuses')}</a>
            {EVENT_STATUSES.map((s) => (
              <a key={s} href={q({ status: s })} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>{t.t(`aeps.status.${s}`)}</a>
            ))}
          </nav>
          <nav className="kv-tabs" aria-label={t.t('aeps.filterException')}>
            <a href={q({ exceptionCode: undefined })} className={`kv-tab${!exceptionCode ? ' kv-tab--active' : ''}`} aria-current={!exceptionCode ? 'page' : undefined}>{t.t('aeps.allExceptions')}</a>
            {EXCEPTION_CODES.map((c) => (
              <a key={c} href={q({ exceptionCode: c })} className={`kv-tab${c === exceptionCode ? ' kv-tab--active' : ''}`} aria-current={c === exceptionCode ? 'page' : undefined}>{t.t(`aeps.exception.${c}`)}</a>
            ))}
          </nav>

          <DataTable
            rows={rows}
            empty={t.t('aeps.oversightEmpty')}
            columns={[
              { header: t.t('aeps.colWhen'), cell: (e) => (e.createdAt ? formatDate(e.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash')) },
              { header: t.t('aeps.colOperator'), cell: (e) => (e.ambassadorId ? `${e.ambassadorId.slice(0, 8)}…` : t.t('common.dash')) },
              { header: t.t('aeps.serviceKind'), cell: (e) => t.t(`aeps.kind.${e.serviceKind}`) || String(e.serviceKind ?? '') },
              { header: t.t('aeps.colCustomerBank'), cell: (e) => `${e.bankName ?? t.t('common.dash')} ${maskLast4(e.accountLast4)}`.trim() },
              { header: t.t('aeps.amount'), cell: (e) => (e.amountMinor ? formatMoneyMinor(e.amountMinor, 'INR', lang) : t.t('common.dash')) },
              { header: t.t('aeps.status'), cell: (e) => <span className="kv-badge">{t.t(`aeps.status.${e.status}`) || String(e.status ?? '')}</span> },
              {
                header: t.t('aeps.colException'),
                cell: (e) => {
                  const step = nextStep(e);
                  return (
                    <>
                      {e.exceptionCode ? t.t(`aeps.exception.${e.exceptionCode}`) || e.exceptionCode : t.t('common.dash')}
                      {step === 'escalate' ? <strong className="kv-amount--debit"> {t.t('aeps.next.escalate')}</strong> : null}
                      {step === 'switch_device' ? <strong className="kv-amount--debit"> {t.t('aeps.next.switch_device')}</strong> : null}
                      {e.exceptionCode === 'finger_fail' ? <span className="kv-notif-meta"> {t.t('aeps.attemptsLeft', { n: String(attemptsLeft(e.attemptNo)) })}</span> : null}
                      {moneyUntouched(e) ? <span className="kv-notif-meta"> {t.t('aeps.moneyUntouched')}</span> : null}
                    </>
                  );
                },
              },
              { header: t.t('aeps.escalationNote'), cell: (e) => e.escalationNote ?? t.t('common.dash') },
            ]}
          />
        </>
      )}
      <p className="kv-field__hint kv-note">{t.t('aeps.oversightReadOnlyNote')}</p>
    </section>
  );
}
