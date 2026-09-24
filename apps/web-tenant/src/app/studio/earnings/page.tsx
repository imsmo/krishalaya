// apps/web-tenant/src/app/studio/earnings/page.tsx · W418 — Earnings · PC-56 TENANT-7d-money.
//
// W418: *"Royalty is respect with a decimal point — every rupee traced to a course and a learner count."* · *"Gross ·
// Your royalty (80%) · Tenant + platform (20%)"* · *"Course-by-course"* · *"Payout rides the monthly wage-lane"*.
//
// THE INSTRUCTOR'S MONEY DESK OVER THE LEDGER. Every figure here is a SUM the API made over 0174's `instructor_royalty_lines`
// per currency in minor units, formatted at that currency's own scale — one tile row per currency, never a mixed total
// (6e-1). Two windows: THIS MONTH in the cooperative's zone (the API resolves the month `AT TIME ZONE` the tenant's
// country — 7c's rule; the page prints the zone) and LIFETIME. Held royalty (no accepted agreement yet) is named as
// held; Paid out and Available come from the payment plane's own rows and the ledger's released sum.
//
// SIX STATES: `ready` · `empty` (no paid enrollment yet — W418's *"No earnings yet"*) · `noProfile` · `restricted` ·
// `notEnabled` (W418's *"Flagged off — Earnings disabled"*, a code from the API, never a page of zeroes) · `error` with
// Retry (a page load). Loading is loading.tsx.
//
// WHAT W418 DRAWS THAT NO FACT SUPPORTS is printed by name: the *monthly wage-lane* clock (a royalty payout rides whichever
// batch the tenant maker prepares; there is no monthly run to wait for), refunds (no course refund path exists),
// *"last-computed figures are cached and dated"* (nothing is cached — every read is a live sum), *Retry*.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { EarningsStatementLine, EarningsView } from '@krishalaya/sdk-js';
import { profileHref, studioHref, editProfileHref } from '../../../features/studio/instructor';
import {
  AGREEMENT_PATH, EARNINGS_REFUSED_BY_NAME, EARNINGS_TILES, PAYOUT_PATH, RULE_PATH, agreementStatusKey, availableState, earningsHref, earningsRefusedKey, earningsState, earningsStateKey,
  lineStateKey, payoutRefusalKey, payoutStageKey, shareText, tileLabelKey, tileMinor,
} from '../../../features/studio/earnings';
import { exportEnqueueErrorKey } from '../../../features/dairy/exports';
import { confirmHref } from '../../../features/mutate/chain';
import { enqueueEarningsExportAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('earnings.title'), robots: { index: false, follow: false } };
}

const STATEMENT_PAGE = 25;
const when = (iso: string, lang: string) => formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' });

export default async function EarningsPage({ searchParams }: { searchParams: { instructor?: string; cursor?: string; exportError?: string } }) {
  const instructorParam = typeof searchParams.instructor === 'string' && searchParams.instructor.length ? searchParams.instructor : null;
  const cursor = typeof searchParams.cursor === 'string' && searchParams.cursor.length ? searchParams.cursor : null;
  await requireSession(earningsHref({ instructor: instructorParam }));
  const t = getTranslator();
  const lang = getLang();

  let view: EarningsView | null = null; let code: string | null = null; let status: number | undefined;
  let statement: { items: EarningsStatementLine[]; nextCursor: string | null } = { items: [], nextCursor: null };
  try {
    view = await tenantClient().instructorEarnings.view(instructorParam);
    statement = await tenantClient().instructorEarnings.statement({ instructorId: instructorParam, cursor: cursor ?? undefined, limit: STATEMENT_PAGE });
  } catch (e) { if (e instanceof SdkError) { code = e.code ?? null; status = e.status; } else code = 'error'; }
  const state = earningsState(code, status, view);
  const exportError = exportEnqueueErrorKey(searchParams.exportError);
  const isSelf = view?.instructor.isSelf ?? false;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('earnings.title')}</h1>
        {view && <span><Link href={studioHref()} className="kv-btn--link">{t.t('studio.title')}</Link> · <Link href={profileHref(isSelf ? null : view.instructor.id)} className="kv-btn--link">{t.t('studio.profileLink')}</Link></span>}
      </div>
      <p className="kv-field__hint">{t.t('earnings.lead')}</p>
      {view && !isSelf && <p className="kv-card kv-card--notice" role="status">{t.t('earnings.deskViewing', { name: view.instructor.name ?? t.t('studio.unnamed') })}</p>}

      {(state === 'noProfile' || state === 'restricted' || state === 'notEnabled' || state === 'error') && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(earningsStateKey(state))}</p>
          {state === 'noProfile' && <p><Link href={editProfileHref()} className="kv-btn">{t.t('studio.createProfile')}</Link></p>}
          {state === 'notEnabled' && <p className="kv-field__hint">{t.t('earnings.state.notEnabledHint')}</p>}
          {state === 'error' && <p><Link href={earningsHref({ instructor: instructorParam, cursor })} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
        </div>
      )}
      {exportError && <div className="kv-error" role="alert"><p>{t.t(exportError)}</p></div>}

      {view && (state === 'ready' || state === 'empty') && (
        <>
          {/* ---- whose money, and the two papers behind it: the agreement and the rule ---- */}
          <div className="kv-card">
            <p><strong>{view.instructor.name ?? t.t('studio.unnamed')}</strong> · {t.t('earnings.share', { share: shareText(view.instructor.royaltyBps) })}</p>
            <p className="kv-field__hint">{t.t('earnings.privacy')}</p>
            {view.agreement.current ? (
              <p>{t.t('earnings.agreement.current', { version: formatNumber(view.agreement.current.version, lang), share: shareText(view.agreement.current.instructorShareBps), when: view.agreement.current.acceptedAt ? when(view.agreement.current.acceptedAt, lang) : t.t('common.dash') })}</p>
            ) : (
              <p className="kv-field__hint">{t.t('earnings.agreement.none')}</p>
            )}
            {view.agreement.offered && (
              <div className="kv-card kv-card--notice" role="status">
                <p>{t.t('earnings.agreement.offered', { version: formatNumber(view.agreement.offered.version, lang), share: shareText(view.agreement.offered.instructorShareBps), tenant: shareText(view.agreement.offered.tenantShareBps), platform: shareText(view.agreement.offered.platformShareBps) })}</p>
                {view.agreement.offered.termsNote && <p className="kv-field__hint">{view.agreement.offered.termsNote}</p>}
                {isSelf && (
                  <p>
                    <Link href={confirmHref(AGREEMENT_PATH, { act: 'accept', agreement: view.agreement.offered.id })} className="kv-btn">{t.t('earnings.agreement.accept')}</Link>{' '}
                    <Link href={confirmHref(AGREEMENT_PATH, { act: 'decline', agreement: view.agreement.offered.id })} className="kv-btn--link">{t.t('earnings.agreement.decline')}</Link>
                  </p>
                )}
              </div>
            )}
            {view.agreement.history.length > 0 && (
              <ul className="kv-list">
                {view.agreement.history.map((a) => <li key={a.id}>v{formatNumber(a.version, lang)} · {t.t(agreementStatusKey(a.status))} · {shareText(a.instructorShareBps)}% · {when(a.offeredAt, lang)}</li>)}
              </ul>
            )}
            {view.rule ? (
              <p className="kv-field__hint">{t.t(view.rule.source === 'tenant' ? 'earnings.rule.tenant' : 'earnings.rule.platform', { instructor: shareText(view.rule.instructorShareBps), tenant: shareText(view.rule.tenantShareBps), platform: shareText(view.rule.platformShareBps) })} {view.privileged && <Link href={RULE_PATH} className="kv-btn--link">{t.t('earnings.rule.open')}</Link>}</p>
            ) : <p className="kv-field__hint">{t.t('earnings.rule.none')}</p>}
            {!view.splitFlagOn && <p className="kv-field__hint">{t.t('earnings.splitOff')}</p>}
          </div>

          {/* ---- the tiles: one row per currency, two windows, every figure a sum the API made ---- */}
          {state === 'empty' && (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t('earnings.state.empty')}</p>
              <p className="kv-field__hint">{t.t('earnings.state.emptyHint')}</p>
            </div>
          )}
          {view.tiles.map((tile) => (
            <div className="kv-card" key={tile.currencyCode}>
              <h2>{t.t('earnings.currency', { code: tile.currencyCode })} <span className="kv-field__hint">{t.t('earnings.zone', { zone: view.timezone, from: formatDate(view.monthStart, lang, { dateStyle: 'medium' }) })}</span></h2>
              <table className="kv-table">
                <thead><tr><th>{t.t('earnings.colFigure')}</th><th>{t.t('earnings.colMtd')}</th><th>{t.t('earnings.colLifetime')}</th></tr></thead>
                <tbody>
                  {EARNINGS_TILES.map((name) => {
                    const mtd = tileMinor(tile, name, 'mtd'); const life = tileMinor(tile, name, 'lifetime');
                    return (
                      <tr key={name}>
                        <th scope="row">{t.t(tileLabelKey(name))}</th>
                        <td>{mtd === null ? <span className="kv-field__hint">{t.t('earnings.noMonth')}</span> : formatMoneyMinor(mtd, tile.currencyCode, lang)}</td>
                        <td>{life === null ? <span className="kv-field__hint">{t.t('common.dash')}</span> : <>{formatMoneyMinor(life, tile.currencyCode, lang)}{name === 'available' && availableState(life) === 'negative' && <> <span className="kv-badge kv-badge--danger">{t.t('earnings.availableNegative')}</span></>}</>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="kv-field__hint">{t.t('earnings.tileNote', { purchases: formatNumber(tile.lifetime.purchases, lang), mtd: formatNumber(tile.mtd?.purchases ?? 0, lang) })}</p>
              {tile.lifetime.heldLines > 0 && <p className="kv-field__hint">{t.t('earnings.heldNote', { n: formatNumber(tile.lifetime.heldLines, lang) })}</p>}
              {isSelf && (
                (view.payoutRefusals.find((r) => r.currencyCode === tile.currencyCode)?.refusals ?? []).length === 0
                  ? <p><Link href={confirmHref(PAYOUT_PATH, { currencyCode: tile.currencyCode })} className="kv-btn">{t.t('earnings.payout.request')}</Link></p>
                  : <p className="kv-field__hint">{t.t('earnings.payout.cannot')} {(view.payoutRefusals.find((r) => r.currencyCode === tile.currencyCode)?.refusals ?? []).map((r) => t.t(payoutRefusalKey(r))).join(' · ')}</p>
              )}
            </div>
          ))}

          {/* ---- course by course: W418's table, free courses with their learners and no money ---- */}
          <div className="kv-card">
            <h2>{t.t('earnings.courses')}</h2>
            {view.courses.length === 0 ? <p className="kv-field__hint">{t.t('earnings.noCourses')}</p> : (
              <table className="kv-table">
                <thead><tr><th>{t.t('studio.colCourse')}</th><th>{t.t('studio.colStatus')}</th><th>{t.t('earnings.colEnrollments')}</th><th>{t.t('studio.colPrice')}</th><th>{t.t('earnings.tile.gross')}</th><th>{t.t('earnings.colYourShare')}</th><th>{t.t('earnings.colTenantPlatform')}</th></tr></thead>
                <tbody>
                  {view.courses.map((c) => (
                    <tr key={c.courseId}>
                      <td><Link href={`/courses/${encodeURIComponent(c.courseId)}`} className="kv-link">{c.title}</Link></td>
                      <td><span className="kv-badge">{t.t(`studio.status.${c.status}`) || c.status}</span></td>
                      <td>{formatNumber(c.enrollments, lang)}{c.paid !== c.enrollments && <span className="kv-field__hint"> · {t.t('earnings.paidOf', { n: formatNumber(c.paid, lang) })}</span>}</td>
                      <td>{c.priceMinor === '0' ? t.t('studio.free') : formatMoneyMinor(c.priceMinor, c.currencyCode, lang)}</td>
                      <td>{formatMoneyMinor(c.gross, c.currencyCode, lang)}</td>
                      <td>{formatMoneyMinor(c.instructor, c.currencyCode, lang)}</td>
                      <td>{formatMoneyMinor(c.tenantPlatform, c.currencyCode, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {view.courses.some((c) => c.priceMinor === '0') && <p className="kv-field__hint">{t.t('earnings.freeNote', { n: formatNumber(view.courses.filter((c) => c.priceMinor === '0').reduce((s, c) => s + c.enrollments, 0), lang) })}</p>}
          </div>

          {/* ---- the statement: one line per paid enrollment, keyset, newest first ---- */}
          <div className="kv-card">
            <h2>{t.t('earnings.statement')}</h2>
            {statement.items.length === 0 ? <p className="kv-field__hint">{t.t('earnings.statementEmpty')}</p> : (
              <table className="kv-table">
                <thead><tr><th>{t.t('earnings.colWhen')}</th><th>{t.t('studio.colCourse')}</th><th>{t.t('earnings.tile.gross')}</th><th>{t.t('earnings.colYourShare')}</th><th>{t.t('earnings.tile.tenant')}</th><th>{t.t('earnings.tile.platform')}</th><th>{t.t('earnings.colState')}</th></tr></thead>
                <tbody>
                  {statement.items.map((l) => (
                    <tr key={l.id}>
                      <td>{when(l.occurredAt, lang)}</td>
                      <td>{l.courseTitle ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>{formatMoneyMinor(l.gross, l.currencyCode, lang)}</td>
                      <td>{formatMoneyMinor(l.instructor, l.currencyCode, lang)} <span className="kv-field__hint">({shareText(l.instructorShareBps)}%)</span></td>
                      <td>{formatMoneyMinor(l.tenant, l.currencyCode, lang)}</td>
                      <td>{formatMoneyMinor(l.platform, l.currencyCode, lang)}</td>
                      <td><span className={l.state === 'held_pending_agreement' ? 'kv-badge kv-badge--warn' : 'kv-badge kv-badge--ok'}>{t.t(lineStateKey(l.state))}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p>
              {cursor && <Link href={earningsHref({ instructor: instructorParam })} className="kv-btn--link">{t.t('earnings.statementFirst')}</Link>}{' '}
              {statement.nextCursor && <Link href={earningsHref({ instructor: instructorParam, cursor: statement.nextCursor })} className="kv-btn--link">{t.t('earnings.statementOlder')}</Link>}
            </p>
            {isSelf && (
              <form action={enqueueEarningsExportAction}>
                <button type="submit" className="kv-btn--link">{t.t('earnings.export')}</button>
                <span className="kv-field__hint"> {t.t('earnings.exportNote')}</span>
              </form>
            )}
          </div>

          {/* ---- money out: the plane's rows, each at its stage on the batch ---- */}
          <div className="kv-card">
            <h2>{t.t('earnings.payouts')}</h2>
            <p className="kv-field__hint">{t.t('earnings.payout.rides')}</p>
            {view.payouts.length === 0 ? <p className="kv-field__hint">{t.t('earnings.payoutsEmpty')}</p> : (
              <ul className="kv-list">
                {view.payouts.map((p) => <li key={p.id}>{when(p.createdAt, lang)} · {formatMoneyMinor(p.amountMinor, p.currencyCode, lang)} · {t.t(payoutStageKey(p))}{p.failureCode && <span className="kv-field__hint"> · {p.failureCode}</span>}</li>)}
              </ul>
            )}
          </div>

          {/* ---- W418's promises this platform does not keep, by name ---- */}
          <ul className="kv-list kv-field__hint">
            {EARNINGS_REFUSED_BY_NAME.map((n) => <li key={n}>{t.t(earningsRefusedKey(n))}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
