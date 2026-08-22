// apps/web-tenant/src/app/dairy/insights/page.tsx · W172 (Dairy insights) — PC-56 TENANT-6e-1.
// Server-first, requireSession-gated, noindex. A pure read: the window rides in the URL, so a secretary can bookmark
// the 180-day view and the Back button works.
//
// **THIS IS THE LAST DARK ENTRY IN THE DAIRY SUB-NAV.** TENANT-6a drew all six sections and marked five "not built";
// 6b-2, 6c-6, 6d-1 and 6d-2 lit four of them. `insights` was the last, and `dairyUnbuiltCount()` reaches zero here.
//
// WHAT THIS PAGE SAYS THAT W172 DOES NOT:
//   • **"On-time payout streak · 24 cycles" is not a number this platform can produce.** A streak is "consecutive
//     cycles where the money arrived on or before the promised day". The promise exists (`dairy_bill_cycles.payday`);
//     the arrival does not — a cycle's status is `open|closed` only, `milk_bills.status` admits `paid` with no instant
//     beside it, and `payouts` has no `settled_at` at all. So the tile is a sentence naming the three missing facts,
//     with the two things that ARE true beside it: cycles closed, and cycles where every bill was approved. It is the
//     most quotable figure on the canon's screen and the page refuses it, because a cooperative would say it to a
//     member choosing between this society and the private collector down the road.
//   • **"Zero spoilage" is refused in TENANT-6d-2's own words**, not re-decided here: no relation on this platform
//     reduces anybody's litres anywhere in the schema, and 0162 added the condemnation threshold without the fact.
//   • **"Rate card v4" has no source.** 0009 calls `milk_rate_cards` "versioned" and gave it no version column, so the
//     panel names the card and the date it took effect. It also carries 6b-2's finding, which matters more: nothing
//     closes a superseded card's `effective_to`, so TWO cards can be pricing milk at once and the page says which one
//     is winning.
//   • **"Member ₹/L" is the COUNTER rate, before deductions**, and the page says so on the tile. What a member receives
//     is the bill's net, after feed credit, loan EMI, insurance and share.
//   • **"+18 this quarter" is "new to us this year".** Finding a member's first-ever pour is an unbounded scan of every
//     partition a cooperative has ever filled (Law 8), so the cohorts are judged against a declared one-year lookback
//     and the page prints the bound rather than implying the platform checked all time.
//   • **the premium count is a forecast while the slab flag is off.** 6b-2 drew that line ("would qualify", not
//     "earned") and this page keeps it, including refusing the *"was 141"* comparison when the two windows measured on
//     different bases — a flag being switched on is not milk improving.
//
// And the promise W172 makes that IS true end to end: *"numbers assemble from milk_collections + milk_bills (derived —
// no new tables)"*. Migration 0168 adds no table, no view and no rollup; the indexes that make it bounded were already
// there, put in by 6a and 6c.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyInsights, DairyInsightWindow } from '@krishalaya/sdk-js';
import {
  COHORT_BASIS_KEY, INSIGHT_WINDOWS, PAYOUT_STREAK_KEY, PAYOUT_STREAK_SUBSTITUTE_KEY, RATE_CARD_NO_VERSION_KEY,
  SPOILAGE_KEY, barPct, bpsToPercentText, changeAbsentKey, changeDirection, cohortsKey, historyKey, insightsHref,
  insightsState, insightsStateKey, insightsTransportState, isPartialBucket, litresText, peakMilli, premiumIncomparableKey,
  premiumKey, rateBasisKey, ratePerLitreMinor, shiftKey, slabMetricKey, slabText, windowLabelKey,
} from '../../../features/dairy/insights';
// The animal and pricing-model words are 6b-2's, reused: one key per fact, in one catalogue.
import { animalTypeKey, pricingModelKey } from '../../../features/dairy/quality';
import { DAIRY_NAV, dairyNavLabelKey, dairyUnbuiltCount } from '../../../features/dairy/nav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.insights.title'), robots: { index: false, follow: false } };
}

const ARROW: Record<'up' | 'down' | 'flat' | 'none', string> = {
  up: 'dairy.insights.change.up', down: 'dairy.insights.change.down', flat: 'dairy.insights.change.flat', none: '',
};

export default async function DairyInsightsPage({ searchParams }: { searchParams: { window?: string } }) {
  await requireSession('/dairy/insights');
  const t = getTranslator();
  const lang = getLang();

  const asked = Number(searchParams.window);
  const window: DairyInsightWindow | undefined =
    INSIGHT_WINDOWS.includes(asked as DairyInsightWindow) ? (asked as DairyInsightWindow) : undefined;

  let view: DairyInsights | null = null;
  let state = 'ok' as ReturnType<typeof insightsState>;
  try {
    view = await tenantClient().dairy.insights({ window });
    state = insightsState(view);
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = insightsTransportState(err?.code ?? 'generic', err?.status) ?? 'error';
  }

  const ready = view && view.kind === 'ready' ? view : null;
  const money = (minor: string) => formatMoneyMinor(minor, ready?.currencyCode ?? '', lang);
  const current = window ?? 90;

  /** The comparison line under a tile: an arrow and a percent, or the sentence saying why there is neither. */
  const change = (c: Parameters<typeof changeDirection>[0]) => {
    const dir = changeDirection(c);
    if (dir === 'none') {
      const key = changeAbsentKey(c);
      return key ? <span className="kv-field__hint">{t.t(key)}</span> : null;
    }
    return (
      <span className={dir === 'down' ? 'kv-badge kv-badge--danger' : 'kv-badge'}>
        {t.t(ARROW[dir])} {c.kind === 'changed' ? bpsToPercentText(c.deltaBps) : ''}%
        {' '}{t.t('dairy.insights.change.vsPrevious')}
      </span>
    );
  };

  return (
    <section>
      <h1>{t.t('dairy.insights.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.insights.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('dairy.nav.label')}>
        {DAIRY_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'insights' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'insights' ? 'page' : undefined}>
            {t.t(dairyNavLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(dairyNavLabelKey(i))}</span>
        )))}
      </nav>
      {dairyUnbuiltCount() > 0 && (
        <p className="kv-field__hint">{t.t('dairy.nav.unbuilt')} {formatNumber(dairyUnbuiltCount(), lang)}</p>
      )}

      {/* W172's range control. A closed set on both sides — the page cannot offer a range the partition pruning
          cannot serve (see the DTO). */}
      <nav className="kv-tabs" aria-label={t.t('dairy.insights.window.label')}>
        {INSIGHT_WINDOWS.map((w) => (
          <Link key={w} href={insightsHref(w)} className={w === current ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={w === current ? 'page' : undefined}>
            {t.t(windowLabelKey(w))}
          </Link>
        ))}
      </nav>

      {state !== 'ok' || !ready ? (
        <div
          className={state === 'error' || state === 'unavailable' ? 'kv-error' : 'kv-card kv-card--notice'}
          role={state === 'error' || state === 'unavailable' ? 'alert' : 'status'}
        >
          <p>{t.t(insightsStateKey(state))}</p>

          {/* The gate says which cycle and how long the wait is — "two more cycles" means nothing without the word
              "fortnight" beside it. */}
          {view && view.kind === 'not_enough_history' && view.history.kind === 'not_enough_history' && (
            <>
              <p className="kv-field__hint">
                {t.t(historyKey(view.history))}
                {' · '}{t.t(`dairy.window.${view.history.cycle}`)}
                {' · '}{formatNumber(view.history.haveCycles, lang)} / {formatNumber(2, lang)}
              </p>
              {view.pourersSoFar > 0 && (
                <p className="kv-field__hint">
                  {t.t('dairy.insights.pourers.soFar')} {formatNumber(view.pourersSoFar, lang)}
                </p>
              )}
            </>
          )}

          {/* *"Couldn't build insights"* names the reference row that is missing rather than shrugging: the page needs
              the tenant's currency AND its scale, and guessing two decimals is wrong by a factor of a hundred for a
              currency that has none. */}
          {view && view.kind === 'unavailable' && (
            <ul className="kv-list">{view.missing.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
          )}

          {state === 'error' && (
            <p><Link href={insightsHref(current)} className="kv-btn--link">{t.t('dairy.retry')}</Link></p>
          )}
        </div>
      ) : (
        <>
          <p className="kv-field__hint">
            {formatDate(ready.ranges.current.from, lang)} – {formatDate(ready.ranges.current.to, lang)}
            {' · '}{t.t('dairy.insights.partialDay')}
          </p>

          {/* ---- the four KPI tiles: two measured, one measured with a bound, one refused ---- */}
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.insights.tile.volume')}</span>
              <strong className="kv-stat__value">{litresText(ready.volume.perDayMilli)} {t.t('dairy.litres')}</strong>
              {change(ready.volume.change)}
              <span className="kv-field__hint">
                {/* The average is per CALENDAR day, and this is the line that explains a low one without excusing it. */}
                {t.t('dairy.insights.volume.perCalendarDay')}
                {' · '}{t.t('dairy.insights.volume.collectedOn')} {formatNumber(ready.volume.daysWithPours, lang)} / {formatNumber(ready.volume.days, lang)}
              </span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.insights.tile.ratePerLitre')}</span>
              {ready.ratePerLitre.kind === 'measured' ? (
                <>
                  <strong className="kv-stat__value">{money(ratePerLitreMinor(ready.ratePerLitre.centiMinorPerLitre))}</strong>
                  {ready.ratePerLitre.change.kind === 'changed' ? (
                    <span className={ready.ratePerLitre.change.deltaBps < 0 ? 'kv-badge kv-badge--danger' : 'kv-badge'}>
                      {t.t(ARROW[changeDirection(ready.ratePerLitre.change)])}
                      {' '}{money(ratePerLitreMinor(ready.ratePerLitre.change.delta.replace('-', '')))}
                    </span>
                  ) : change(ready.ratePerLitre.change)}
                  {/* Never omitted. The counter rate is not what a member receives. */}
                  <span className="kv-field__hint">{t.t(rateBasisKey(ready.ratePerLitre) ?? 'common.dash')}</span>
                </>
              ) : (
                <span className="kv-field__hint">{t.t('dairy.insights.rate.noPours')}</span>
              )}
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.insights.tile.pourers')}</span>
              {ready.pourers.kind === 'measured' ? (
                <>
                  <strong className="kv-stat__value">{formatNumber(ready.pourers.active, lang)}</strong>
                  <span className="kv-field__hint">
                    {t.t('dairy.insights.pourers.new')} {formatNumber(ready.pourers.newcomers, lang)}
                    {' · '}{t.t('dairy.insights.pourers.winBacks')} {formatNumber(ready.pourers.winBacks, lang)}
                    {' · '}{t.t('dairy.insights.pourers.continuing')} {formatNumber(ready.pourers.continuing, lang)}
                  </span>
                  {/* The bound, printed. "New" here means "new to us this year". */}
                  <span className="kv-field__hint">
                    {t.t(COHORT_BASIS_KEY)} {formatNumber(ready.pourers.lookbackDays, lang)}
                  </span>
                  {change(ready.pourers.change)}
                </>
              ) : (
                <span className={ready.pourers.kind === 'inconsistent' ? 'kv-badge kv-badge--danger' : 'kv-field__hint'}>
                  {t.t(cohortsKey(ready.pourers) ?? 'common.dash')}
                </span>
              )}
            </div>

            {/* THE REFUSED TILE. A sentence where the canon has a number, with the missing facts named and the two
                supportable figures beside it. */}
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.insights.tile.payoutStreak')}</span>
              <span className="kv-badge kv-badge--muted">{t.t(PAYOUT_STREAK_KEY)}</span>
              <span className="kv-field__hint">
                {t.t(PAYOUT_STREAK_SUBSTITUTE_KEY)}
                {' '}{t.t('dairy.insights.payout.cyclesClosed')} {formatNumber(ready.payoutStreak.cyclesClosed, lang)}
                {' · '}{t.t('dairy.insights.payout.cyclesApproved')} {formatNumber(ready.payoutStreak.cyclesAllBillsApproved, lang)}
              </span>
              <ul className="kv-list">
                {ready.payoutStreak.missing.map((m) => <li key={m}><code>{m}</code></li>)}
              </ul>
            </div>
          </div>

          {/* ---- the chart ---- */}
          <h2 id="by-shift">{t.t('dairy.insights.chart.title')}</h2>
          <p className="kv-field__hint">
            {t.t('dairy.insights.chart.buckets')} {formatNumber(ready.byShift.bucketDays, lang)}
            {ready.byShift.firstBucketDays < ready.byShift.bucketDays && (
              <> {' · '}{t.t('dairy.insights.chart.partialFirst')} {formatNumber(ready.byShift.firstBucketDays, lang)}</>
            )}
          </p>
          {peakMilli(ready.byShift) === 0n ? (
            <p className="kv-field__hint">{t.t('dairy.insights.chart.empty')}</p>
          ) : (
            <table className="kv-table">
              <caption className="kv-field__hint">{t.t('dairy.insights.chart.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('dairy.insights.chart.week')}</th>
                  {ready.byShift.shifts.map((s) => <th key={s} scope="col">{t.t(shiftKey(s))}</th>)}
                  <th scope="col">{t.t('dairy.insights.chart.total')}</th>
                </tr>
              </thead>
              <tbody>
                {ready.byShift.buckets.map((b, i) => (
                  <tr key={b.from}>
                    <th scope="row">
                      {formatDate(b.from, lang)}
                      {isPartialBucket(ready.byShift, i) && <> {' '}<span className="kv-badge kv-badge--muted">{t.t('dairy.insights.chart.partial')}</span></>}
                    </th>
                    {ready.byShift.shifts.map((s) => (
                      <td key={s}>{litresText(b.byShift[s] ?? '0')}</td>
                    ))}
                    <td>
                      {litresText(b.totalMilli)}
                      {/* The bar is a meter, not a picture: a screen reader gets the number, a sighted reader gets
                          both, and no chart library ships to a village browser to draw it. */}
                      <span
                        className="kv-meter"
                        role="img"
                        aria-label={`${litresText(b.totalMilli)} ${t.t('dairy.litres')}`}
                        style={{ ['--kv-meter-pct' as string]: `${barPct(b.totalMilli, peakMilli(ready.byShift))}%` }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ---- what moved the rate ---- */}
          <h2>{t.t('dairy.insights.moved.title')}</h2>

          <div className="kv-card">
            <h3>{t.t('dairy.insights.premium.title')}</h3>
            <p>
              {t.t(premiumKey(ready.premium))}
              {ready.premium.current.kind === 'measured' && (
                <>
                  {' '}<strong>{formatNumber(ready.premium.current.qualifying, lang)}</strong>
                  {' / '}{formatNumber(ready.premium.current.pourers, lang)}
                </>
              )}
            </p>
            {/* The slab comes from the CARD. There is no 6.5 anywhere in this app. */}
            {ready.premium.current.kind !== 'no_slabs' && ready.premium.current.slabs.length > 0 && (
              <p className="kv-field__hint">
                {ready.premium.current.slabs.map((s) => `${t.t(slabMetricKey(s.metric))} ≥ ${slabText(s)}`).join(' · ')}
              </p>
            )}
            {ready.premium.comparable && ready.premium.previous.kind === 'measured' && (
              <p className="kv-field__hint">
                {t.t('dairy.insights.premium.was')} {formatNumber(ready.premium.previous.qualifying, lang)}
                {ready.premium.change && <> {' '}{change(ready.premium.change)}</>}
              </p>
            )}
            {premiumIncomparableKey(ready.premium) && (
              <p className="kv-field__hint">{t.t(premiumIncomparableKey(ready.premium)!)}</p>
            )}
            {/* The premium actually PAID in the window — zero whenever the slabs are switched off, and the line above
                already says "would qualify" when they are. */}
            <p className="kv-field__hint">
              {t.t('dairy.insights.premium.paid')} {money(ready.bonusMinor)}
            </p>
          </div>

          <div className="kv-card">
            <h3>{t.t('dairy.insights.rateCard.title')}</h3>
            <p className="kv-field__hint">{t.t(RATE_CARD_NO_VERSION_KEY)}</p>
            {ready.rateCards.byAnimal.map((g) => (
              <div key={g.animalType}>
                <h4>{t.t(animalTypeKey(g.animalType))}</h4>
                <ul className="kv-list">
                  {g.cards.map((c) => (
                    <li key={c.id}>
                      {c.defaultName}
                      {' · '}{t.t(pricingModelKey(c.pricingModel))}
                      {' · '}{t.t('dairy.insights.rateCard.effective')} {formatDate(c.effectiveFrom, lang)}
                      {g.effectiveId === c.id && <> {' '}<span className="kv-badge">{t.t('dairy.insights.rateCard.pricingNow')}</span></>}
                    </li>
                  ))}
                </ul>
                {/* 6b-2's finding, restated where it changes what a manager believes about their own prices. */}
                {g.ambiguous && <p className="kv-badge kv-badge--danger">{t.t('dairy.insights.rateCard.ambiguous')}</p>}
              </div>
            ))}
          </div>

          {/* THE SECOND REFUSAL. 6d-2's verdict, in 6d-2's words. */}
          <div className="kv-card kv-card--notice">
            <h3>{t.t('dairy.insights.spoilage.title')}</h3>
            <p>{t.t(SPOILAGE_KEY)}</p>
            <ul className="kv-list">{ready.spoilage.needs.map((n) => <li key={n}><code>{n}</code></li>)}</ul>
          </div>

          {/* W172's restricted state, as a footer rather than a wall: the aggregate is readable, one member's record
              is a different decision (0128). */}
          <p className="kv-field__hint">
            {t.t(ready.memberDrillDown ? 'dairy.insights.drillDown.allowed' : 'dairy.insights.drillDown.restricted')}
          </p>

          {/* The canon's own footnote, kept because it is true and because it is the reason this page has no rollup. */}
          <p className="kv-field__hint">{t.t('dairy.insights.derivedFootnote')}</p>
        </>
      )}
    </section>
  );
}
