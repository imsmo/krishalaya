// apps/web-ops/src/components/ops3/CounterViews.tsx · PC-56 OPS-3a · THE COUNTER (W360–W365), presentational.
//
// Founder 2026-11-08 (`05_OPS.md` "OPS-3 SPLIT"): Q2-A (pours recorded on the web console, the numbers said plainly to be typed by a person and
// to be what her pay is computed from) · Q3-A ("Record this pour"; she can check this pour in her milk diary and object to her bill in its
// window) · Q4-A (a recorded pour cannot be corrected here) · Q5-A (no future day, no day already billed; today by default) · Q9-A (the shift's
// totals labelled, the cooler's last stated level beside them, no variance, "Close shift" refused) · Q9b-A (one pour per member per shift) ·
// Q10-A (member codes only) · Q11-A (no slip claims; "What was recorded") · Q14-A ("signed in as you").
//
// NO MONEY MATH (E3): every amount is a server minor string through the money formatter, never added, split or divided here. NO member name,
// photo or phone anywhere (the roll carries none). Every refused canon line is printed BY NAME (`Ops3Refusals`).
import Link from 'next/link';
// PC-56 RTL-1e: the console's money text (features/rtl/money.ts `moneyText`) — the Indian shape, isolated, under Arabic; byte-identical under
// en/hi/gu. Bound to the name `formatMoneyMinor` here so this view's call reads as before (its pinned OPS spec).
import { moneyText as formatMoneyMinor } from '../../features/rtl/money';
import type { DairyBmcTile, DairyDaySummaryRow, DairyMcc, DairyMembership, DairyRateCard } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops3/refusals';
import {
  POS, POUR_FLAGS, POUR_SHIFTS, isMinor, memberValue, recordedAtText, rowFor, shiftHours,
  type CounterState, type PourReason, type PourShift, type PourValue, type RecordedPour,
} from '../../features/ops3/counter';
import { Ops3Refusals } from './Ops3Chain';

const money = (minor: string | undefined, lang: string) => (isMinor(minor) ? formatMoneyMinor(minor, 'INR', lang) : null);

/** The counter's chrome: the centre's own code and name, and "signed in as you" (Q14-A) — never a name from the canon, never a role. */
export function CounterChrome({ t, centre }: { t: Tr; centre: DairyMcc | null }) {
  return (
    <p className="kv-muted" data-kv-chrome="pos">
      {centre ? <span data-kv-centre={centre.id}>{t.t('ops3.pos.centre', { code: centre.code, name: centre.defaultName })}</span> : null}
      {centre ? ' · ' : null}<span data-kv-signed-in="you">{t.t('ops3.pos.signedIn')}</span>
    </p>
  );
}

/** The four states a counter page has before it can show anything of its own. */
export function CounterStateView({ t, state, page }: { t: Tr; state: Exclude<CounterState, 'ok'>; page: string }) {
  return (
    <div className="kv-card" data-kv-state={state} role={state === 'error' ? 'alert' : 'status'}>
      <h2 className="kv-card__title">{t.t(`ops3.pos.state.${state}.title`)}</h2>
      <p>{t.t(`ops3.pos.state.${state}.body`)}</p>
      {state === 'error' ? <p className="kv-pager"><Link className="kv-btn" href={page} data-kv-retry="reread">{t.t('ops3.pos.retry')}</Link></p> : null}
    </div>
  );
}

/** Several centres in custody: pick one by a LINK (no input) — `?mcc=`. */
export function CentrePicker({ t, centres, page }: { t: Tr; centres: readonly DairyMcc[]; page: string }) {
  return (
    <div className="kv-card" data-kv-state="pick">
      <h2 className="kv-card__title">{t.t('ops3.pos.pick.title')}</h2>
      <ul>{centres.map((c) => <li key={c.id}><Link href={`${page}?mcc=${c.id}`} data-kv-pick={c.id}>{t.t('ops3.pos.centre', { code: c.code, name: c.defaultName })}</Link></li>)}</ul>
    </div>
  );
}

function Hours({ t, centre, shift }: { t: Tr; centre: DairyMcc; shift: PourShift }) {
  const h = shiftHours(centre, shift);
  return <span data-kv-hours={shift}>{h ? t.t('ops3.pos.hours', { opens: h.opens, closes: h.closes }) : t.t('ops3.pos.hoursNone')}</span>;
}

/** One shift's server totals, labelled (Q9-A) and split by hold state (OPS3-B15). Nothing is computed here. */
export function ShiftTotals({ t, lang, row, shift }: { t: Tr; lang: string; row: DairyDaySummaryRow | null; shift: PourShift }) {
  if (!row || row.slips === 0) return <p className="kv-muted" data-kv-empty={`shift-${shift}`}>{t.t('ops3.pos.noPours')}</p>;
  const split = [['payable', row.payableMinor], ['held', row.heldMinor], ['rejected', row.rejectedMinor]] as const;
  return (
    <dl className="kv-facts" data-kv-totals={shift}>
      <div className="kv-facts__row"><dt>{t.t('ops3.pos.pours')}</dt><dd data-kv-count="pours">{row.slips}</dd></div>
      <div className="kv-facts__row"><dt>{t.t('ops3.pos.kg')}</dt><dd data-kv-kg={row.weightKg}>{t.t('ops3.pos.kgValue', { kg: row.weightKg })}</dd></div>
      <div className="kv-facts__row"><dt>{t.t('ops3.pos.priced')}</dt>
        <dd><span data-kv-amount="all" data-kv-minor={row.amountMinor}>{money(row.amountMinor, lang) ?? t.t('ops3.pos.notRead')}</span>
          {' '}<span className="kv-muted" data-kv-caveat="held">{t.t('ops3.pos.pricedCaveat')}</span></dd></div>
      {split.map(([k, v]) => (
        <div key={k} className="kv-facts__row" data-kv-split-row={k}><dt>{t.t(`ops3.pos.split.${k}`)}</dt>
          <dd><span data-kv-amount={k} data-kv-minor={v ?? 'none'}>{money(v, lang) ?? t.t('ops3.pos.notRead')}</span></dd></div>
      ))}
      <div className="kv-facts__row"><dt>{t.t('ops3.pos.flagged')}</dt><dd data-kv-count="flagged">{row.flaggedPours ?? t.t('ops3.pos.notRead')}</dd></div>
    </dl>
  );
}

/* ═════════════════════════════ W360 · /pos/home ═════════════════════════════ */
export interface PosHomeProps { t: Tr; lang: string; state: CounterState; centre: DairyMcc | null; centres: readonly DairyMcc[]; today: string | null; rows: readonly DairyDaySummaryRow[] | null }
export function PosHomeView({ t, lang, state, centre, centres, today, rows }: PosHomeProps) {
  return (
    <section data-kv-page="pos_home">
      <h1>{t.t('ops3.pos.home.title')}</h1>
      <CounterChrome t={t} centre={centre} />
      <p className="kv-lead">{t.t('ops3.pos.home.lead')}</p>
      {state !== 'ok' ? <CounterStateView t={t} state={state} page={POS.home} /> : !centre ? <CentrePicker t={t} centres={centres} page={POS.home} /> : (
        <>
          <p data-kv-day={today ?? ''}>{t.t('ops3.pos.day', { day: today ?? '' })}</p>
          {rows === null ? <CounterStateView t={t} state="error" page={`${POS.home}?mcc=${centre.id}`} /> : POUR_SHIFTS.map((s) => (
            <article key={s} className="kv-card" data-kv-shift={s}>
              <h2 className="kv-card__title">{t.t(`ops3.pos.shift.${s}`)} · <Hours t={t} centre={centre} shift={s} /></h2>
              <ShiftTotals t={t} lang={lang} row={rowFor(rows, s)} shift={s} />
            </article>
          ))}
          <p className="kv-pager">
            <Link className="kv-btn" href={`${POS.collect}?mcc=${centre.id}`} data-kv-real="collect">{t.t('ops3.pos.home.collect')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href={`${POS.shift}?mcc=${centre.id}`} data-kv-link="shift">{t.t('ops3.pos.home.shift')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href={POS.exceptions} data-kv-link="exceptions">{t.t('ops3.pos.home.exceptions')}</Link>
          </p>
          <p className="kv-statement" data-kv-statement="ops3.pos.pricedOnce">{t.t('ops3.pos.pricedOnce')}</p>
        </>
      )}
      <Ops3Refusals t={t} surface="pos_home" />
    </section>
  );
}

/* ═════════════════════════════ W361 · /pos/collect ═════════════════════════════ */
export interface PosCollectProps {
  t: Tr; state: CounterState; centre: DairyMcc | null; centres: readonly DairyMcc[]; today: string | null;
  roll: readonly DairyMembership[] | null; code: string | null; nextCursor: string | null; error: PourReason | null;
}
export function PosCollectView({ t, state, centre, centres, today, roll, code, nextCursor, error }: PosCollectProps) {
  return (
    <section data-kv-page="pos_collect">
      <h1>{t.t('ops3.pos.collect.title')}</h1>
      <CounterChrome t={t} centre={centre} />
      {state !== 'ok' ? <CounterStateView t={t} state={state} page={POS.collect} /> : !centre ? <CentrePicker t={t} centres={centres} page={POS.collect} /> : (
        <>
          <p className="kv-statement" data-kv-statement="ops3.pos.typedHere">{t.t('ops3.pos.typedHere')}</p>
          {error ? <p className="kv-error" role="alert" data-kv-reason={error}>{t.t(`ops3.pos.reason.${error}`)}</p> : null}
          <form method="get" action={POS.collect} className="kv-inline-form" role="search" aria-label={t.t('ops3.pos.collect.search')}>
            <input type="hidden" name="mcc" value={centre.id} />
            <label htmlFor="pc-code" className="kv-field__label">{t.t('ops3.pos.collect.search')}</label>
            <input id="pc-code" name="code" className="kv-input" defaultValue={code ?? ''} maxLength={40} />
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops3.pos.collect.searchBtn')}</button>
          </form>
          <p className="kv-muted">{t.t('ops3.pos.collect.codesOnly')}</p>
          {roll === null ? <CounterStateView t={t} state="error" page={`${POS.collect}?mcc=${centre.id}`} /> : roll.length === 0
            ? <p className="kv-muted" data-kv-empty="roll">{t.t(code ? 'ops3.pos.collect.noMatch' : 'ops3.pos.collect.noMembers')}</p> : (
            <form method="get" action={POS.quality} className="kv-form" data-kv-form="pour">
              <input type="hidden" name="mcc" value={centre.id} />
              <label htmlFor="pc-member" className="kv-field__label">{t.t('ops3.pos.member')}</label>
              <select id="pc-member" name="member" className="kv-input" required defaultValue="">
                <option value="" disabled>{t.t('ops3.pos.memberChoose')}</option>
                {roll.map((m) => <option key={m.id} value={memberValue(m.id, m.memberCode)} data-kv-member={m.id}>{m.memberCode}</option>)}
              </select>
              <fieldset className="kv-fieldset">
                <legend className="kv-field__label">{t.t('ops3.pos.shiftLabel')}</legend>
                {POUR_SHIFTS.map((s, i) => <label key={s} className="kv-radio"><input type="radio" name="shift" value={s} defaultChecked={i === 0} /> {t.t(`ops3.pos.shift.${s}`)}</label>)}
              </fieldset>
              <label htmlFor="pc-date" className="kv-field__label">{t.t('ops3.pos.date')}</label>
              <input id="pc-date" name="collectedOn" type="date" className="kv-input" required defaultValue={today ?? ''} max={today ?? undefined} />
              <p className="kv-field__hint">{t.t('ops3.pos.dateHint')}</p>
              <label htmlFor="pc-weight" className="kv-field__label">{t.t('ops3.pos.weight')}</label>
              <input id="pc-weight" name="weightKg" className="kv-input" required inputMode="decimal" pattern="\d{1,5}(\.\d{1,3})?" />
              <label htmlFor="pc-fat" className="kv-field__label">{t.t('ops3.pos.fat')}</label>
              <input id="pc-fat" name="fatPct" className="kv-input" required inputMode="decimal" pattern="\d{1,2}(\.\d{1,2})?" />
              <label htmlFor="pc-snf" className="kv-field__label">{t.t('ops3.pos.snf')}</label>
              <input id="pc-snf" name="snfPct" className="kv-input" required inputMode="decimal" pattern="\d{1,2}(\.\d{1,2})?" />
              <fieldset className="kv-fieldset">
                <legend className="kv-field__label">{t.t('ops3.pos.flags')}</legend>
                <label className="kv-radio"><input type="checkbox" name="waterFlag" value="1" /> {t.t('ops3.pos.flag.waterSuspected')}</label>
                {POUR_FLAGS.map((f) => <label key={f} className="kv-radio"><input type="checkbox" name="adulteration" value={f} /> {t.t(`ops3.pos.flag.${f}`)}</label>)}
              </fieldset>
              <p className="kv-field__hint">{t.t('ops3.pos.flagHolds')}</p>
              <button type="submit" className="kv-btn">{t.t('ops3.pos.collect.check')}</button>
            </form>
          )}
          {nextCursor ? <p className="kv-pager"><Link href={`${POS.collect}?mcc=${centre.id}${code ? `&code=${encodeURIComponent(code)}` : ''}&cursor=${encodeURIComponent(nextCursor)}`} data-kv-next="roll">{t.t('ops3.pos.collect.next')}</Link></p> : null}
          <p className="kv-statement" data-kv-statement="ops3.pos.onePour">{t.t('ops3.pos.onePour')}</p>
        </>
      )}
      <Ops3Refusals t={t} surface="pos_collect" />
    </section>
  );
}

/* ═════════════════════════════ W362 · /pos/quality (the check step = W3335 confirm) ═════════════════════════════ */
export interface PosQualityProps {
  t: Tr; centre: DairyMcc; pour: PourValue; memberCode: string; milkType: string | null; idemKey: string;
  action: (fd: FormData) => Promise<void>; back: string;
}
export function PosQualityView({ t, centre, pour, memberCode, milkType, idemKey, action, back }: PosQualityProps) {
  const flags = [...(pour.waterFlag ? ['waterSuspected'] : []), ...(pour.adulterationFlags ?? [])];
  return (
    <section data-kv-page="pos_quality" className="kv-card kv-chain" data-kv-chain="pos_act" data-kv-chain-kind="REAL" data-kv-chain-state="confirm">
      <h1>{t.t('ops3.chain.posAct.confirm.title')}</h1>
      <CounterChrome t={t} centre={centre} />
      <p className="kv-statement" data-kv-statement="ops3.pos.typed">{t.t('ops3.pos.typed')}</p>
      <p className="kv-statement" data-kv-statement="ops3.pos.payFromThem">{t.t('ops3.pos.payFromThem')}</p>
      <dl className="kv-facts" data-kv-pour="echo">
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.member')}</dt><dd data-kv-member-code={memberCode}>{memberCode}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.shiftLabel')}</dt><dd>{t.t(`ops3.pos.shift.${pour.shift}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.date')}</dt><dd data-kv-date={pour.collectedOn}>{pour.collectedOn}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.weight')}</dt><dd data-kv-reading="weight">{t.t('ops3.pos.kgValue', { kg: pour.weightKg })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.fat')}</dt><dd data-kv-reading="fat">{t.t('ops3.pos.pctValue', { pct: pour.fatPct })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.snf')}</dt><dd data-kv-reading="snf">{t.t('ops3.pos.pctValue', { pct: pour.snfPct })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.flags')}</dt><dd data-kv-flags={flags.join(',')}>{flags.length ? flags.map((f) => t.t(`ops3.pos.flag.${f}`)).join(', ') : t.t('ops3.pos.noFlags')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.milkType')}</dt><dd>{milkType ? t.t(`ops3.rates.animal.${milkType}`) : t.t('ops3.pos.notRead')}</dd></div>
      </dl>
      <p className="kv-muted">{t.t('ops3.pos.pricedByServer')}</p>
      {flags.length ? <p className="kv-statement" data-kv-statement="ops3.pos.flagHolds">{t.t('ops3.pos.flagHolds')}</p> : null}
      <p className="kv-statement" data-kv-statement="ops3.pos.cannotCorrect">{t.t('ops3.pos.cannotCorrect')}</p>
      <p className="kv-statement" data-kv-statement="ops3.pos.diary">{t.t('ops3.pos.diary')}</p>
      <form action={action} className="kv-form" data-kv-form="record">
        <input type="hidden" name="key" value={idemKey} />
        <input type="hidden" name="mcc" value={centre.id} />
        <input type="hidden" name="member" value={memberValue(pour.membershipId, memberCode)} />
        <input type="hidden" name="shift" value={pour.shift} />
        <input type="hidden" name="collectedOn" value={pour.collectedOn} />
        <input type="hidden" name="weightKg" value={pour.weightKg} />
        <input type="hidden" name="fatPct" value={pour.fatPct} />
        <input type="hidden" name="snfPct" value={pour.snfPct} />
        {pour.waterFlag ? <input type="hidden" name="waterFlag" value="1" /> : null}
        {(pour.adulterationFlags ?? []).map((f) => <input key={f} type="hidden" name="adulteration" value={f} />)}
        <button type="submit" className="kv-btn" data-kv-real="record">{t.t('ops3.pos.recordBtn')}</button>
      </form>
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={back} data-kv-back={back}>{t.t('ops3.pos.backToForm')}</Link></p>
      <Ops3Refusals t={t} surface="pos_quality" />
    </section>
  );
}

/** W3337 failure: "Nothing was recorded" + the named reason (and the one-pour rule on a duplicate). */
export function PourFailure({ t, reason }: { t: Tr; reason: PourReason }) {
  return (
    <>
      <p className="kv-error" role="alert" data-kv-reason={reason}><strong>{t.t('ops3.pos.reasonLabel')}</strong> {t.t(`ops3.pos.reason.${reason}`)}</p>
      {reason === 'duplicate' ? <p className="kv-statement" data-kv-statement="ops3.pos.onePour">{t.t('ops3.pos.onePour')}</p> : null}
    </>
  );
}

/* ═════════════════════════════ W363 · /pos/slip ═════════════════════════════ */
export type SlipState = 'ok' | 'none';
export interface PosSlipProps { t: Tr; lang: string; state: SlipState; pour: RecordedPour | null; card: DairyRateCard | null; cardRead: boolean; centre: DairyMcc | null }
export function WhatWasRecorded({ t, lang, pour, card, cardRead }: { t: Tr; lang: string; pour: RecordedPour; card: DairyRateCard | null; cardRead: boolean }) {
  const at = recordedAtText(pour.createdAt);
  return (
    <article className="kv-card" data-kv-recorded={pour.id}>
      <h2 className="kv-card__title">{t.t('ops3.pos.slip.title')}</h2>
      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.member')}</dt><dd data-kv-member-code={pour.memberCode}>{pour.memberCode}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.date')}</dt><dd>{pour.collectedOn} · {t.t(`ops3.pos.shift.${pour.shift}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.weight')}</dt><dd data-kv-reading="weight">{t.t('ops3.pos.kgValue', { kg: pour.weightKg })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.fat')}</dt><dd data-kv-reading="fat">{t.t('ops3.pos.pctValue', { pct: pour.fatPct })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.snf')}</dt><dd data-kv-reading="snf">{t.t('ops3.pos.pctValue', { pct: pour.snfPct })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.slip.price')}</dt><dd><strong data-kv-amount="pour" data-kv-minor={pour.amountMinor}>{money(pour.amountMinor, lang)}</strong></dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.slip.card')}</dt><dd data-kv-card={pour.rateCardId}>{card
          ? t.t('ops3.pos.slip.cardValue', { name: card.defaultName, from: card.effectiveFrom })
          : t.t(cardRead ? 'ops3.pos.slip.cardGone' : 'ops3.pos.notRead')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.slip.hold')}</dt><dd data-kv-hold={pour.holdState}>{t.t(`ops3.pos.hold.${pour.holdState}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops3.pos.slip.at')}</dt><dd>{at ?? t.t('ops3.pos.notRead')}</dd></div>
      </dl>
      <p className="kv-statement" data-kv-statement="ops3.pos.slip.onPlatform">{t.t('ops3.pos.slip.onPlatform')}</p>
      <p className="kv-statement" data-kv-statement="ops3.pos.diary">{t.t('ops3.pos.diary')}</p>
      <p className="kv-statement" data-kv-statement="ops3.pos.cannotCorrect">{t.t('ops3.pos.cannotCorrect')}</p>
    </article>
  );
}
export function PosSlipView({ t, lang, state, pour, card, cardRead, centre }: PosSlipProps) {
  return (
    <section data-kv-page="pos_slip">
      <h1>{t.t('ops3.pos.slip.title')}</h1>
      <CounterChrome t={t} centre={centre} />
      {state === 'none' || !pour ? (
        <div className="kv-card" data-kv-state="none" role="status">
          <h2 className="kv-card__title">{t.t('ops3.pos.slip.none.title')}</h2>
          <p>{t.t('ops3.pos.slip.none.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={POS.collect} data-kv-link="collect">{t.t('ops3.pos.home.collect')}</Link></p>
        </div>
      ) : (
        <>
          <WhatWasRecorded t={t} lang={lang} pour={pour} card={card} cardRead={cardRead} />
          {!cardRead ? <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={POS.slip} data-kv-retry="reread">{t.t('ops3.pos.retry')}</Link></p> : null}
          <p className="kv-pager"><Link className="kv-btn" href={`${POS.collect}?mcc=${pour.mccId}`} data-kv-link="collect">{t.t('ops3.pos.slip.next')}</Link></p>
        </>
      )}
      <Ops3Refusals t={t} surface="pos_slip" />
    </section>
  );
}

/* ═════════════════════════════ W364 · /pos/exceptions — HONEST, reads nothing ═════════════════════════════ */
const CANNOT = ['ops3.pos.cannotCorrect', 'ops3.pos.onePour', 'ops3.pos.ex.oneTyper', 'ops3.pos.ex.noSlip', 'ops3.pos.ex.noCash'] as const;
const CAN = ['ops3.pos.diary', 'ops3.pos.flagHolds', 'ops3.pos.ex.rejected', 'ops3.pos.ex.earlier'] as const;
export function PosExceptionsView({ t }: { t: Tr }) {
  return (
    <section data-kv-page="pos_exceptions">
      <h1>{t.t('ops3.pos.ex.title')}</h1>
      <p className="kv-lead">{t.t('ops3.pos.ex.lead')}</p>
      <div className="kv-card" data-kv-list="cannot">
        <h2 className="kv-card__title">{t.t('ops3.pos.ex.cannotTitle')}</h2>
        <ul>{CANNOT.map((k) => <li key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</li>)}</ul>
      </div>
      <div className="kv-card" data-kv-list="can">
        <h2 className="kv-card__title">{t.t('ops3.pos.ex.canTitle')}</h2>
        <ul>{CAN.map((k) => <li key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</li>)}</ul>
      </div>
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={POS.home} data-kv-link="home">{t.t('ops3.pos.backHome')}</Link></p>
      <Ops3Refusals t={t} surface="pos_exceptions" />
    </section>
  );
}

/* ═════════════════════════════ W365 · /pos/shift-close ═════════════════════════════ */
export type CoolerState = 'ok' | 'none' | 'off' | 'error';
export interface PosShiftProps {
  t: Tr; lang: string; state: CounterState; centre: DairyMcc | null; centres: readonly DairyMcc[]; today: string | null;
  rows: readonly DairyDaySummaryRow[] | null; cooler: CoolerState; tiles: readonly DairyBmcTile[];
}
function CoolerFacts({ t, tile }: { t: Tr; tile: DairyBmcTile }) {
  return (
    <dl className="kv-facts" data-kv-cooler={tile.unitId}>
      <div className="kv-facts__row"><dt>{t.t('ops3.pos.shiftPage.level')}</dt><dd data-kv-level={tile.volumeLitres ?? 'none'}>{tile.volumeLitres && tile.volumeAt
        ? t.t('ops3.pos.shiftPage.levelValue', { volume: tile.volumeLitres, capacity: tile.capacityLitres, at: recordedAtText(tile.volumeAt) ?? '' })
        : t.t('ops3.pos.shiftPage.levelNone')}</dd></div>
      <div className="kv-facts__row"><dt>{t.t('ops3.pos.shiftPage.reading')}</dt><dd data-kv-temp={tile.tempC ?? 'none'}>{tile.tempC !== null && tile.telemetry.ageMinutes !== null
        ? t.t('ops3.pos.shiftPage.readingValue', { temp: tile.tempC, minutes: tile.telemetry.ageMinutes })
        : t.t('ops3.pos.shiftPage.readingNone')}</dd></div>
    </dl>
  );
}
export function PosShiftView({ t, lang, state, centre, centres, today, rows, cooler, tiles }: PosShiftProps) {
  const here = centre ? tiles.filter((x) => x.mccId === centre.id) : [];
  return (
    <section data-kv-page="pos_shift">
      <h1>{t.t('ops3.pos.shiftPage.title')}</h1>
      <CounterChrome t={t} centre={centre} />
      <p className="kv-lead">{t.t('ops3.pos.shiftPage.lead')}</p>
      {state !== 'ok' ? <CounterStateView t={t} state={state} page={POS.shift} /> : !centre ? <CentrePicker t={t} centres={centres} page={POS.shift} /> : (
        <>
          <p data-kv-day={today ?? ''}>{t.t('ops3.pos.day', { day: today ?? '' })}</p>
          {rows === null ? <CounterStateView t={t} state="error" page={`${POS.shift}?mcc=${centre.id}`} /> : POUR_SHIFTS.map((s) => (
            <article key={s} className="kv-card" data-kv-shift={s}>
              <h2 className="kv-card__title">{t.t(`ops3.pos.shift.${s}`)} · <Hours t={t} centre={centre} shift={s} /></h2>
              <ShiftTotals t={t} lang={lang} row={rowFor(rows, s)} shift={s} />
            </article>
          ))}
          <article className="kv-card" data-kv-cooler-state={cooler}>
            <h2 className="kv-card__title">{t.t('ops3.pos.shiftPage.coolerTitle')}</h2>
            {cooler === 'ok' && here.length > 0 ? here.map((x) => <CoolerFacts key={x.unitId} t={t} tile={x} />)
              : <p className="kv-muted">{t.t(cooler === 'off' ? 'ops3.pos.shiftPage.coolerOff' : cooler === 'error' ? 'ops3.pos.shiftPage.coolerError' : 'ops3.pos.shiftPage.coolerNone')}</p>}
            {cooler === 'error' ? <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`${POS.shift}?mcc=${centre.id}`} data-kv-retry="reread">{t.t('ops3.pos.retry')}</Link></p> : null}
            <p className="kv-statement" data-kv-statement="ops3.pos.shiftPage.stated">{t.t('ops3.pos.shiftPage.stated')}</p>
            {/* NAMED UPDATE (PC-56 OPS-3b): "There is no cooler page on this console." became false at merge — the centre's cooler page is linked. */}
            <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`/bmc?mcc=${centre.id}`} data-kv-link="bmc">{t.t('ops3.pos.shiftPage.coolerPage')}</Link></p>
          </article>
          <p className="kv-statement" data-kv-statement="ops3.pos.shiftPage.noDifference">{t.t('ops3.pos.shiftPage.noDifference')}</p>
          <p className="kv-refusal" data-kv-refused-act="close_shift">{t.t('ops3.pos.shiftPage.closeRefused')}</p>
        </>
      )}
      <Ops3Refusals t={t} surface="pos_shift" />
    </section>
  );
}
