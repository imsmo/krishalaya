// apps/web-partner/src/app/servicing/page.tsx · post-disbursal servicing (PC-55 B7, on W54-8).
// The lender's working surface after money has gone out: where the book is hurting (DPD), who to call today
// (collections), and — for one loan at a time — the KCC drawl ledger, restructures, and the write-off of last resort.
//
// THREE DELIBERATE CHOICES:
//   1. DPD IS ORDERED WORST-FIRST, and 90+ is labelled NPA. A ladder in arbitrary order buries the buckets that
//      matter; the label is a label only — provisioning is the lender's own regulated calculation, not this console's.
//   2. THE KCC BALANCE IS THE SERVER'S NUMBER. Each row shows the signed amount and the balance it produced, both as
//      returned. Nothing is re-derived here: a locally recomputed balance that disagreed with the server's is the
//      worst thing to put in front of a borrower.
//   3. MAKER-CHECKER IS ENFORCED BY ABSENCE. `checker_approved` is not rendered for the person who proposed the
//      restructure — the API refuses it, and offering a button that 403s would teach an officer the control is a
//      formality. The page says who proposed it and that a second person must approve.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  KCC_ENTRY_KINDS, REPAYMENT_CHANNELS, DESTINATION_KINDS, RESTRUCTURE_REASONS,
  absMinor, awaitingChecker, canWriteOff, isNpaBucket, kccRowDirection, offeredTransitions, sortDpd, totalLoans,
  type DpdBucketRow,
} from '../../features/lending/servicing';
import { kccEntryAction, proposeRestructureAction, transitionRestructureAction, writeOffAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sv.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['kcc', 'proposed', 'writtenOff', 'rs_mediation', 'rs_accepted', 'rs_checker_approved', 'rs_activated', 'rs_rejected', 'rs_expired']);
const ERR = new Set(['generic', 'forbidden', 'notFound', 'illegal', 'invalid',
  'kcc_kind', 'kcc_amount', 'kcc_narrative', 'kcc_channel', 'kcc_destination',
  'rs_reason', 'rs_oldInstalment', 'rs_newInstalment', 'rs_oldTenor', 'rs_newTenor', 'rs_rate', 'rs_rateChanged',
  'rs_interestDelta', 'rs_holidayMonths', 'rs_holidayStartsOn', 'rs_caseRef', 'rs_noRelief', 'rs_to',
  'wo_reason', 'wo_status']);

type CollectionRow = Record<string, unknown> & { loanId?: string; borrowerUserId?: string; dpd?: number; outstandingMinor?: string; nextDueDate?: string | null };
type KccRow = Record<string, unknown> & { id?: string; entryKind?: string; amountMinor?: string; balanceAfterMinor?: string; narrative?: string; createdAt?: string };
type RestructureRow = Record<string, unknown> & {
  id?: string; status?: string; proposedBy?: string; caseRef?: string | null; reasonCode?: string;
  oldInstalmentMinor?: string; newInstalmentMinor?: string; oldTenorMonths?: number; newTenorMonths?: number;
  rateAprBps?: number; holidayMonths?: number; createdAt?: string;
};
type LoanRow = { id?: string; status?: string; outstandingMinor?: string; interestAprBps?: number; borrowerUserId?: string };

export default async function ServicingPage({ searchParams }: {
  searchParams: { loanId?: string; ok?: string; error?: string };
}) {
  await requirePartner();
  const t = getTranslator();
  const client = partnerClient();
  const loanId = (searchParams.loanId ?? '').trim();

  // Each section degrades on its own (Law 12): a failed collections read must not blank the DPD ladder.
  let dpd: DpdBucketRow[] = []; let dpdFailed = false; let forbidden = false;
  try { dpd = (await client.fintech.dpdBuckets()) as DpdBucketRow[]; }
  catch (e) { forbidden = (e as { status?: number }).status === 403; dpdFailed = !forbidden; }

  let collections: CollectionRow[] = []; let collectionsFailed = false;
  if (!forbidden) {
    try { collections = (await client.fintech.collectionsQueue(100)) as CollectionRow[]; }
    catch { collectionsFailed = true; }
  }

  let loan: LoanRow | null = null; let kcc: KccRow[] = []; let restructures: RestructureRow[] = []; let viewerId: string | undefined;
  if (loanId && !forbidden) {
    try { loan = (await client.request<LoanRow>('GET', `fintech/loans/${encodeURIComponent(loanId)}`)).data; } catch { loan = null; }
    try { kcc = (await client.fintech.kccLedger(loanId)) as KccRow[]; } catch { kcc = []; }
    try { restructures = (await client.fintech.restructures(loanId)) as RestructureRow[]; } catch { restructures = []; }
    // Whose console is this? Maker-checker needs the viewer's identity to withhold the approve step from the proposer.
    try { viewerId = (await client.auth.me()).id; } catch { viewerId = undefined; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const ladder = sortDpd(dpd);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('sv.title')}</h1>
        <Link href="/portfolio" className="kv-btn--link">{t.t('nav.portfolio')} →</Link>
      </div>
      <p className="kv-field__hint">{t.t('sv.hint')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`sv.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sv.error.${errKey}`)}</p>}
      {forbidden && <p className="kv-error" role="alert">{t.t('sv.forbidden')}</p>}

      {!forbidden && (
        <>
          <h2>{t.t('sv.dpd.title')}</h2>
          {dpdFailed ? <p className="kv-error" role="alert">{t.t('sv.loadError')}</p> : (
            <>
              <p className="kv-field__hint">{t.t('sv.dpd.total', { n: String(totalLoans(ladder)) })}</p>
              <DataTable
                rows={ladder}
                empty={t.t('sv.dpd.empty')}
                columns={[
                  {
                    header: t.t('sv.dpd.bucket'),
                    cell: (r) => (isNpaBucket(r.bucket)
                      ? <strong>{t.t(`sv.bucket.${String(r.bucket)}`) || String(r.bucket)} · {t.t('sv.dpd.npa')}</strong>
                      : (t.t(`sv.bucket.${String(r.bucket)}`) || String(r.bucket ?? t.t('common.dash')))),
                  },
                  { header: t.t('sv.dpd.loans'), cell: (r) => String(r.loans ?? 0) },
                  { header: t.t('sv.dpd.outstanding'), cell: (r) => (r.outstandingMinor ? formatMoneyMinor(r.outstandingMinor, 'INR', 'en') : t.t('common.dash')) },
                ]}
              />
              <p className="kv-field__hint">{t.t('sv.dpd.npaNote')}</p>
            </>
          )}

          <h2>{t.t('sv.coll.title')}</h2>
          {collectionsFailed ? <p className="kv-error" role="alert">{t.t('sv.loadError')}</p> : (
            <DataTable
              rows={collections}
              empty={t.t('sv.coll.empty')}
              columns={[
                { header: t.t('sv.coll.loan'), cell: (r) => <Link href={`/servicing?loanId=${encodeURIComponent(String(r.loanId ?? ''))}`} className="kv-link">{String(r.loanId ?? '').slice(0, 8)}…</Link> },
                { header: t.t('sv.coll.dpd'), cell: (r) => String(r.dpd ?? t.t('common.dash')) },
                { header: t.t('sv.coll.outstanding'), cell: (r) => (r.outstandingMinor ? formatMoneyMinor(String(r.outstandingMinor), 'INR', 'en') : t.t('common.dash')) },
                { header: t.t('sv.coll.nextDue'), cell: (r) => (r.nextDueDate ? formatDate(String(r.nextDueDate), 'en') : t.t('common.dash')) },
              ]}
            />
          )}

          <h2>{t.t('sv.loan.title')}</h2>
          <form method="get" action="/servicing" className="kv-search" role="search" aria-label={t.t('sv.loan.title')}>
            <label htmlFor="loanId" className="kv-field__label">{t.t('sv.loan.idLabel')}</label>
            <input id="loanId" name="loanId" className="kv-input" defaultValue={loanId} />
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('sv.loan.open')}</button>
          </form>

          {loanId && !loan ? <p className="kv-notice" role="note">{t.t('sv.loan.notFound')}</p> : null}

          {loan ? (
            <>
              <dl className="kv-facts">
                <div className="kv-facts__row"><dt>{t.t('sv.loan.status')}</dt><dd><span className="kv-badge">{String(loan.status ?? '')}</span></dd></div>
                <div className="kv-facts__row"><dt>{t.t('sv.loan.outstanding')}</dt><dd>{loan.outstandingMinor ? formatMoneyMinor(loan.outstandingMinor, 'INR', 'en') : t.t('common.dash')}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('sv.loan.rate')}</dt><dd>{loan.interestAprBps != null ? `${(loan.interestAprBps / 100).toFixed(2)} %` : t.t('common.dash')}</dd></div>
              </dl>

              {/* ---- KCC drawl ledger ---- */}
              <h3 className="kv-card__title">{t.t('sv.kcc.title')}</h3>
              <DataTable
                rows={kcc}
                empty={t.t('sv.kcc.empty')}
                columns={[
                  { header: t.t('sv.kcc.when'), cell: (r) => (r.createdAt ? formatDate(String(r.createdAt), 'en', { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash')) },
                  { header: t.t('sv.kcc.kind'), cell: (r) => t.t(`sv.kcc.kind.${String(r.entryKind)}`) || String(r.entryKind ?? '') },
                  {
                    header: t.t('sv.kcc.amount'),
                    cell: (r) => {
                      const dir = kccRowDirection(r.amountMinor);
                      const amount = r.amountMinor ? formatMoneyMinor(absMinor(r.amountMinor), 'INR', 'en') : t.t('common.dash');
                      return <span className={dir === 'out' ? 'kv-amount--credit' : 'kv-amount--debit'}>{t.t(`sv.kcc.dir.${dir}`)} {amount}</span>;
                    },
                  },
                  { header: t.t('sv.kcc.balance'), cell: (r) => (r.balanceAfterMinor ? formatMoneyMinor(String(r.balanceAfterMinor), 'INR', 'en') : t.t('common.dash')) },
                  { header: t.t('sv.kcc.narrative'), cell: (r) => String(r.narrative ?? t.t('common.dash')) },
                ]}
              />
              <p className="kv-field__hint">{t.t('sv.kcc.balanceNote')}</p>

              <form action={kccEntryAction} className="kv-card kv-form">
                <h3 className="kv-card__title">{t.t('sv.kcc.addTitle')}</h3>
                <input type="hidden" name="loanId" value={loanId} />
                <div className="kv-field">
                  <label htmlFor="kcc-kind" className="kv-field__label">{t.t('sv.kcc.kind')}</label>
                  <select id="kcc-kind" name="entryKind" className="kv-select" required>
                    {KCC_ENTRY_KINDS.map((k) => <option key={k} value={k}>{t.t(`sv.kcc.kind.${k}`)}</option>)}
                  </select>
                  <p className="kv-field__hint">{t.t('sv.kcc.signNote')}</p>
                </div>
                <div className="kv-field">
                  <label htmlFor="kcc-amt" className="kv-field__label">{t.t('sv.kcc.amount')}</label>
                  <input id="kcc-amt" name="amountMajor" className="kv-input" inputMode="decimal" required />
                  <label htmlFor="kcc-narr" className="kv-field__label">{t.t('sv.kcc.narrative')}</label>
                  <input id="kcc-narr" name="narrative" className="kv-input" maxLength={500} required aria-describedby="kcc-narr-hint" />
                  <p id="kcc-narr-hint" className="kv-field__hint">{t.t('sv.kcc.narrativeHint')}</p>
                </div>
                <div className="kv-field">
                  <label htmlFor="kcc-dest" className="kv-field__label">{t.t('sv.kcc.destination')}</label>
                  <select id="kcc-dest" name="destinationKind" className="kv-select">
                    <option value="">{t.t('sv.kcc.notApplicable')}</option>
                    {DESTINATION_KINDS.map((d) => <option key={d} value={d}>{t.t(`sv.kcc.dest.${d}`)}</option>)}
                  </select>
                  <label htmlFor="kcc-chan" className="kv-field__label">{t.t('sv.kcc.channel')}</label>
                  <select id="kcc-chan" name="repaymentChannel" className="kv-select">
                    <option value="">{t.t('sv.kcc.notApplicable')}</option>
                    {REPAYMENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`sv.kcc.chan.${c}`)}</option>)}
                  </select>
                  <p className="kv-field__hint">{t.t('sv.kcc.fieldsNote')}</p>
                </div>
                <div className="kv-form__actions"><button type="submit" className="kv-btn">{t.t('sv.kcc.addBtn')}</button></div>
              </form>

              {/* ---- restructures ---- */}
              <h3 className="kv-card__title">{t.t('sv.rs.title')}</h3>
              <p className="kv-notice" role="note">{t.t('sv.rs.doctrine')}</p>
              {restructures.length === 0 ? <p className="kv-field__hint">{t.t('sv.rs.empty')}</p> : restructures.map((r) => {
                const offered = offeredTransitions(r.status, viewerId, r.proposedBy);
                const isProposer = !!viewerId && viewerId === r.proposedBy;
                return (
                  <div key={String(r.id)} className="kv-card">
                    <div className="kv-page-head">
                      <span className="kv-badge">{t.t(`sv.rs.state.${String(r.status)}`) || String(r.status ?? '')}</span>
                      <span className="kv-fine">{r.caseRef ? String(r.caseRef) : String(r.id ?? '').slice(0, 8)}</span>
                    </div>
                    <p className="kv-fine">
                      {t.t(`sv.rs.reason.${String(r.reasonCode)}`) || String(r.reasonCode ?? '')}
                      {r.oldInstalmentMinor && r.newInstalmentMinor ? ` · ${formatMoneyMinor(String(r.oldInstalmentMinor), 'INR', 'en')} → ${formatMoneyMinor(String(r.newInstalmentMinor), 'INR', 'en')}` : ''}
                      {r.oldTenorMonths && r.newTenorMonths ? ` · ${t.t('sv.rs.tenor', { from: String(r.oldTenorMonths), to: String(r.newTenorMonths) })}` : ''}
                      {r.holidayMonths ? ` · ${t.t('sv.rs.holiday', { n: String(r.holidayMonths) })}` : ''}
                    </p>
                    {awaitingChecker(r.status) ? (
                      <p className="kv-field__hint">{isProposer ? t.t('sv.rs.youProposed') : t.t('sv.rs.awaitingYou')}</p>
                    ) : null}
                    <div className="kv-actions">
                      {offered.map((to) => (
                        <form key={to} action={transitionRestructureAction} className="kv-inline-form">
                          <input type="hidden" name="loanId" value={loanId} />
                          <input type="hidden" name="id" value={String(r.id ?? '')} />
                          <input type="hidden" name="to" value={to} />
                          <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t(`sv.rs.to.${to}`)}</button>
                        </form>
                      ))}
                    </div>
                  </div>
                );
              })}

              <form action={proposeRestructureAction} className="kv-card kv-form">
                <h3 className="kv-card__title">{t.t('sv.rs.proposeTitle')}</h3>
                <input type="hidden" name="loanId" value={loanId} />
                <input type="hidden" name="currentRateAprBps" value={String(loan.interestAprBps ?? '')} />
                <div className="kv-field">
                  <label htmlFor="rs-reason" className="kv-field__label">{t.t('sv.rs.reasonLabel')}</label>
                  <select id="rs-reason" name="reasonCode" className="kv-select" required>
                    {RESTRUCTURE_REASONS.map((r) => <option key={r} value={r}>{t.t(`sv.rs.reason.${r}`)}</option>)}
                  </select>
                  <label htmlFor="rs-case" className="kv-field__label">{t.t('sv.rs.caseRef')}</label>
                  <input id="rs-case" name="caseRef" className="kv-input" maxLength={60} />
                </div>
                <div className="kv-field">
                  <label htmlFor="rs-oi" className="kv-field__label">{t.t('sv.rs.oldInstalment')}</label>
                  <input id="rs-oi" name="oldInstalmentMajor" className="kv-input" inputMode="decimal" required />
                  <label htmlFor="rs-ni" className="kv-field__label">{t.t('sv.rs.newInstalment')}</label>
                  <input id="rs-ni" name="newInstalmentMajor" className="kv-input" inputMode="decimal" required />
                  <label htmlFor="rs-ot" className="kv-field__label">{t.t('sv.rs.oldTenor')}</label>
                  <input id="rs-ot" name="oldTenorMonths" className="kv-input" inputMode="numeric" pattern="\d{1,3}" required />
                  <label htmlFor="rs-nt" className="kv-field__label">{t.t('sv.rs.newTenor')}</label>
                  <input id="rs-nt" name="newTenorMonths" className="kv-input" inputMode="numeric" pattern="\d{1,3}" required />
                </div>
                <div className="kv-field">
                  <label htmlFor="rs-rate" className="kv-field__label">{t.t('sv.rs.rate')}</label>
                  <input id="rs-rate" name="rateAprBps" className="kv-input" inputMode="numeric" pattern="\d{1,5}" defaultValue={String(loan.interestAprBps ?? '')} required aria-describedby="rs-rate-hint" />
                  <p id="rs-rate-hint" className="kv-field__hint">{t.t('sv.rs.rateHint')}</p>
                  <label htmlFor="rs-delta" className="kv-field__label">{t.t('sv.rs.interestDelta')}</label>
                  <input id="rs-delta" name="totalInterestDeltaMajor" className="kv-input" inputMode="decimal" required aria-describedby="rs-delta-hint" />
                  <p id="rs-delta-hint" className="kv-field__hint">{t.t('sv.rs.interestDeltaHint')}</p>
                </div>
                <div className="kv-field">
                  <label htmlFor="rs-hm" className="kv-field__label">{t.t('sv.rs.holidayMonths')}</label>
                  <input id="rs-hm" name="holidayMonths" className="kv-input" inputMode="numeric" pattern="\d{1,2}" />
                  <label htmlFor="rs-hs" className="kv-field__label">{t.t('sv.rs.holidayStartsOn')}</label>
                  <input id="rs-hs" name="holidayStartsOn" type="date" className="kv-input" />
                  <label className="kv-check"><input type="checkbox" name="penalInterestWaived" value="1" /> {t.t('sv.rs.penalWaived')}</label>
                  <p className="kv-field__hint">{t.t('sv.rs.reliefNote')}</p>
                </div>
                <div className="kv-form__actions"><button type="submit" className="kv-btn">{t.t('sv.rs.proposeBtn')}</button></div>
              </form>

              {/* ---- write-off ---- */}
              <h3 className="kv-card__title">{t.t('sv.wo.title')}</h3>
              {canWriteOff(loan.status) ? (
                <form action={writeOffAction} className="kv-card kv-form">
                  <input type="hidden" name="loanId" value={loanId} />
                  <input type="hidden" name="loanStatus" value={String(loan.status ?? '')} />
                  <div className="kv-field">
                    <label htmlFor="wo-reason" className="kv-field__label">{t.t('sv.wo.reason')}</label>
                    <textarea id="wo-reason" name="reason" className="kv-textarea" rows={3} maxLength={500} required aria-describedby="wo-hint" />
                    <p id="wo-hint" className="kv-field__hint">{t.t('sv.wo.hint')}</p>
                  </div>
                  <div className="kv-form__actions"><button type="submit" className="kv-btn kv-btn--muted">{t.t('sv.wo.btn')}</button></div>
                </form>
              ) : (
                <p className="kv-field__hint">{t.t('sv.wo.onlyOverdue')}</p>
              )}
            </>
          ) : null}
        </>
      )}
      <p className="kv-field__hint kv-note">{t.t('sv.footerNote')}</p>
    </section>
  );
}
