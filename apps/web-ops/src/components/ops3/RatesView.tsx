// apps/web-ops/src/components/ops3/RatesView.tsx · PC-56 OPS-3c · W368 THE PRICE — A READ OF THE APPROVED MILK RATE CARDS, presentational.
//
// What `GET /v1/dairy/rate-cards?activeOnly=true` answered (approved and active since HOTFIX-12), filtered again so a card awaiting a second
// person is never shown as one that prices. Per milk type, each card: its own name, milk type and pricing model in words, the fat rate "per kg
// of fat", the SNF rate "per kg of SNF" and the base rate "per kg of milk" (founder Q8-A) — each the server's minor string through the money
// formatter —, the days it covers (the server's dates; no "today" is computed), its approval state, its premium slabs; whether slabs are paid.
// Two approved cards of one milk type covering one day are raised as an ERROR. Above them, the change sentence (founder Q1-A: this console only
// reads) with ONLY the HOTFIX-12 clauses the code proves; below, the rule in WORDS — never a sum, never a worked example, never a ready-reckoner
// (E3). NO input, NO change button, NO member (Q10-A), NO role claim (Q14-A). "Print counter poster" is DECOR → W3338 (Q15-A). Every refused
// canon line is printed BY NAME (`Ops3Refusals`).
import Link from 'next/link';
// PC-56 RTL-1e: the console's money text (features/rtl/money.ts `moneyText`) — the Indian shape, isolated, under Arabic; byte-identical under
// en/hi/gu. Bound to the name `formatMoneyMinor` here so this view's call reads as before (its pinned OPS spec).
import { moneyText as formatMoneyMinor } from '../../features/rtl/money';
import type { DairyRateCard } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops3/refusals';
import { RATES_PAGE, approvedCards, byMilkType, centiPctText, isMinorString, overlaps, type RatesState, type SlabsPaid } from '../../features/ops3/rates';
import { Ops3Refusals } from './Ops3Chain';

export interface RatesViewProps { t: Tr; lang: string; state: RatesState; cards: readonly DairyRateCard[]; slabs: SlabsPaid }

const STATEMENTS = ['ops3.rates.notHere', 'ops3.rates.secondPerson', 'ops3.rates.tomorrow', 'ops3.rates.recorded', 'ops3.rates.oneInForce', 'ops3.rates.told'] as const;

export function RatesStatement({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="rates">
      <h2 className="kv-card__title">{t.t('ops3.rates.statementTitle')}</h2>
      {STATEMENTS.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
    </div>
  );
}

function RateLine({ t, lang, axis, minor }: { t: Tr; lang: string; axis: 'fat' | 'snf' | 'base'; minor: string | null }) {
  return (
    <div className="kv-facts__row" data-kv-rate-row={axis}>
      <dt>{t.t(`ops3.rates.rate.${axis}`)}</dt>
      <dd>{isMinorString(minor)
        ? <><span data-kv-rate={axis} data-kv-minor={minor}>{formatMoneyMinor(minor, 'INR', lang)}</span> <span className="kv-muted">{t.t(`ops3.rates.per.${axis}`)}</span></>
        : <span data-kv-rate={axis} data-kv-minor="none">{t.t(axis === 'base' ? 'ops3.rates.noBase' : 'ops3.rates.notOnFile')}</span>}</dd>
    </div>
  );
}

function CardFacts({ t, lang, card }: { t: Tr; lang: string; card: DairyRateCard }) {
  const fat = card.pricingModel === 'two_axis' || card.pricingModel === 'fat_pooled';
  const snf = card.pricingModel === 'two_axis' || card.pricingModel === 'snf_pooled';
  const slabs = card.bonusSlabs ?? [];
  return (
    <article className="kv-card" data-kv-card={card.id} data-kv-approval={card.approvalState}>
      <h3 className="kv-card__title" data-kv-cell="name">{card.defaultName}</h3>
      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ops3.rates.milkType')}</dt><dd>{t.t(`ops3.rates.animal.${card.animalType}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.rates.model')}</dt><dd data-kv-model={card.pricingModel}>{t.t(`ops3.rates.model.${card.pricingModel}`)}</dd></div>
        {fat ? <RateLine t={t} lang={lang} axis="fat" minor={card.ratePerKgFatMinor} /> : null}
        {snf ? <RateLine t={t} lang={lang} axis="snf" minor={card.ratePerKgSnfMinor} /> : null}
        <RateLine t={t} lang={lang} axis="base" minor={card.baseRatePerLitreMinor} />
        <div className="kv-facts__row"><dt>{t.t('ops3.rates.covers')}</dt>
          <dd data-kv-days={`${card.effectiveFrom}|${card.effectiveTo ?? ''}`}>{card.effectiveTo
            ? t.t('ops3.rates.coversRange', { from: card.effectiveFrom, to: card.effectiveTo })
            : t.t('ops3.rates.coversOpen', { from: card.effectiveFrom })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.rates.approval')}</dt><dd>{t.t(`ops3.rates.approval.${card.approvalState}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.rates.slabs')}</dt>
          <dd>{slabs.length === 0 ? <span data-kv-slabs="none">{t.t('ops3.rates.noSlabs')}</span> : (
            <ul data-kv-slabs={slabs.length}>
              {slabs.map((s) => (
                <li key={`${s.metric}:${s.minCentiPct}`} data-kv-slab={`${s.metric}:${s.minCentiPct}`}>
                  {t.t(`ops3.rates.slab.${s.metric}`, { pct: centiPctText(s.minCentiPct) })} <span data-kv-rate="slab" data-kv-minor={String(s.bonusMinorPerLitre)}>{formatMoneyMinor(String(s.bonusMinorPerLitre), 'INR', lang)}</span> {t.t('ops3.rates.per.base')}
                </li>
              ))}
            </ul>
          )}</dd></div>
      </dl>
    </article>
  );
}

function Rule({ t, cards }: { t: Tr; cards: readonly DairyRateCard[] }) {
  const models = Array.from(new Set(cards.map((c) => c.pricingModel)));
  const base = cards.some((c) => isMinorString(c.baseRatePerLitreMinor));
  const slabs = cards.some((c) => (c.bonusSlabs ?? []).length > 0);
  return (
    <div className="kv-card" data-kv-rule="rates">
      <h2 className="kv-card__title">{t.t('ops3.rates.ruleTitle')}</h2>
      <p className="kv-statement" data-kv-statement="ops3.rates.pricedBy">{t.t('ops3.rates.pricedBy')}</p>
      <p className="kv-statement" data-kv-statement="ops3.rates.neverRepriced">{t.t('ops3.rates.neverRepriced')}</p>
      {models.map((m) => <p key={m} data-kv-rule-line={m}>{t.t(`ops3.rates.rule.${m}`)}</p>)}
      {base ? <p data-kv-rule-line="base">{t.t('ops3.rates.rule.base')}</p> : null}
      {slabs ? <p data-kv-rule-line="slabs">{t.t('ops3.rates.rule.slabs')}</p> : null}
      <p className="kv-statement" data-kv-statement="ops3.rates.noActive">{t.t('ops3.rates.noActive')}</p>
    </div>
  );
}

export function RatesView({ t, lang, state, cards, slabs }: RatesViewProps) {
  if (state === 'off') {
    return (
      <section data-kv-ops3="rates" data-kv-state="off">
        <h1>{t.t('ops3.rates.title')}</h1>
        <div className="kv-card" data-kv-off="dairy"><h2 className="kv-card__title">{t.t('ops3.rates.off.title')}</h2><p>{t.t('ops3.rates.off.body')}</p></div>
        <Ops3Refusals t={t} surface="rates" />
      </section>
    );
  }
  const approved = approvedCards(cards);
  const clashes = overlaps(approved);
  const anySlabs = approved.some((c) => (c.bonusSlabs ?? []).length > 0);
  return (
    <section data-kv-ops3="rates" data-kv-state={state}>
      <h1>{t.t('ops3.rates.title')}</h1>
      <p className="kv-muted">{t.t('ops3.rates.lead')}</p>
      <RatesStatement t={t} />

      {state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="rates">
          <h2 className="kv-card__title">{t.t('ops3.rates.error.title')}</h2>
          <p>{t.t('ops3.rates.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${RATES_PAGE}?act=confirm`} data-kv-chain-link="retry">{t.t('ops3.rates.error.retry')}</Link></p>
        </div>
      ) : state === 'none' || approved.length === 0 ? (
        <div className="kv-empty-state" data-kv-empty="rates"><h2>{t.t('ops3.rates.none.title')}</h2><p>{t.t('ops3.rates.noActive')}</p></div>
      ) : (
        <>
          {clashes.map((c) => (
            <div key={`${c.a.id}|${c.b.id}`} className="kv-card" role="alert" data-kv-error="overlap" data-kv-overlap={`${c.a.id}|${c.b.id}`}>
              <h2 className="kv-card__title">{t.t('ops3.rates.overlap.title')}</h2>
              <p>{t.t('ops3.rates.overlap.body', { milkType: t.t(`ops3.rates.animal.${c.animalType}`), a: c.a.defaultName, b: c.b.defaultName })}</p>
            </div>
          ))}
          <p className="kv-muted" data-kv-note="server-values">{t.t('ops3.rates.serverValues')}</p>
          {byMilkType(approved).map((g) => (
            <section key={g.animalType} data-kv-milk-type={g.animalType} aria-labelledby={`kv-mt-${g.animalType}`}>
              <h2 id={`kv-mt-${g.animalType}`}>{t.t(`ops3.rates.animal.${g.animalType}`)}</h2>
              {g.cards.map((c) => <CardFacts key={c.id} t={t} lang={lang} card={c} />)}
            </section>
          ))}
          <p className="kv-statement" data-kv-slabs-paid={anySlabs ? slabs : 'no_slabs'}>{t.t(anySlabs ? `ops3.rates.slabsPaid.${slabs}` : 'ops3.rates.slabsPaid.no_slabs')}</p>
          <Rule t={t} cards={approved} />
        </>
      )}

      <p className="kv-pager" data-kv-acts="rates">
        <Link className="kv-btn kv-btn--muted" href={`${RATES_PAGE}?export=queued`} data-kv-decor="poster">{t.t('ops3.rates.posterAct')}</Link>
      </p>
      <Ops3Refusals t={t} surface="rates" />
    </section>
  );
}
