// apps/web-tenant/src/app/dairy/cycles/page.tsx · W169 (Dairy payout cycles) — PC-56 TENANT-6c-6.
// Server-first, requireSession-gated, noindex. The cycle rides in the URL, so a dairy secretary can bookmark last
// fortnight and the Back button works.
//
// **FIVE WAVES OF ACTS WITH NO CALLER.** TENANT-6c-1 gave the cycle a row, 6c-2 the preview and the member's dispute,
// 6c-3 the second signature, 6c-4 the deduction's destination, 6c-5 the standing instruction that fills it — and the
// SDK had no method for a cycle, so a cooperative's fortnight could be closed, previewed, approved and deducted only
// by a curl. This page is the caller, and the dairy sub-nav's `cycles` entry (unbuilt since TENANT-6a) now points here.
//
// WHAT THIS PAGE SAYS THAT W169 CANNOT:
//   • **the canon's 312 mid-cycle DRAFTS do not exist here.** A bill is built when the window SHUTS (0157: a money
//     record that changes under the member is worse than one that arrives on the Thursday), so an open cycle shows the
//     ACCRUAL measured from priced pours, and the register says so instead of looking like nobody poured;
//   • **`paid` is not a cycle act, and there is no *"one bank trip"*.** No payout batch over a cycle exists anywhere on
//     this platform, so the payday is a DATE the cooperative recorded (which it does, since 0157 — W167 said otherwise
//     for five waves and this wave repaired that too) and bills pay one at a time;
//   • **the consent line is 25% only if this tenant left it there.** It is a setting, and a second setting caps what
//     the automatic path may take below it — both are printed, because the gap between them is what explains a small
//     recovery on a large debt;
//   • **the register is keyset-paginated, so the canon's page 13 has no address.** OFFSET on a partitioned money table
//     gets slower every fortnight and skips rows; "next" plus a shown-of-total count is what is actually true;
//   • **a bill above the consent line will REFUSE to pay** until the member is asked again (6c-4). The count is on the
//     tile and the reason is on the row, so an operator finds out before pressing pay 312 times;
//   • **the bonus slabs W168 promises are still applied by nothing**, so the accrual excludes them and says so — the
//     same caveat TENANT-6a printed on the counter board, carried to the screen where the money is agreed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyCycleConsole } from '@krishalaya/sdk-js';
import {
  actCautionKey, actRefusalKey, actTone, billStatusKey, billStatusTone, bonusIgnoredKey, consentParts, cycleHref,
  cyclesState, cyclesStateKey, deductionParts, deductionsNoteKey, disputesKey, flipDirection, directionKey,
  memberLabel, nextHref, paceParts, pagingText, paydayNoteKey, registerNoteKey, rowWarningKey, stageKey, stageTone,
} from '../../../features/dairy/cycles';
import { DAIRY_NAV, dairyNavLabelKey, dairyUnbuiltCount } from '../../../features/dairy/nav';
import { approveCycleAction, previewCycleAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.cycles.title'), robots: { index: false, follow: false } };
}

const TONE: Record<'ok' | 'bad' | 'warn' | 'muted', string> = {
  ok: 'kv-badge', bad: 'kv-badge kv-badge--danger', warn: 'kv-badge kv-badge--warn', muted: 'kv-badge kv-badge--muted',
};

export default async function DairyCyclesPage({ searchParams }: {
  searchParams: { cycle?: string; cursor?: string; direction?: string; ok?: string; error?: string; n?: string; left?: string; skipped?: string; failed?: string };
}) {
  await requireSession('/dairy/cycles');
  const t = getTranslator();
  const lang = getLang();
  const cycleId = /^[0-9a-f-]{36}$/i.test(searchParams.cycle ?? '') ? searchParams.cycle : undefined;
  const direction = searchParams.direction === 'asc' ? 'asc' : 'desc';

  let view: DairyCycleConsole | null = null;
  let state = 'ok' as ReturnType<typeof cyclesState>;
  try {
    view = await tenantClient().dairy.dairyCycleConsole({ cycleId, cursor: searchParams.cursor, direction, limit: 25 });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = cyclesState(err?.code ?? 'generic', err?.status);
  }

  const money = (m: string) => formatMoneyMinor(m, view?.currencyCode ?? 'INR', lang);
  const consent = view ? consentParts(view.consent) : null;
  const note = view ? registerNoteKey(view) : null;

  return (
    <section>
      <h1>{t.t('dairy.cycles.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.cycles.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('dairy.nav.label')}>
        {DAIRY_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'cycles' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'cycles' ? 'page' : undefined}>
            {t.t(dairyNavLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(dairyNavLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('dairy.nav.unbuilt')} {formatNumber(dairyUnbuiltCount(), lang)}</p>

      {/* ---- what the last press actually did: a bounded pass reports its own remainder ---- */}
      {searchParams.ok && (
        <div className="kv-card kv-card--notice" role="status">
          <p>
            {t.t(`dairy.cycles.ok.${searchParams.ok}`)}
            {searchParams.n && <> · {formatNumber(Number(searchParams.n), lang)}</>}
          </p>
          {Number(searchParams.left ?? 0) > 0 && (
            <p className="kv-field__hint">{t.t('dairy.cycles.pass.remaining')} {formatNumber(Number(searchParams.left), lang)} · {t.t('dairy.cycles.pass.pressAgain')}</p>
          )}
          {Number(searchParams.skipped ?? 0) > 0 && (
            <p className="kv-field__hint">{t.t('dairy.cycles.pass.skippedDisputed')} {formatNumber(Number(searchParams.skipped), lang)}</p>
          )}
          {Number(searchParams.failed ?? 0) > 0 && (
            <p className="kv-badge kv-badge--danger">{t.t('dairy.cycles.pass.failed')} {formatNumber(Number(searchParams.failed), lang)}</p>
          )}
        </div>
      )}
      {searchParams.error && <div className="kv-error" role="alert"><p>{t.t('dairy.cycles.error.act')} {searchParams.error}</p></div>}

      {state !== 'ok' || !view ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(cyclesStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W169's own error copy: bills build from collections server-side, so nothing is lost by a failed read. */}
              <p className="kv-field__hint">{t.t('dairy.cycles.buildsServerSide')}</p>
              <p><Link href="/dairy/cycles" className="kv-btn--link">{t.t('dairy.retry')}</Link></p>
            </>
          )}
        </div>
      ) : view.cycles.length === 0 ? (
        /* The canon's own empty state — and the two reasons for it, which are different problems. */
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('dairy.cycles.empty.noCycles')}</p>
          <p className="kv-field__hint">{t.t(view.cadenceOn ? 'dairy.cycles.empty.cadenceOn' : 'dairy.cycles.note.cadenceOff')}</p>
          <p><Link href="/dairy" className="kv-btn--link">{t.t('dairy.cycles.viewCollections')}</Link></p>
        </div>
      ) : (
        <>
          {/* ---- which fortnight (the canon has no picker; an operator with a closed cycle behind them needs one) ---- */}
          <p className="kv-field__hint">
            {view.cycles.map((c) => (
              <span key={c.id}>
                <Link href={cycleHref(c.id)} className={c.id === view!.cycle.id ? 'kv-btn--link kv-tab--on' : 'kv-btn--link'}>
                  {formatDate(c.periodStart, lang)} – {formatDate(c.periodEnd, lang)}
                </Link>
                {' · '}
              </span>
            ))}
          </p>

          <p>
            <strong>{formatDate(view.cycle.periodStart, lang)} – {formatDate(view.cycle.periodEnd, lang)}</strong>
            {' '}<span className={TONE[stageTone(view.cycle.stage)]}>{t.t(stageKey(view.cycle.stage))}</span>
            {' '}<span className="kv-field__hint">{t.t(`dairy.window.${view.cycle.paymentCycle}`)}</span>
          </p>

          {/* ---- W169's four tiles ---- */}
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.cycles.tile.cycle')}</span>
              <strong className="kv-stat__value">{money(view.cycle.stage === 'accruing' ? view.accrual.amountMinor : view.totals.grossMinor)}</strong>
              <span className="kv-field__hint">
                {view.cycle.stage === 'accruing'
                  ? <>{t.t('dairy.cycles.tile.accruedTo')} {formatDate(view.today, lang)} · {formatNumber(view.accrual.days, lang)} {t.t('dairy.cycles.tile.days')}</>
                  : <>{formatNumber(view.totals.bills, lang)} {t.t('dairy.cycles.tile.bills')} · {view.totals.litres} {t.t('dairy.litres')}</>}
              </span>
              <span className="kv-field__hint">
                {formatNumber(view.accrual.membersWithPours, lang)} {t.t('dairy.cycles.tile.pourers')}
                {' · '}{formatNumber(view.accrual.billsExisting, lang)} {t.t('dairy.cycles.tile.billsExisting')}
              </span>
              {bonusIgnoredKey(view.accrual) && <span className="kv-badge kv-badge--danger">{t.t(bonusIgnoredKey(view.accrual)!)}</span>}
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.cycles.tile.pays')}</span>
              <strong className="kv-stat__value">{formatDate(view.cycle.payday, lang)}</strong>
              {/* The canon's "one bank trip" — the part that is NOT built, beside the date that is. */}
              <span className="kv-field__hint">{t.t(paydayNoteKey(view.payday))}</span>
              <span className="kv-field__hint">
                {formatNumber(view.payday.paid, lang)} {t.t('dairy.cycles.tile.paid')}
                {' · '}{formatNumber(view.payday.awaitingPayment, lang)} {t.t('dairy.cycles.tile.awaiting')}
              </span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.cycles.tile.deductions')}</span>
              <strong className="kv-stat__value">{money(view.deductions.totalMinor)}</strong>
              <span className="kv-field__hint">
                {Object.keys(view.deductions.byTypeCode).length === 0
                  ? t.t('dairy.cycles.tile.noDeductions')
                  : Object.entries(view.deductions.byTypeCode).map(([code, amount]) => `${code} ${money(amount)}`).join(' · ')}
              </span>
              {deductionsNoteKey(view.deductions) && (
                <span className={view.deductions.needingConsent > 0 ? 'kv-badge kv-badge--danger' : 'kv-badge kv-badge--muted'}>
                  {t.t(deductionsNoteKey(view.deductions)!)}
                  {view.deductions.needingConsent > 0 && <> {formatNumber(view.deductions.needingConsent, lang)}</>}
                </span>
              )}
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.cycles.tile.lastDisputes')}</span>
              <strong className="kv-stat__value">
                {view.lastCycle
                  ? <>{formatNumber(view.lastCycle.disputes.total, lang)} / {formatNumber(view.lastCycle.disputes.bills, lang)}</>
                  : t.t('common.dash')}
              </strong>
              <span className="kv-field__hint">{t.t(disputesKey(view.lastCycle))}</span>
              {view.lastCycle && (
                <span className="kv-field__hint">
                  {formatDate(view.lastCycle.periodStart, lang)} – {formatDate(view.lastCycle.periodEnd, lang)}
                </span>
              )}
            </div>
          </div>

          {/* ---- the two acts, with the refusal the API already resolved ---- */}
          <div className="kv-card">
            <h2>{t.t('dairy.cycles.acts.heading')}</h2>
            <p>
              <form action={previewCycleAction} style={{ display: 'inline' }}>
                <input type="hidden" name="cycleId" value={view.cycle.id} />
                <button type="submit" className="kv-btn kv-btn--primary" disabled={!view.acts.preview.can}>
                  {t.t('dairy.cycles.act.preview')}
                </button>
              </form>
              {' '}
              <span className={TONE[actTone(view.acts.preview)]}>
                {t.t(actRefusalKey(view.acts.preview) ?? actCautionKey(view.acts.preview) ?? 'dairy.cycles.act.ready')}
              </span>
              {view.cycle.previewedAt && (
                <span className="kv-field__hint"> · {t.t('dairy.cycles.act.previewedAt')} {formatDate(view.cycle.previewedAt, lang)}</span>
              )}
            </p>
            <p>
              <form action={approveCycleAction} style={{ display: 'inline' }}>
                <input type="hidden" name="cycleId" value={view.cycle.id} />
                <button type="submit" className="kv-btn" disabled={!view.acts.approve.can}>
                  {t.t('dairy.cycles.act.approve')}
                </button>
              </form>
              {' '}
              <span className={TONE[actTone(view.acts.approve)]}>
                {t.t(actRefusalKey(view.acts.approve) ?? actCautionKey(view.acts.approve) ?? 'dairy.cycles.act.ready')}
              </span>
              {view.cycle.approvedAt && (
                <span className="kv-field__hint"> · {t.t('dairy.cycles.act.approvedAt')} {formatDate(view.cycle.approvedAt, lang)}</span>
              )}
            </p>
            {/* W169's timeline alert, with this tenant's own numbers in it. */}
            <p className="kv-field__hint">
              {t.t('dairy.cycles.timeline.closes')} {formatDate(view.cycle.closesAt, lang)}
              {' → '}{t.t('dairy.cycles.timeline.previewed')}
              {' → '}{t.t('dairy.cycles.timeline.approved')}
              {' → '}{t.t('dairy.cycles.timeline.paid')}
            </p>
            {consent && (
              <p className="kv-field__hint">
                {t.t('dairy.cycles.consent.above')} {formatNumber(consent.consentPct, lang)}%
                {consent.tightened && <> · {t.t('dairy.cycles.consent.automatic')} {formatNumber(consent.automaticPct, lang)}%</>}
              </p>
            )}
          </div>

          {/* ---- the register ---- */}
          <h2>{t.t('dairy.cycles.register.heading')}</h2>
          {note && <p className="kv-card kv-card--notice" role="status">{t.t(note)}</p>}
          <DataTable
            rows={view.page.rows}
            empty={t.t('dairy.cycles.register.empty')}
            columns={[
              {
                header: t.t('dairy.cycles.col.member'),
                cell: (r) => (
                  <>
                    {memberLabel(r).name
                      ? <strong>{memberLabel(r).name}</strong>
                      : <span className="kv-field__hint">{t.t('dairy.cycles.col.noName')}</span>}
                    {' '}<span className="kv-mono">{memberLabel(r).code}</span>
                    {r.mccCode && <span className="kv-field__hint"> · {r.mccCode}</span>}
                    {(paceParts(r).perDay || paceParts(r).avg) && (
                      <>
                        <br />
                        <span className="kv-field__hint">
                          {paceParts(r).perDay && <>{paceParts(r).perDay} {t.t('dairy.cycles.col.perDay')}</>}
                          {paceParts(r).avg && (
                            <> · {t.t('dairy.cycles.col.avg')} {paceParts(r).avg}
                              {' '}({formatNumber(paceParts(r).avgDays, lang)} {t.t('dairy.cycles.col.avgDays')})</>
                          )}
                        </span>
                      </>
                    )}
                  </>
                ),
              },
              { header: t.t('dairy.cycles.col.litres'), cell: (r) => <>{r.litres}</> },
              { header: t.t('dairy.cycles.col.gross'), cell: (r) => money(r.grossMinor) },
              {
                header: t.t('dairy.cycles.col.deductions'),
                cell: (r) => (r.deductionsMinor === '0' ? <span className="kv-field__hint">{t.t('common.dash')}</span> : (
                  <>
                    −{money(r.deductionsMinor)}
                    <br />
                    {deductionParts(r).map((d, i) => (
                      <span key={i} className="kv-field__hint">
                        {d.label ?? t.t('dairy.cycles.col.unknownType')} {money(d.amountMinor)}
                        {d.partly && <> · {t.t('dairy.cycles.col.partlyApplied')}</>}
                        {d.unsupportedReason && <> · <span className="kv-badge kv-badge--danger">{t.t('dairy.cycles.col.unsupportedType')}</span></>}
                        {i < deductionParts(r).length - 1 && ' · '}
                      </span>
                    ))}
                  </>
                )),
              },
              { header: t.t('dairy.cycles.col.net'), cell: (r) => <strong>{money(r.netMinor)}</strong> },
              {
                header: t.t('dairy.cycles.col.status'),
                cell: (r) => (
                  <>
                    <span className={TONE[billStatusTone(r.status)]}>{t.t(billStatusKey(r.status))}</span>
                    {r.status === 'draft' && (
                      <span className="kv-field__hint"> · {t.t('dairy.cycles.col.queues')} {formatDate(view!.cycle.payday, lang)}</span>
                    )}
                    {r.disputeWindowEnds && (
                      <><br /><span className="kv-field__hint">{t.t('dairy.cycles.col.windowEnds')} {formatDate(r.disputeWindowEnds, lang)}</span></>
                    )}
                    {rowWarningKey(r) && (
                      <><br /><span className="kv-badge kv-badge--danger">{t.t(rowWarningKey(r)!)}</span></>
                    )}
                  </>
                ),
              },
            ]}
          />
          <p className="kv-field__hint">
            {formatNumber(pagingText(view).shown, lang)} / {formatNumber(pagingText(view).of, lang)} {t.t('dairy.cycles.register.shownOf')}
            {' · '}{t.t('dairy.cycles.register.pageTotal')} {money(view.page.totals.netMinor)}
            {' · '}{t.t('dairy.cycles.register.cycleTotal')} {money(view.totals.netMinor)}
          </p>
          <p className="kv-field__hint">
            <Link href={cycleHref(view.cycle.id, { direction: flipDirection(direction) })} className="kv-btn--link">
              {t.t(directionKey(flipDirection(direction)))}
            </Link>
            {nextHref(view.cycle.id, view, direction) && (
              <> · <Link href={nextHref(view.cycle.id, view, direction)!} className="kv-btn--link">{t.t('dairy.cycles.register.next')}</Link></>
            )}
            {' · '}{t.t('dairy.cycles.register.keyset')}
          </p>

          {/* ---- the promise on this screen that IS kept end to end, and the one that is not ---- */}
          <p className="kv-field__hint">{t.t('dairy.cycles.disputePausesOneBill')}</p>
          <p className="kv-field__hint">{t.t('dairy.cycles.noBatch')}</p>
        </>
      )}
    </section>
  );
}
