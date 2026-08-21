// apps/web-tenant/src/app/dairy/quality/page.tsx · W168 (Milk quality desk) — PC-56 TENANT-6b-2.
// Server-first, requireSession-gated, noindex. A pure read: the cycle rides in the URL, so a dairy secretary can
// bookmark last fortnight and the Back button works.
//
// **W168 IS LINKED FROM NOWHERE IN THE CANON.** `grep -rl W168-tenant-dairy-quality` across all 1,955 screens returns
// ZERO hits — not an operational screen, not a breadcrumb, not even its own chain states — while W167 is linked from
// every dairy screen's breadcrumb. Third instance of this defect (W241 and W244 were 5c's and 5d's), and the fix is the
// same: the dairy sub-nav's `quality` entry, unbuilt since TENANT-6a, now points here, and the counter board links it.
//
// WHAT THIS PAGE SAYS THAT W168 CANNOT:
//   • **"rate cards are owner + checker" is not true.** There is no second approver anywhere on the rate-card path: one
//     `dairy.manage` holder can change what every member of the cooperative is paid, alone, in one call. The platform
//     HAS the maker-checker pattern (TENANT-4b built it for payouts, migration 0143); the dairy rate card never used it.
//   • **"v3 archived, history kept" is half true.** History IS kept — the old row persists and every pour records the
//     `rate_card_id` that priced it. Nothing ARCHIVES anything: `MilkRateCardService` is create-only, so nothing closes
//     a superseded card's `effective_to` and TWO cards can be in force at once, with the pricing path silently taking
//     whichever starts later. When that happens this page says which one is winning.
//   • **"stable ±0.1 across 13 days" is measured, not asserted** — from the daily litre-weighted averages, with the day
//     count beside it, and refused outright under two days because there is no spread to report.
//   • **"Premium band pourers 184 / 312 · fat ≥ 6.5 EARNS the bonus slab"** reads as `would qualify` while the tenant's
//     slabs are switched off, because nothing was paid. TENANT-6b-1 made the engine capable of paying it; whether it
//     does is a treasury decision, and the tile must not blur the two.
//   • **the third protocol step is not modelled.** A dairy committee is a governance body with no representation here,
//     and the platform risk desk is admin-api by Law 11. The desk reports a committee review as OWED, never as done.
//
// And the one W168 promise that IS true end to end, because 6b-1 made it so: the flagged pour's payment is held, the
// member's other pours pay normally, and no wallet is touched.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyQualityDesk } from '@krishalaya/sdk-js';
import {
  RATE_CARDS_HREF, animalTypeKey, cardAmbiguityKey, cardCheckerKey, cardEffectiveKey, cardSupersedeKey,
  committeeKey, densityKey, emptyKey, exampleBasisKey, exampleLines, exampleWithheldBonusKey, flagCodeIsCurrentKey, flagTitleParts,
  flagsClaimKey, flagsTone, holdKey, holdTone, memberLabel, memberPresentKey, nextActKey, premiumBandKey,
  premiumBandPairText, premiumBandShareText, pricingModelKey, protocolStepKey, protocolStepTone, qualityState,
  qualityStateKey, reasonKey, reasonOrder, reviewFlagsCountText, sealedKey, slabText, slabsNotAppliedKey,
  spreadText, stabilityKey, stabilityToleranceText, stabilityTone,
} from '../../../features/dairy/quality';
import { DAIRY_NAV, dairyNavLabelKey, dairyUnbuiltCount } from '../../../features/dairy/nav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.quality.title'), robots: { index: false, follow: false } };
}

const TONE: Record<'ok' | 'bad' | 'muted', string> = {
  ok: 'kv-badge', bad: 'kv-badge kv-badge--danger', muted: 'kv-badge kv-badge--muted',
};

export default async function DairyQualityPage({ searchParams }: { searchParams: { day?: string; cycle?: string } }) {
  await requireSession('/dairy/quality');
  const t = getTranslator();
  const lang = getLang();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day : undefined;
  const cycle = ['daily', 'weekly', 'fortnightly', 'monthly'].includes(searchParams.cycle ?? '')
    ? (searchParams.cycle as 'daily' | 'weekly' | 'fortnightly' | 'monthly') : undefined;

  let desk: DairyQualityDesk | null = null;
  let state = 'ok' as ReturnType<typeof qualityState>;
  try {
    desk = await tenantClient().dairy.qualityDesk({ day, cycle });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = qualityState(err?.code ?? 'generic', err?.status);
  }

  const money = (m: string) => formatMoneyMinor(m, desk?.currencyCode ?? 'INR', lang);
  const retryHref = `/dairy/quality${day ? `?day=${day}` : ''}`;

  return (
    <section>
      <h1>{t.t('dairy.quality.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.quality.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('dairy.nav.label')}>
        {DAIRY_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'quality' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'quality' ? 'page' : undefined}>
            {t.t(dairyNavLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(dairyNavLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('dairy.nav.unbuilt')} {formatNumber(dairyUnbuiltCount(), lang)}</p>

      {state !== 'ok' || !desk ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(qualityStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W168's own error copy: the analyzers keep working and nothing is lost. */}
              <p className="kv-field__hint">{t.t('dairy.quality.buffersAtMcc')}</p>
              <p><Link href={retryHref} className="kv-btn--link">{t.t('dairy.retry')}</Link></p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* ---- the header actions the canon draws as decor, pointed at what exists ---- */}
          <p className="kv-field__hint">
            <Link href={RATE_CARDS_HREF} className="kv-btn--link">{t.t('dairy.quality.action.rateCards')}</Link>
            {' · '}
            <Link href="#flags" className="kv-btn--link">
              {t.t('dairy.quality.action.reviewFlags')}
              {reviewFlagsCountText(desk.flags.openCount) && <> ({formatNumber(desk.flags.openCount, lang)})</>}
            </Link>
          </p>

          <p className="kv-field__hint">
            {t.t(`dairy.window.${desk.window.cycle}`)} {formatDate(desk.window.from, lang)} – {formatDate(desk.window.to, lang)}
            {' · '}{t.t('dairy.window.derived')}
          </p>

          {/* ---- the four tiles ---- */}
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.quality.tile.fat')}</span>
              <strong className="kv-stat__value">{desk.cycle.fatPct ?? t.t('common.dash')}</strong>
              <span className="kv-field__hint">
                {desk.animalMix.length > 0
                  ? desk.animalMix.map((a) => t.t(animalTypeKey(a.animalType))).join(' · ')
                  : t.t('dairy.quality.tile.noHerd')}
              </span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.quality.tile.snf')}</span>
              <strong className="kv-stat__value">{desk.cycle.snfPct ?? t.t('common.dash')}</strong>
              <span className={TONE[stabilityTone(desk.cycle.stability)]}>{t.t(stabilityKey(desk.cycle.stability))}</span>
              {desk.cycle.stability.kind === 'measured' && (
                <span className="kv-field__hint">
                  {stabilityToleranceText(desk.cycle.stability)}
                  {' · '}{t.t('dairy.quality.stability.spread')} {spreadText(desk.cycle.stability.fatSpreadCentiPct)} / {spreadText(desk.cycle.stability.snfSpreadCentiPct)}
                  {' · '}{formatNumber(desk.cycle.stability.days, lang)} {t.t('dairy.quality.stability.days')}
                </span>
              )}
              {desk.cycle.stability.kind === 'insufficient_days' && (
                <span className="kv-field__hint">{formatNumber(desk.cycle.stability.days, lang)} / {formatNumber(desk.cycle.stability.needed, lang)}</span>
              )}
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.quality.tile.flags')}</span>
              <strong className="kv-stat__value">{formatNumber(desk.flags.total, lang)}</strong>
              <span className={TONE[flagsTone(desk.flags)]}>{t.t(flagsClaimKey(desk.flags))}</span>
              {reasonOrder(Object.keys(desk.flags.byReason)).length > 0 && (
                <span className="kv-field__hint">
                  {reasonOrder(Object.keys(desk.flags.byReason))
                    .map((k) => `${formatNumber(desk.flags.byReason[k] ?? 0, lang)} ${t.t(reasonKey(k))}`).join(' · ')}
                </span>
              )}
              {desk.flags.withheldMinor !== '0' && (
                <span className="kv-field__hint">{t.t('dairy.quality.flags.withheld')} {money(desk.flags.withheldMinor)}</span>
              )}
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('dairy.quality.tile.premium')}</span>
              <strong className="kv-stat__value">{premiumBandPairText(desk.premiumBand) ?? t.t('common.dash')}</strong>
              <span className="kv-field__hint">
                {t.t(premiumBandKey(desk.premiumBand))}
                {premiumBandShareText(desk.premiumBand) && <> · {premiumBandShareText(desk.premiumBand)}</>}
              </span>
              {desk.premiumBand.kind === 'measured' && (
                <span className="kv-field__hint">{desk.premiumBand.slabs.map((s) => slabText(s)).join(' · ')}</span>
              )}
              {slabsNotAppliedKey(desk.slabsApplied, desk.premiumBand) && (
                <span className="kv-badge kv-badge--danger">{t.t(slabsNotAppliedKey(desk.slabsApplied, desk.premiumBand)!)}</span>
              )}
            </div>
          </div>

          {/* ---- the open flags, and W168's protocol ---- */}
          <h2 id="flags">{t.t('dairy.quality.flags.heading')}</h2>
          {emptyKey(desk.flags.total, desk.flags.openCount) ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(emptyKey(desk.flags.total, desk.flags.openCount)!)}</p>
              <p><Link href="/dairy" className="kv-btn--link">{t.t('dairy.quality.viewCollections')}</Link></p>
            </div>
          ) : (
            <DataTable
              rows={desk.openFlags}
              empty={t.t('dairy.quality.empty.noneOpen')}
              columns={[
                {
                  header: t.t('dairy.quality.col.flag'),
                  cell: (f) => (
                    <>
                      <strong>{flagTitleParts(f).mcc ?? t.t('common.dash')}</strong>{' '}
                      <span className="kv-field__hint">{t.t(flagTitleParts(f).shiftKey)} · {formatDate(f.collectedOn, lang)}</span>
                      {/* [TENANT-6d-3] The card is resolved as of the pour; this says so when it could not be. */}
                      {flagCodeIsCurrentKey(f) && <span className="kv-field__hint"> · {t.t(flagCodeIsCurrentKey(f)!)}</span>}
                      <br />
                      {/* W168 masks the member on a screen about somebody's honesty. The API never sends the whole code. */}
                      {memberLabel(f).text
                        ? <span className="kv-mono">{memberLabel(f).text}</span>
                        : <span className="kv-field__hint">{t.t(memberLabel(f).key!)}</span>}
                    </>
                  ),
                },
                {
                  header: t.t('dairy.quality.col.evidence'),
                  cell: (f) => (
                    <>
                      {reasonOrder(f.reasons.concat(f.waterFlag ? ['water_flag'] : []))
                        .map((k) => <span key={k} className="kv-badge kv-badge--danger">{t.t(reasonKey(k))}</span>)}
                      <br />
                      <span className="kv-field__hint">
                        {t.t(densityKey(f))}{f.densityAtFlag && <> {f.densityAtFlag}</>}
                        {f.fatPctAtFlag && <> · {t.t('dairy.quality.metric.fat')} {f.fatPctAtFlag}</>}
                        {f.snfPctAtFlag && <> · {t.t('dairy.quality.metric.snf')} {f.snfPctAtFlag}</>}
                      </span>
                    </>
                  ),
                },
                {
                  header: t.t('dairy.quality.col.money'),
                  cell: (f) => (
                    <>
                      <strong>{money(f.amountWithheldMinor)}</strong>{' '}
                      <span className={TONE[holdTone(f)]}>{t.t(holdKey(f))}</span>
                    </>
                  ),
                },
                {
                  header: t.t('dairy.quality.col.protocol'),
                  cell: (f) => (
                    <>
                      <span className="kv-field__hint">{t.t(sealedKey(f))}</span>
                      {memberPresentKey(f) && <><br /><span className="kv-field__hint">{t.t(memberPresentKey(f)!)}</span></>}
                      <br /><strong>{t.t(nextActKey(f))}</strong>
                      {committeeKey(f) && (
                        <><br /><span className="kv-badge kv-badge--danger">
                          {t.t(committeeKey(f)!)} {formatNumber(f.priorReviews90d + 1, lang)}
                        </span></>
                      )}
                    </>
                  ),
                },
              ]}
            />
          )}

          {/* ---- W168's three steps, and which of them this platform can witness ---- */}
          <ol className="kv-steps">
            {(['retest', 'decision', 'committee'] as const).map((step) => (
              <li key={step}>
                <span className={TONE[protocolStepTone(step, desk!.protocol)]}>{t.t(protocolStepKey(step, desk!.protocol))}</span>
              </li>
            ))}
          </ol>
          <p className="kv-field__hint">{t.t('dairy.quality.protocol.holdOnly')}</p>

          {/* ---- the rate cards in force (plural, deliberately) ---- */}
          <h2>{t.t('dairy.quality.card.heading')}</h2>
          {cardAmbiguityKey(desk.rateCards) && (
            <div className="kv-error" role="alert"><p>{t.t(cardAmbiguityKey(desk.rateCards)!)}</p></div>
          )}
          {desk.rateCards.byAnimal.length === 0 ? (
            <p className="kv-field__hint">{t.t('dairy.quality.card.none')}</p>
          ) : desk.rateCards.byAnimal.map((g) => (
            <div key={g.animalType} className="kv-card">
              <h3>{t.t(animalTypeKey(g.animalType))}</h3>
              {g.cards.map((c) => (
                <div key={c.id}>
                  <p>
                    <strong>{c.defaultName}</strong> · {t.t(pricingModelKey(c.pricingModel))}
                    {cardEffectiveKey(c.id, g.effectiveId) && (
                      <> <span className={c.id === g.effectiveId ? 'kv-badge' : 'kv-badge kv-badge--danger'}>
                        {t.t(cardEffectiveKey(c.id, g.effectiveId)!)}
                      </span></>
                    )}
                  </p>
                  <p className="kv-field__hint">
                    {c.ratePerKgFatMinor && <>{t.t('dairy.rate.fat')} {money(c.ratePerKgFatMinor)} </>}
                    {c.ratePerKgSnfMinor && <>· {t.t('dairy.rate.snf')} {money(c.ratePerKgSnfMinor)} </>}
                    {c.baseRatePerLitreMinor && <>· {t.t('dairy.rate.base')} {money(c.baseRatePerLitreMinor)} </>}
                  </p>
                  <p className="kv-field__hint">
                    {c.slabs.length === 0
                      ? t.t('dairy.quality.card.noSlabs')
                      : <>{t.t('dairy.rate.bonusSlab')} {c.slabs.map((s) => `${slabText(s)} → ${money(String(s.bonusMinorPerLitre))}/L`).join(' · ')}</>}
                  </p>
                  <p className="kv-field__hint">
                    {t.t('dairy.rate.from')} {formatDate(c.effectiveFrom, lang)}
                    {c.effectiveTo ? <> – {formatDate(c.effectiveTo, lang)}</> : <> · {t.t('dairy.quality.card.openEnded')}</>}
                  </p>
                </div>
              ))}
            </div>
          ))}
          {/* The two claims the canon makes about a rate card's lifecycle that this platform does not support. */}
          <p className="kv-field__hint">{t.t(cardSupersedeKey(desk.rateCards))}</p>
          <p className="kv-field__hint">{t.t(cardCheckerKey(desk.rateCards))}</p>

          {/* ---- the arithmetic W168 promises the farmer, line by line ---- */}
          {desk.example && (
            <>
              <h2>{t.t('dairy.quality.example.heading')}</h2>
              <p className="kv-field__hint">
                {desk.example.litres} {t.t('dairy.litres')} · {t.t('dairy.quality.metric.fat')} {desk.example.fatPct}
                {' · '}{t.t('dairy.quality.metric.snf')} {desk.example.snfPct}
                {' · '}{t.t(exampleBasisKey(desk.example))}
              </p>
              <DataTable
                rows={exampleLines(desk.example)}
                empty={t.t('dairy.quality.example.nothingCharged')}
                columns={[
                  { header: t.t('dairy.quality.example.line'), cell: (l) => t.t(l.key) },
                  { header: t.t('dairy.quality.example.qty'), cell: (l) => l.qty ?? t.t('common.dash') },
                  { header: t.t('dairy.quality.example.amount'), cell: (l) => money(l.amountMinor) },
                ]}
              />
              <p><strong>{t.t('dairy.quality.example.total')} {money(desk.example.totalMinor)}</strong></p>
              {exampleWithheldBonusKey(desk.example) && (
                <p className="kv-field__hint">
                  {t.t(exampleWithheldBonusKey(desk.example)!)} {money(desk.example.bonusMinor)}
                </p>
              )}
            </>
          )}

          {/* ---- the one promise on this screen that IS kept end to end ---- */}
          <p className="kv-field__hint">{t.t('dairy.quality.quarantinePour')}</p>
        </>
      )}
    </section>
  );
}
