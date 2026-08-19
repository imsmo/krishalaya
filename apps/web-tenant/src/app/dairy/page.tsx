// apps/web-tenant/src/app/dairy/page.tsx · W167 (Dairy — collections) — the counter board (PC-56 TENANT-6a).
// Server-first, requireSession-gated, noindex. A pure read: the day and the shift ride in the URL, so a dairy
// secretary can bookmark "yesterday evening" and the Back button works.
//
// **THE TENANT CONSOLE HAD NO DAIRY SCREEN AT ALL** — six canon screens, zero pages — while the dairy module has had a
// careful WRITE path since 0007: pours priced by the active rate card in bigint, unique per (member, day, shift),
// idempotent, outboxed. What did not exist was any way to READ a day: `MilkCollectionRepository.listFor` and the SDK's
// `listCollections` both require a `membershipId`, so a centre's own morning could not be listed, let alone three
// centres side by side, which is the whole of W167.
//
// WHAT THIS PAGE SAYS THAT W167 CANNOT:
//   • **"evening starts 17:00" is not recorded.** No shift clock exists — no column, no setting, no per-centre
//     schedule — and those are the hours a farmer walks to the centre for;
//   • **"pays Fri 17 Jul" is not recorded either.** The window's CLOSE is derivable; nothing on this platform records
//     when a dairy cycle pays, and the canon ties the day to a logistics run no dairy row references. 312 families
//     plan a week around that date, so it is named, not guessed;
//   • **the cycle is DERIVED**, from each member's own `payment_cycle` preference — a column that, before this wave,
//     nothing on the platform read. Fortnightly gives the canon's own "01–15";
//   • **the BMC temp column has no source.** `bmc_units` has had no application code since 0007 and no cold-chain
//     reading has ever been written for one, so each centre reports `no unit` / `no readings` instead of a blank cell
//     that would read as "cold enough to not mention" (TENANT-6d builds the monitor);
//   • **the Analyzer tick is about the CENTRE, not the pour.** `milk_collections.device_payload` — the column built to
//     hold the analyzer's own reading — is dead, and fat/SNF arrive as plain decimal strings. W168 hangs an
//     adulteration flag and a member's money on that reading, so the distinction is printed;
//   • **the premium band pays nothing.** `milk_rate_cards.bonus_rules` is read by NOTHING (the pricing engine's own
//     header calls the slabs "DEFERRED"), so the accrued total excludes the bonus W168 promises the farmer — and says
//     so wherever the total appears;
//   • and **"312 milk_bills building" are not building**: nothing generates bills on a clock, so the board prints
//     members-who-poured beside bills-that-exist and lets the gap speak.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyCounterBoard } from '@krishalaya/sdk-js';
import {
  SHIFTS, accrualKey, analyzerKey, analyzerText, analyzerVerified, billsGapKey, bmcKey, bmcText, bmcTone,
  boardHref, bonusIgnoredKey, centreCoverageText, centreQuietKey, coverageKey, coverageShareText, dairyState,
  dairyStateKey, flagKindKey, flagWorkflowKey, flagsKey, paydayKey, qualityText, retryChainKey, shiftClockKey,
  shiftKey, shiftOf, totalsFoot, uniquenessKey, windowBasisKey, windowKey,
} from '../../features/dairy/counter';
import { DAIRY_NAV, dairyNavLabelKey, dairyUnbuiltCount } from '../../features/dairy/nav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.counter.title'), robots: { index: false, follow: false } };
}

const TONE: Record<'ok' | 'bad' | 'muted', string> = {
  ok: 'kv-badge', bad: 'kv-badge kv-badge--danger', muted: 'kv-badge kv-badge--muted',
};

export default async function DairyCounterPage({ searchParams }: { searchParams: { shift?: string; day?: string } }) {
  await requireSession('/dairy');
  const t = getTranslator();
  const lang = getLang();
  const shift = shiftOf(searchParams.shift);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day : undefined;

  let board: DairyCounterBoard | null = null;
  let state = 'ok' as ReturnType<typeof dairyState>;
  try {
    board = await tenantClient().dairy.counterBoard({ shift, day });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = dairyState(err?.code ?? 'generic', err?.status);
  }

  const money = (m: string) => formatMoneyMinor(m, board?.accrual.currencyCode ?? 'INR', lang);
  const foot = board ? totalsFoot(board.centres, board.totals.litres) : null;

  return (
    <section>
      <h1>{t.t('dairy.counter.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.counter.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('dairy.nav.label')}>
        {DAIRY_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'collections' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'collections' ? 'page' : undefined}>
            {t.t(dairyNavLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(dairyNavLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('dairy.nav.unbuilt')} {formatNumber(dairyUnbuiltCount(), lang)}</p>

      {state !== 'ok' || !board ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(dairyStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W167's own error copy: the counters keep working. */}
              <p className="kv-field__hint">{t.t('dairy.counter.buffersOffline')}</p>
              <p><Link href={boardHref(shift, day)} className="kv-btn--link">{t.t('dairy.retry')}</Link></p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* ---- the shift switch, and the hours nobody recorded ---- */}
          <nav className="kv-filters" aria-label={t.t('dairy.shift.label')}>
            {SHIFTS.map((s) => (
              <Link key={s} href={boardHref(s, day)} className={s === shift ? 'kv-chip is-active' : 'kv-chip'} aria-current={s === shift ? 'true' : undefined}>
                {t.t(shiftKey(s))}
              </Link>
            ))}
          </nav>
          <p className="kv-field__hint">
            {formatDate(board.day, lang)} · {t.t(shiftKey(board.shift))}
            {' · '}{t.t(shiftClockKey(board.shiftClock))}
          </p>

          {/* ---- the tiles ---- */}
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.tile.litres')}</span>
              <strong className="kv-stat__value">{board.totals.litres} {t.t('dairy.litres')}</strong>
              <span className="kv-field__hint">
                {t.t(coverageKey(board.coverage))}{' '}
                {board.coverage.kind === 'measured' && (
                  <>{formatNumber(board.coverage.poured, lang)} / {formatNumber(board.coverage.enrolled, lang)} ({coverageShareText(board.coverage)})</>
                )}
              </span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.tile.quality')}</span>
              <strong className="kv-stat__value">{qualityText(board.totals.fatPct, board.totals.snfPct) ?? t.t('common.dash')}</strong>
              <span className="kv-field__hint">{t.t('dairy.tile.qualityBasis')}</span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.tile.accrued')}</span>
              <strong className="kv-stat__value">{money(board.accrual.amountMinor)}</strong>
              <span className="kv-field__hint">
                {t.t(windowKey(board.window))} {board.window.from} – {board.window.to}
                {' · '}{t.t(windowBasisKey(board.window))}
              </span>
              <span className="kv-field__hint">{t.t(accrualKey(board.accrual))}</span>
              {bonusIgnoredKey(board.accrual) && (
                <span className="kv-field__hint">{t.t(bonusIgnoredKey(board.accrual)!)}</span>
              )}
              {billsGapKey(board.accrual) && (
                <span className="kv-field__hint">
                  {t.t(billsGapKey(board.accrual)!)}{' '}
                  {formatNumber(board.accrual.membersWithPours, lang)} / {formatNumber(board.accrual.billsExisting, lang)}
                </span>
              )}
              <span className="kv-field__hint">{t.t(paydayKey(board.payday))} {board.payday.closesOn}</span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.tile.flags')}</span>
              <strong className="kv-stat__value">{formatNumber(board.flagSummary.total, lang)}</strong>
              <span className="kv-field__hint">
                {t.t(flagsKey(board.flagSummary))}
                {board.flagSummary.kinds.length > 0 && <> · {board.flagSummary.kinds.map((k) => t.t(flagKindKey(k))).join(', ')}</>}
              </span>
              {flagWorkflowKey(board.flagSummary) && (
                <span className="kv-field__hint">{t.t(flagWorkflowKey(board.flagSummary)!)}</span>
              )}
            </div>
          </div>

          {/* ---- the centre table ---- */}
          <DataTable
            rows={board.centres}
            empty={t.t('dairy.centre.none')}
            columns={[
              {
                header: t.t('dairy.col.centre'),
                cell: (c) => (
                  <>
                    <strong>{c.code}</strong><br />
                    <span className="kv-field__hint">{c.name}</span>
                  </>
                ),
              },
              {
                header: t.t('dairy.col.litres'),
                cell: (c) => (
                  <>
                    {c.litres}
                    {centreQuietKey(c) && <> <span className="kv-badge kv-badge--muted">{t.t(centreQuietKey(c)!)}</span></>}
                  </>
                ),
              },
              {
                header: t.t('dairy.col.pourers'),
                cell: (c) => centreCoverageText(c) ?? formatNumber(c.pourers, lang),
              },
              { header: t.t('dairy.col.quality'), cell: (c) => qualityText(c.fatPct, c.snfPct) ?? t.t('common.dash') },
              {
                header: t.t('dairy.col.bmc'),
                cell: (c) => (
                  <>
                    {bmcText(c.bmc) && <><strong>{bmcText(c.bmc)}</strong>{' '}</>}
                    <span className={TONE[bmcTone(c.bmc)]}>{t.t(bmcKey(c.bmc))}</span>
                  </>
                ),
              },
              {
                header: t.t('dairy.col.analyzer'),
                cell: (c) => (
                  <>
                    {analyzerText(c.analyzer) ?? t.t('common.dash')}
                    {/* Never a tick: the platform cannot say this reading came from that device. */}
                    {!analyzerVerified(c.analyzer) && <><br /><span className="kv-field__hint">{t.t(analyzerKey(c.analyzer))}</span></>}
                  </>
                ),
              },
              { header: t.t('dairy.col.value'), cell: (c) => money(c.amountMinor) },
            ]}
          />

          {/* ---- W167's own foot-of-table check, recomputed rather than asserted ---- */}
          {foot && board.centres.length > 0 && (
            <p className="kv-field__hint">
              {formatNumber(foot.centres, lang)} {t.t('dairy.centresWord')} · {foot.litres} {t.t('dairy.litres')}
              {' · '}{t.t(foot.foots ? 'dairy.totals.foots' : 'dairy.totals.mismatch')}
            </p>
          )}

          {/* ---- the promise that IS kept, and the cycle mix the window does not fit ---- */}
          <p className="kv-field__hint">{t.t(uniquenessKey())}</p>
          {board.cycleMix.length > 1 && (
            <p className="kv-field__hint">
              {t.t('dairy.window.mix')}{' '}
              {board.cycleMix.map((m) => `${t.t(`dairy.cycleName.${m.paymentCycle}`)} ${formatNumber(m.members, lang)}`).join(' · ')}
            </p>
          )}
          {/* W2559–W2561: the dairy mutate chain hosts "Retry", and a retry of a read is a page load. */}
          <p className="kv-field__hint">{t.t(retryChainKey())}</p>
        </>
      )}
    </section>
  );
}
