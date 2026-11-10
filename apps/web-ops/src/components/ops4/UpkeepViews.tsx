// apps/web-ops/src/components/ops4/UpkeepViews.tsx · PC-56 OPS-4b · W408 `/chc/maintenance` and its REAL form chain (W3300–W3303), presentational.
//
// What a person at the field desk SEES, signed in as themself (OPS-3 Q14-A): the maintenance entries of the machines THEY listed — the type in
// words, the day, the cost "as entered" (the server's minor string through the money formatter), the engine hours as typed — and the server's two
// alerts for THEIR machines, in words. The typed NOTE of an entry is never printed (free text may carry a person's name). Each machine by its
// category's name and registration number; never a person. What they are TOLD (facts the code proves at merge): only the machine's owner
// records its maintenance, and each entry is recorded; an entry does not take a machine off hire (it does not change the machine's status);
// while a machine's status is "in maintenance" no hire can be requested for it; every figure in an entry is typed. What they CAN DO: record a
// maintenance entry on one of their machines (the only form; GET to the review, one POST from the review). No days down, no %, no "real
// rent", no odometer, no technician, no completion. Every refused canon line is printed BY NAME (`Ops4Refusals`).
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { CategoryNode, EquipmentAsset } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops4/refusals';
import { CHC, MAINTENANCE_TYPES, isMinorString, type ChcState, type MaintenanceEntry } from '../../features/ops4/chc';
import { MAINT, MAINT_MACHINES, draftQuery, type MaintAlert, type MaintBody, type MaintDraftInput, type MaintFailure, type MaintFieldError, type RecordedEntry } from '../../features/ops4/upkeep';
import { machineText } from './ChcViews';
import { Ops4Refusals } from './Ops4Chain';

const money = (minor: unknown, lang: string) => (isMinorString(minor) ? formatMoneyMinor(minor, 'INR', lang) : null);
/** The page's facts, in this order — each a fact the code proves at merge (brief §D wording rule). */
export const UPKEEP_STATEMENT = ['ops4.upkeep.ownerOnly', 'ops4.upkeep.notOffHire', 'ops4.upkeep.inMaintenance', 'ops4.upkeep.typed'] as const;
export type FormAction = string | ((formData: FormData) => void | Promise<void>);

function Statements({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="upkeep">
      {UPKEEP_STATEMENT.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
    </div>
  );
}

/** One entry in words: type, day, engine hours as typed, cost as entered. Never the note. */
function EntryLine({ t, lang, e }: { t: Tr; lang: string; e: Pick<MaintenanceEntry, 'id' | 'logType' | 'performedOn' | 'engineHoursAt' | 'costMinor'> }) {
  return (
    <li data-kv-entry={e.id}>
      <strong>{t.t(`ops4.maint.${e.logType}`)}</strong>{' · '}{e.performedOn ?? t.t('ops4.none')}
      {e.engineHoursAt ? <>{' · '}{t.t('ops4.maint.hoursAt', { hours: e.engineHoursAt })}</> : null}
      {e.costMinor ? <>{' · '}<span data-kv-minor={e.costMinor}>{t.t('ops4.maint.cost', { money: money(e.costMinor, lang) as string })}</span></> : null}
    </li>
  );
}

/** THE ONE FORM (W408 "Record a maintenance entry"): GET to the review state; five inputs; values kept on a form error. */
export function MaintForm({ t, machines, categories, values }: { t: Tr; machines: readonly EquipmentAsset[]; categories: readonly CategoryNode[]; values?: MaintDraftInput }) {
  return (
    <form method="get" action={MAINT} className="kv-form" data-kv-form="maintenance" aria-labelledby="ops4-maint-form">
      <h2 id="ops4-maint-form" className="kv-card__title">{t.t('ops4.upkeep.record')}</h2>
      <input type="hidden" name="form" value="review" />
      <label className="kv-field__label" htmlFor="ops4-m-asset">{t.t('ops4.upkeep.field.machine')}</label>
      <select id="ops4-m-asset" name="asset" className="kv-input" defaultValue={values?.asset ?? ''} required>
        <option value="">{t.t('ops4.upkeep.field.choose')}</option>
        {machines.map((a) => <option key={a.id} value={a.id}>{machineText(t, a, categories)}</option>)}
      </select>
      <label className="kv-field__label" htmlFor="ops4-m-type">{t.t('ops4.upkeep.field.type')}</label>
      <select id="ops4-m-type" name="logType" className="kv-input" defaultValue={values?.logType ?? ''} required>
        <option value="">{t.t('ops4.upkeep.field.choose')}</option>
        {MAINTENANCE_TYPES.map((k) => <option key={k} value={k}>{t.t(`ops4.maint.${k}`)}</option>)}
      </select>
      <label className="kv-field__label" htmlFor="ops4-m-day">{t.t('ops4.upkeep.field.day')}</label>
      <input id="ops4-m-day" name="performedOn" type="date" className="kv-input" defaultValue={values?.performedOn ?? ''} required />
      <p className="kv-field__hint">{t.t('ops4.upkeep.field.dayHint')}</p>
      <label className="kv-field__label" htmlFor="ops4-m-cost">{t.t('ops4.upkeep.field.cost')}</label>
      <input id="ops4-m-cost" name="cost" inputMode="decimal" className="kv-input" defaultValue={values?.cost ?? ''} />
      <label className="kv-field__label" htmlFor="ops4-m-hours">{t.t('ops4.upkeep.field.hours')}</label>
      <input id="ops4-m-hours" name="hours" inputMode="decimal" className="kv-input" defaultValue={values?.hours ?? ''} />
      <p className="kv-pager"><button type="submit" className="kv-btn" data-kv-real="review">{t.t('ops4.upkeep.toReview')}</button></p>
    </form>
  );
}

/** W3300 — which field failed, by name (the API's own refusal of a field included). */
export function MaintFormError({ t, error }: { t: Tr; error: MaintFieldError | 'api' | 'change' }) {
  return <p className="kv-error" role="alert" data-kv-form-error={error}>{t.t(`ops4.upkeep.fieldError.${error}`)}</p>;
}

/** W3301 — the entry as typed; one POST to the act (the key minted here, so a double submit replays the same answer). */
export function MaintReview({ t, lang, machine, body, idemKey, action, draft }: { t: Tr; lang: string; machine: string; body: MaintBody; idemKey: string; action: FormAction; draft: MaintDraftInput }) {
  return (
    <div className="kv-card" data-kv-review="maintenance">
      <p className="kv-statement" data-kv-statement="ops4.upkeep.asTyped">{t.t('ops4.upkeep.asTyped')}</p>
      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ops4.upkeep.field.machine')}</dt><dd>{machine}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops4.upkeep.field.type')}</dt><dd>{t.t(`ops4.maint.${body.logType}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops4.upkeep.field.day')}</dt><dd>{body.performedOn}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops4.upkeep.field.cost')}</dt><dd data-kv-minor={body.costMinor ?? 'none'}>{body.costMinor ? t.t('ops4.maint.cost', { money: money(body.costMinor, lang) as string }) : t.t('ops4.upkeep.notEntered')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ops4.upkeep.field.hours')}</dt><dd>{body.engineHoursAt ? t.t('ops4.maint.hoursAt', { hours: body.engineHoursAt }) : t.t('ops4.upkeep.notEntered')}</dd></div>
      </dl>
      <form action={action as never} method="post" data-kv-form="maintenance-submit">
        <input type="hidden" name="asset" value={body.assetId} />
        <input type="hidden" name="logType" value={body.logType} />
        <input type="hidden" name="performedOn" value={body.performedOn} />
        <input type="hidden" name="costMinor" value={body.costMinor ?? ''} />
        <input type="hidden" name="hours" value={body.engineHoursAt ?? ''} />
        <input type="hidden" name="key" value={idemKey} />
        <p className="kv-pager">
          <button type="submit" className="kv-btn" data-kv-real="record">{t.t('ops4.upkeep.submit')}</button>{' '}
          <Link className="kv-btn--link" href={`${MAINT}?form=error&reason=change&${draftQuery(draft)}`} data-kv-change="form">{t.t('ops4.upkeep.change')}</Link>
        </p>
      </form>
    </div>
  );
}

/** W3302 — the SERVER's answer: its id and the entry as it stored it. */
export function MaintRecorded({ t, lang, entry, machine }: { t: Tr; lang: string; entry: RecordedEntry | null; machine: string | null }) {
  if (!entry) return <p className="kv-muted" data-kv-recorded="unknown">{t.t('ops4.upkeep.recordedUnknown')}</p>;
  return (
    <div className="kv-card" data-kv-recorded={entry.id}>
      <p data-kv-fact="server-id">{t.t('ops4.upkeep.recordedId', { id: entry.id })}</p>
      {machine ? <p data-kv-fact="machine">{machine}</p> : null}
      <ul className="kv-list"><EntryLine t={t} lang={lang} e={entry} /></ul>
      <p className="kv-statement" data-kv-statement="ops4.upkeep.recordedFact">{t.t('ops4.upkeep.recordedFact')}</p>
    </div>
  );
}

/** W3303 — the named refusal; nothing was recorded. */
export function MaintFailureNote({ t, reason }: { t: Tr; reason: MaintFailure }) {
  return <p className="kv-error" role="alert" data-kv-failure={reason}>{t.t(`ops4.upkeep.failure.${reason}`)}</p>;
}

export interface UpkeepProps {
  t: Tr; lang: string; state: ChcState; machines: readonly EquipmentAsset[]; machinesMore: boolean; categories: readonly CategoryNode[];
  entries: Readonly<Record<string, readonly MaintenanceEntry[] | null>>; alerts: ReadonlyArray<{ assetId: string; alert: MaintAlert }> | null;
}
export function MaintenanceView({ t, lang, state, machines, machinesMore, categories, entries, alerts }: UpkeepProps) {
  if (state === 'off') {
    return (
      <section data-kv-ops4="upkeep" data-kv-state="off">
        <h1>{t.t('ops4.upkeep.title')}</h1>
        <div className="kv-card" data-kv-off="equipment"><h2 className="kv-card__title">{t.t('ops4.off.title')}</h2><p>{t.t('ops4.off.body')}</p></div>
        <Ops4Refusals t={t} surface="chc_maintenance" />
      </section>
    );
  }
  const shown = machines.slice(0, MAINT_MACHINES);
  const mine = new Set(machines.map((m) => m.id));
  return (
    <section data-kv-ops4="upkeep" data-kv-state={state}>
      <h1>{t.t('ops4.upkeep.title')}</h1>
      <p className="kv-muted">{t.t('ops4.upkeep.signedIn')}</p>
      <Statements t={t} />
      {state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="read">
          <h2 className="kv-card__title">{t.t('ops4.error.title')}</h2><p>{t.t('ops4.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${MAINT}?act=confirm`} data-kv-chain-link="retry">{t.t('ops4.error.retry')}</Link></p>
        </div>
      ) : (
        <>
          <h2>{t.t('ops4.upkeep.alerts')}</h2>
          {alerts === null ? <p className="kv-error" role="alert" data-kv-error="alerts">{t.t('ops4.upkeep.alertsFailed')}</p>
            : alerts.filter((a) => mine.has(a.assetId)).length === 0 ? <p className="kv-empty-state" data-kv-empty="alerts">{t.t('ops4.upkeep.alertsNone')}</p> : (
              <ul className="kv-list" data-kv-alerts="upkeep">
                {alerts.filter((a) => mine.has(a.assetId)).map((a) => (
                  <li key={`${a.assetId}-${a.alert}`} data-kv-alert={a.alert}>
                    {machineText(t, machines.find((m) => m.id === a.assetId) ?? null, categories)}{' · '}{t.t(`ops4.upkeep.alert.${a.alert}`)}
                  </li>
                ))}
              </ul>
            )}
          <h2>{t.t('ops4.upkeep.entries')}</h2>
          {machines.length === 0 ? <p className="kv-empty-state" data-kv-empty="machines">{t.t('ops4.dash.machinesNone')}</p> : shown.map((m) => {
            const rows = entries[m.id];
            return (
              <article key={m.id} className="kv-card" data-kv-machine={m.id} data-kv-asset-status={m.status}>
                <h3 className="kv-card__title"><Link className="kv-link" href={`${CHC.detail}?id=${encodeURIComponent(m.id)}`} data-kv-edge="W406">{machineText(t, m, categories)}</Link>{' '}<span className="kv-badge">{t.t(`ops4.asset.${m.status}`)}</span></h3>
                {rows === null || rows === undefined ? <p className="kv-error" role="alert" data-kv-error="entries">{t.t('ops4.detail.maintFailed')}</p>
                  : rows.length === 0 ? <p className="kv-empty-state" data-kv-empty="entries">{t.t('ops4.detail.maintNone')}</p>
                    : <ul className="kv-list" data-kv-maintenance={rows.length}>{rows.map((e) => <EntryLine key={e.id} t={t} lang={lang} e={e} />)}</ul>}
              </article>
            );
          })}
          {machines.length > MAINT_MACHINES || machinesMore ? <p className="kv-muted" data-kv-note="machines-more">{t.t('ops4.upkeep.firstN', { n: MAINT_MACHINES })}</p> : null}
          <p className="kv-muted" data-kv-note="no-notes">{t.t('ops4.upkeep.noNotes')}</p>
          {machines.length > 0 ? <MaintForm t={t} machines={machines} categories={categories} /> : null}
        </>
      )}
      <Ops4Refusals t={t} surface="chc_maintenance" />
    </section>
  );
}
