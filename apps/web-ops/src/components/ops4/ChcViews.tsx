// apps/web-ops/src/components/ops4/ChcViews.tsx · PC-56 OPS-4a · THE HIRE — the four hire pages, presentational (W405, W406, W407, W409).
//
// What a person at the field desk SEES, signed in as themself (OPS-3 Q14-A): the machines THEY listed and the hires on them, by booking
// number (never the renter's name — OPS-2 Q9-A, OPS-3 Q10-A); each machine by its category's name and registration number; its rate lines in
// words with their days; its maintenance entries as typed; every amount the SERVER's minor string through the money formatter, every quantity
// the server's scaled string as sent — NOTHING is added, multiplied, subtracted or turned into a percentage here (E3); the only tally is a count
// of hires per status, which says how many hires it counted. What they are TOLD: the founder's words (Q1-A with the no-renter-app fact, Q2-A,
// Q3-A) and facts the code proves. What they CANNOT DO here: quote, start, finish, settle, cancel or change a rate — no money button, no form but
// the status filter (a GET). Every refused canon line is printed BY NAME (`Ops4Refusals`).
import Link from 'next/link';
import type { ReactNode } from 'react';
// PC-56 RTL-1e: the console's money text (features/rtl/money.ts `moneyText`) — the Indian shape, isolated, under Arabic; byte-identical under
// en/hi/gu. Bound to the name `formatMoneyMinor` here so this view's call reads as before (its pinned OPS spec).
import { moneyText as formatMoneyMinor } from '../../features/rtl/money';
import { ltrText } from '../../features/rtl/span';   // PC-56 RTL-1e: a code inside a sentence, isolated under Arabic only
import type { CategoryNode, EquipmentAsset, EquipmentRate, EquipmentRental } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops4/refusals';
import {
  CHC, RENTAL_STATUSES, atText, bookingsHref, categoryName, countByStatus, dayText, isMinorString, machineOf, qtyText,
  type ChcState, type MaintenanceEntry, type RentalStatus,
} from '../../features/ops4/chc';
import { Ops4Refusals } from './Ops4Chain';

const money = (minor: unknown, lang: string) => (isMinorString(minor) ? formatMoneyMinor(minor, 'INR', lang) : null);

/** A machine in words: its category's name and its registration number. Never a person. */
export function machineText(t: Tr, a: EquipmentAsset | null, categories: readonly CategoryNode[]): string {
  if (!a) return t.t('ops4.machine.notListed');
  const cat = categoryName(categories, a.categoryId) ?? t.t('ops4.machine.unnamed');
  return a.regNo ? t.t('ops4.machine.label', { category: cat, regNo: a.regNo }) : t.t('ops4.machine.labelNoReg', { category: cat });
}

function Statements({ t, keys, id }: { t: Tr; keys: readonly string[]; id: string }) {
  return (
    <div className="kv-card" data-kv-statement={id}>
      {keys.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
    </div>
  );
}
/** The hire statement (W407): the founder's words — Q1-A WITH the no-renter-app fact (the lead's decision), Q2-A, Q3-A. */
export const HIRE_STATEMENT = ['ops4.q1.words', 'ops4.q1.noRenterApp', 'ops4.q2.words', 'ops4.q3.words'] as const;

function Off({ t, page, surface }: { t: Tr; page: string; surface: 'chc_dashboard' | 'chc_equipment' | 'chc_bookings' }) {
  return (
    <section data-kv-ops4={page} data-kv-state="off">
      <h1>{t.t(`ops4.${page}.title`)}</h1>
      <div className="kv-card" data-kv-off="equipment"><h2 className="kv-card__title">{t.t('ops4.off.title')}</h2><p>{t.t('ops4.off.body')}</p></div>
      <Ops4Refusals t={t} surface={surface} />
    </section>
  );
}
function ReadError({ t, href }: { t: Tr; href: string }) {
  return (
    <div className="kv-card" role="alert" data-kv-error="read">
      <h2 className="kv-card__title">{t.t('ops4.error.title')}</h2>
      <p>{t.t('ops4.error.body')}</p>
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-chain-link="retry">{t.t('ops4.error.retry')}</Link></p>
    </div>
  );
}

// ══ W405 · /chc/dashboard ══
export interface ChcDashboardProps { t: Tr; lang: string; state: ChcState; machines: readonly EquipmentAsset[]; machinesMore: boolean; categories: readonly CategoryNode[]; hires: readonly EquipmentRental[]; hiresMore: boolean }
export function ChcDashboardView({ t, state, machines, machinesMore, categories, hires, hiresMore }: ChcDashboardProps) {
  if (state === 'off') return <Off t={t} page="dash" surface="chc_dashboard" />;
  const counts = countByStatus(hires);
  return (
    <section data-kv-ops4="dash" data-kv-state={state}>
      <h1>{t.t('ops4.dash.title')}</h1>
      <p className="kv-muted">{t.t('ops4.signedIn')}</p>
      <Statements t={t} id="dash" keys={['ops4.q2.words', 'ops4.dash.noFigures']} />
      {state === 'error' ? <ReadError t={t} href={`${CHC.dashboard}?act=confirm`} /> : (
        <>
          <h2>{t.t('ops4.dash.machines')}</h2>
          {machines.length === 0 ? <p className="kv-empty-state" data-kv-empty="machines">{t.t('ops4.dash.machinesNone')}</p> : (
            <ul className="kv-list" data-kv-machines={machines.length}>
              {machines.map((a) => (
                <li key={a.id} data-kv-machine={a.id} data-kv-asset-status={a.status}>
                  <Link className="kv-link" href={`${CHC.detail}?id=${encodeURIComponent(a.id)}`} data-kv-edge="W406">{machineText(t, a, categories)}</Link>
                  {' '}<span className="kv-badge">{t.t(`ops4.asset.${a.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
          {machinesMore ? <p className="kv-muted" data-kv-note="machines-more">{t.t('ops4.dash.machinesMore', { n: machines.length })}</p> : null}
          <h2>{t.t('ops4.dash.hires')}</h2>
          {hires.length === 0 ? <p className="kv-empty-state" data-kv-empty="hires">{t.t('ops4.dash.hiresNone')}</p> : (
            <>
              <p className="kv-muted" data-kv-counted={hires.length} data-kv-more={hiresMore ? 'yes' : 'no'}>
                {t.t(hiresMore ? 'ops4.dash.countedLatest' : 'ops4.dash.countedAll', { n: hires.length })}
              </p>
              <dl className="kv-facts" data-kv-by-status="hires">
                {counts.map((c) => (
                  <div key={c.status} className="kv-facts__row" data-kv-status-count={c.status}>
                    <dt>{t.t(`ops4.status.${c.status}`)}</dt><dd>{t.t('ops4.dash.hireCount', { n: c.count })}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={CHC.bookings} data-kv-edge="W407">{t.t('ops4.dash.openBookings')}</Link></p>
        </>
      )}
      <Ops4Refusals t={t} surface="chc_dashboard" />
    </section>
  );
}

// ══ W406 · /chc/equipment-detail?id= ══
export interface ChcEquipmentProps {
  t: Tr; lang: string; state: ChcState | 'notFound'; asset: EquipmentAsset | null; categories: readonly CategoryNode[];
  rates: readonly EquipmentRate[] | null; maintenance: readonly MaintenanceEntry[] | null;
}
export function ChcEquipmentView({ t, lang, state, asset, categories, rates, maintenance }: ChcEquipmentProps) {
  if (state === 'off') return <Off t={t} page="detail" surface="chc_equipment" />;
  const self = asset ? `${CHC.detail}?id=${encodeURIComponent(asset.id)}` : CHC.detail;
  return (
    <section data-kv-ops4="detail" data-kv-state={state}>
      <h1>{t.t('ops4.detail.title')}</h1>
      <p className="kv-muted">{t.t('ops4.signedIn')}</p>
      {state === 'notFound' || (state === 'ok' && !asset) ? (
        <div className="kv-empty-state" data-kv-empty="machine"><h2>{t.t('ops4.detail.notFound.title')}</h2><p>{t.t('ops4.detail.notFound.body')}</p></div>
      ) : state === 'error' || !asset ? <ReadError t={t} href={`${self}&act=confirm`} /> : (
        <>
          <h2 data-kv-machine={asset.id}>{machineText(t, asset, categories)}</h2>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('ops4.detail.category')}</dt><dd>{categoryName(categories, asset.categoryId) ?? t.t('ops4.machine.unnamed')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.detail.regNo')}</dt><dd>{asset.regNo ?? t.t('ops4.detail.notEntered')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.detail.year')}</dt><dd>{asset.yearOfMfg ?? t.t('ops4.detail.notEntered')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.detail.hp')}</dt><dd>{asset.hpRating ?? t.t('ops4.detail.notEntered')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.detail.engineHours')}</dt><dd data-kv-engine-hours={asset.engineHours ?? 'none'}>{asset.engineHours ?? t.t('ops4.detail.notEntered')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.detail.status')}</dt><dd><span className="kv-badge">{t.t(`ops4.asset.${asset.status}`)}</span></dd></div>
          </dl>
          <p className="kv-statement" data-kv-statement="ops4.detail.engineHoursTyped">{t.t('ops4.detail.engineHoursTyped')}</p>
          {asset.status === 'maintenance' || asset.status === 'retired' ? <p className="kv-statement" data-kv-statement="ops4.detail.notBookable">{t.t(`ops4.detail.notBookable.${asset.status}`)}</p> : null}

          <h2>{t.t('ops4.detail.rates')}</h2>
          {rates === null ? <p className="kv-error" role="alert" data-kv-error="rates">{t.t('ops4.detail.ratesFailed')}</p>
            : rates.length === 0 ? <p className="kv-empty-state" data-kv-empty="rates">{t.t('ops4.detail.ratesNone')}</p> : (
              <ul className="kv-list" data-kv-rates={rates.length}>
                {rates.map((r) => (
                  <li key={r.id} data-kv-rate-line={r.id} data-kv-minor={isMinorString(r.rateMinor) ? r.rateMinor : 'none'}>
                    {t.t('ops4.rateLine', { money: money(r.rateMinor, lang) ?? t.t('ops4.none'), basis: t.t(`ops4.basis.${r.rateBasis}`) })}
                    {' · '}{t.t(r.includesOperator ? 'ops4.rate.withOperator' : 'ops4.rate.noOperator')}
                    {' · '}{t.t(r.includesFuel ? 'ops4.rate.withFuel' : 'ops4.rate.noFuel')}
                    {' · '}<span data-kv-days={`${r.effectiveFrom}|${r.effectiveTo ?? ''}`}>{dayText(r.effectiveTo)
                      ? t.t('ops4.rate.daysRange', { from: r.effectiveFrom, to: r.effectiveTo as string })
                      : t.t('ops4.rate.daysOpen', { from: dayText(r.effectiveFrom) ?? t.t('ops4.none') })}</span>
                  </li>
                ))}
              </ul>
            )}
          <p className="kv-statement" data-kv-statement="ops4.detail.rateKept">{t.t('ops4.detail.rateKept')}</p>

          <h2>{t.t('ops4.detail.maintenance')}</h2>
          {maintenance === null ? <p className="kv-error" role="alert" data-kv-error="maintenance">{t.t('ops4.detail.maintFailed')}</p>
            : maintenance.length === 0 ? <p className="kv-empty-state" data-kv-empty="maintenance">{t.t('ops4.detail.maintNone')}</p> : (
              <ul className="kv-list" data-kv-maintenance={maintenance.length}>
                {maintenance.map((m) => (
                  <li key={m.id} data-kv-entry={m.id}>
                    <strong>{t.t(`ops4.maint.${m.logType}`)}</strong>{' · '}{m.performedOn ?? t.t('ops4.none')}
                    {m.engineHoursAt ? <>{' · '}{t.t('ops4.maint.hoursAt', { hours: m.engineHoursAt })}</> : null}
                    {m.costMinor ? <>{' · '}<span data-kv-minor={m.costMinor}>{t.t('ops4.maint.cost', { money: money(m.costMinor, lang) as string })}</span></> : null}
                    {m.notes ? <>{' · '}<span data-kv-note="typed">{t.t('ops4.maint.note', { note: m.notes })}</span></> : null}
                  </li>
                ))}
              </ul>
            )}
          <p className="kv-statement" data-kv-statement="ops4.detail.maintTyped">{t.t('ops4.detail.maintTyped')}</p>
          <p className="kv-statement" data-kv-statement="ops4.detail.noCalendar">{t.t('ops4.detail.noCalendar')}</p>
        </>
      )}
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={CHC.dashboard} data-kv-back={CHC.dashboard}>{t.t('ops4.detail.back')}</Link></p>
      <Ops4Refusals t={t} surface="chc_equipment" />
    </section>
  );
}

// ══ W407 · /chc/bookings ══
export interface ChcBookingsProps {
  t: Tr; lang: string; state: ChcState; hires: readonly EquipmentRental[]; nextCursor: string | null; status: RentalStatus | undefined;
  machines: readonly EquipmentAsset[]; categories: readonly CategoryNode[];
}
function Hire({ t, lang, h, machines, categories }: { t: Tr; lang: string; h: EquipmentRental; machines: readonly EquipmentAsset[]; categories: readonly CategoryNode[] }) {
  const basis = t.t(`ops4.basis.${h.rateBasis}`);
  const est = qtyText(h.estQuantity); const act = qtyText(h.actualQuantity);
  const machine = machineOf(machines, h.assetId);
  const row = (k: string, v: ReactNode, attr?: Record<string, string>) => <div className="kv-facts__row" {...attr}><dt>{t.t(k)}</dt><dd>{v}</dd></div>;
  return (
    <article className="kv-card" data-kv-hire={h.id} data-kv-hire-status={h.status}>
      <h3 className="kv-card__title" data-kv-booking-no={h.bookingNo}>{t.t('ops4.hire.bookingNo', { no: ltrText(h.bookingNo, lang) })}</h3>
      <dl className="kv-facts">
        {row('ops4.hire.machine', machine
          ? <Link className="kv-link" href={`${CHC.detail}?id=${encodeURIComponent(h.assetId)}`} data-kv-edge="W406">{machineText(t, machine, categories)}</Link>
          : t.t('ops4.machine.notListed'))}
        {row('ops4.hire.status', <span className="kv-badge">{t.t(`ops4.status.${h.status}`)}</span>)}
        {row('ops4.hire.rate', <span data-kv-minor={h.rateMinor}>{t.t('ops4.rateLine', { money: money(h.rateMinor, lang) ?? t.t('ops4.none'), basis })}</span>)}
        {row('ops4.hire.estimated', est ? t.t(`ops4.qty.${h.rateBasis}`, { qty: est }) : t.t('ops4.none'), { 'data-kv-qty-est': est ?? 'none' })}
        {row('ops4.hire.actual', act ? t.t(`ops4.qty.${h.rateBasis}`, { qty: act }) : t.t('ops4.hire.actualNone'), { 'data-kv-qty-act': act ?? 'none' })}
        {row('ops4.hire.deposit', h.status === 'requested' ? t.t('ops4.hire.depositNone') : <span data-kv-minor={h.advanceMinor}>{money(h.advanceMinor, lang) ?? t.t('ops4.none')}</span>)}
        {row('ops4.hire.bill', isMinorString(h.totalMinor) ? <span data-kv-minor={h.totalMinor}>{money(h.totalMinor, lang)}</span> : t.t('ops4.hire.billNone'))}
        {row('ops4.hire.hoursConfirmed', h.usageConfirmedAt
          ? t.t('ops4.hire.confirmedAt', { at: atText(h.usageConfirmedAt) ?? t.t('ops4.none') })
          : act ? t.t('ops4.hire.notConfirmed') : t.t('ops4.hire.noHoursYet'), { 'data-kv-usage-confirmed': h.usageConfirmedAt ? 'yes' : 'no' })}
        {row('ops4.hire.scheduled', atText(h.scheduledAt) ?? t.t('ops4.none'))}
        {h.startedAt ? row('ops4.hire.started', atText(h.startedAt) ?? t.t('ops4.none')) : null}
        {h.completedAt ? row('ops4.hire.completed', atText(h.completedAt) ?? t.t('ops4.none')) : null}
      </dl>
    </article>
  );
}
export function ChcBookingsView({ t, lang, state, hires, nextCursor, status, machines, categories }: ChcBookingsProps) {
  if (state === 'off') return <Off t={t} page="bookings" surface="chc_bookings" />;
  return (
    <section data-kv-ops4="bookings" data-kv-state={state}>
      <h1>{t.t('ops4.bookings.title')}</h1>
      <p className="kv-muted">{t.t('ops4.signedIn')}</p>
      <Statements t={t} id="hire" keys={HIRE_STATEMENT} />
      <form method="get" action={CHC.bookings} className="kv-inline-form" role="search" aria-label={t.t('ops4.bookings.filterLabel')}>
        <label htmlFor="ops4-status" className="kv-field__label">{t.t('ops4.hire.status')}</label>
        <select id="ops4-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('ops4.bookings.allStatuses')}</option>
          {RENTAL_STATUSES.map((s) => <option key={s} value={s}>{t.t(`ops4.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops4.bookings.show')}</button>
      </form>
      {state === 'error' ? <ReadError t={t} href={`${CHC.bookings}?act=confirm`} /> : hires.length === 0 ? (
        <p className="kv-empty-state" data-kv-empty="hires">{t.t(status ? 'ops4.bookings.noneWithStatus' : 'ops4.dash.hiresNone')}</p>
      ) : (
        <>
          <p className="kv-muted" data-kv-note="server-values">{t.t('ops4.bookings.serverValues')}</p>
          {hires.map((h) => <Hire key={h.id} t={t} lang={lang} h={h} machines={machines} categories={categories} />)}
        </>
      )}
      {state === 'ok' && nextCursor ? <p className="kv-pager"><Link className="kv-btn--link" href={bookingsHref(status, nextCursor)} data-kv-next="yes">{t.t('ops4.bookings.next')}</Link></p> : null}
      <Ops4Refusals t={t} surface="chc_bookings" />
    </section>
  );
}

// ══ W409 · /chc/insights — HONEST: reads nothing ══
export function ChcInsightsView({ t }: { t: Tr }) {
  return (
    <section data-kv-ops4="insights" data-kv-state="honest">
      <h1>{t.t('ops4.insights.title')}</h1>
      <Statements t={t} id="insights" keys={['ops4.insights.readsNothing', 'ops4.insights.noFigures', 'ops4.insights.hoursTyped', 'ops4.insights.noCompare']} />
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href={CHC.bookings} data-kv-edge="W407">{t.t('ops4.dash.openBookings')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${CHC.insights}?act=confirm`} data-kv-decor="retry">{t.t('ops4.error.retry')}</Link>
      </p>
      <Ops4Refusals t={t} surface="chc_insights" />
    </section>
  );
}
