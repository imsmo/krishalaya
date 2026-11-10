// apps/web-ops/src/components/ops5/AlertViews.tsx · PC-56 OPS-5a · THE ALERTS — the alert-rule page (W402), its change chain's contents (W3292–W3294)
// and the incident file (W403), presentational.
//
// What a person at the field desk SEES, signed in as themself (OPS-3 Q14-A): each alert rule as it is — kind and threshold in words, HOW MANY
// people it names, cooldown, on or paused, when the server last evaluated it, its last recorded change (when, and whether it was you); its open
// proposal (which fields, which way, when, by you or another person); what each rule fired (when, how many were told, acknowledged or not); the
// breaches' own alerts, each linked to its file; and one breach's facts and the server's timeline. What they are TOLD: Q3-A's sentence verbatim
// (HOTFIX-14); Q1-A's sentence verbatim; the true "no breach rule" sentence; facts the code proves. What they CANNOT DO here: acknowledge, act on
// or record an outcome or a loss on a breach (Q1-A); set a band; run the rules on demand (E6); quiet a rule alone (Q3-A).
// NEVER SHOWN (E15): a person's id or name (a recipient, an author, a proposer, a buyer), an action note, an outcome reason, a buyer's reason, a
// proposal's reason. The ONE free text printed is a rule's own name — its identity (pinned by a render test).
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ColdBreach } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Tr } from '../../features/ops5/refusals';
import { atText, IOT, type IotState } from '../../features/ops4/iot';
// The preferred channel is NOT offered: nothing in the notification spine reads it (HOTFIX-14 §2.2) — a field that changes nothing is not a choice.
import { ALERT_KINDS, COOLDOWN_MAX, COOLDOWN_MIN, MAINTENANCE_ALERTS, MAX_RECIPIENTS } from '../../features/devices/alerting';
import {
  ALERTS, breachAlerts, decisionKey, durationParts, firedFor, incidentHref, kindKey, lossOf, noActiveBreachRule, outcomeKey, severityKey, silenceAlerts,
  thresholdWords, timeline, type ChangeDone, type ChangeFailure, type FiredRow, type RuleRow,
} from '../../features/ops5/alerts';
import { Ops5Refusals } from './Ops5Chain';

type Action = (formData: FormData) => Promise<void>;
const at = (t: Tr, iso: unknown) => atText(iso) ?? t.t('ops5.timeUnknown');
const th = (t: Tr, kind: string, threshold: Record<string, unknown>) => {
  const w = thresholdWords(kind, threshold);
  return t.t(w.key, Object.fromEntries(Object.entries(w.vars).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('ops4.') ? t.t(v) : v])));
};

/** Q3-A (HOTFIX-14, verified there; kept true here) and the facts the page states about who is told. */
export const RULES_STATEMENTS = ['ops5.alerts.secondPersonNotice', 'ops5.alerts.quietHoursNotice', 'ops5.alerts.rulesTellBreach'] as const;

function NotShown({ t, state, page }: { t: Tr; state: 'off' | 'forbidden'; page: 'rules' | 'incident' }) {
  return (
    <section data-kv-ops5={page === 'rules' ? 'alert-rules' : 'alert-incident'} data-kv-state={state}>
      <h1>{t.t(`ops5.${page === 'rules' ? 'alerts' : 'incident'}.title`)}</h1>
      <div className="kv-card" data-kv-off={state === 'off' ? 'logistics' : 'permission'}>
        <h2 className="kv-card__title">{t.t(`ops5.${state}.title`)}</h2><p>{t.t(`ops5.${state}.body`)}</p>
      </div>
      <Ops5Refusals t={t} surface={page === 'rules' ? 'alert_rules' : 'alert_incident'} />
    </section>
  );
}
function ReadError({ t, href }: { t: Tr; href: string }) {
  return (
    <div className="kv-card" role="alert" data-kv-error="read">
      <h2 className="kv-card__title">{t.t('ops5.error.title')}</h2>
      <p>{t.t('ops5.error.body')}</p>
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-chain-link="retry">{t.t('ops5.error.retry')}</Link></p>
    </div>
  );
}

function LastChange({ t, r }: { t: Tr; r: RuleRow }) {
  if (!r.lastChange || !r.lastChange.at) return <span data-kv-last-change="none">{t.t('ops5.alerts.lastChangeNone')}</span>;
  return (
    <span data-kv-last-change={r.lastChange.action} data-kv-by-you={r.lastChange.byYou ? 'yes' : 'no'}>
      {t.t(`ops5.alerts.lastChange.${r.lastChange.action}`, { at: at(t, r.lastChange.at) })}{' · '}
      {t.t(r.lastChange.byYou ? 'ops5.alerts.byYou' : 'ops5.alerts.byAnother')}
    </span>
  );
}
function FiredList({ t, rows }: { t: Tr; rows: readonly FiredRow[] }) {
  if (rows.length === 0) return <p className="kv-muted" data-kv-empty="fired">{t.t('ops5.alerts.firedNone')}</p>;
  return (
    <ul className="kv-list" data-kv-fired={rows.length}>
      {rows.map((f) => (
        <li key={f.id} data-kv-fired-row={f.id} data-kv-acknowledged={f.acknowledgedAt ? 'yes' : 'no'}>
          {t.t('ops5.alerts.firedAt', { at: at(t, f.firedAt) })}{' · '}{t.t(severityKey(f.severity))}{' · '}
          <span data-kv-told={f.told}>{t.t('ops5.alerts.told', { n: f.told })}</span>{' · '}
          {f.acknowledgedAt ? t.t('ops5.alerts.acknowledgedAt', { at: at(t, f.acknowledgedAt) }) : t.t('ops5.alerts.notAcknowledged')}
        </li>
      ))}
    </ul>
  );
}

// ══ W402 · /iot/alert-rules ══
export interface AlertRulesProps { t: Tr; state: IotState; rules: readonly RuleRow[]; fired: readonly FiredRow[] | null }
export function AlertRulesView({ t, state, rules, fired }: AlertRulesProps) {
  if (state === 'off' || state === 'forbidden') return <NotShown t={t} state={state} page="rules" />;
  return (
    <section data-kv-ops5="alert-rules" data-kv-state={state}>
      <h1>{t.t('ops5.alerts.title')}</h1>
      <p className="kv-muted" data-kv-statement="ops5.alerts.signedIn">{t.t('ops5.alerts.signedIn')}</p>
      <div className="kv-card" data-kv-statement="alert-rules">
        {RULES_STATEMENTS.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
      </div>
      {state === 'error' ? <ReadError t={t} href={ALERTS.rules} /> : (
        <>
          {noActiveBreachRule(rules) ? <p className="kv-notice" role="note" data-kv-no-rule="breach">{t.t('ops5.alerts.noBreachRule')}</p> : null}
          <p className="kv-pager"><Link className="kv-btn" href={`${ALERTS.rules}?act=confirm&new=1`} data-kv-act="new">{t.t('ops5.alerts.newRule')}</Link></p>
          <h2>{t.t('ops5.alerts.rules')}</h2>
          {rules.length === 0 ? <p className="kv-empty-state" data-kv-empty="rules">{t.t('ops5.alerts.rulesNone')}</p> : rules.map((r) => (
            <div key={r.id} className="kv-card" data-kv-rule={r.id} data-kv-active={r.isActive ? 'yes' : 'no'}>
              <h3 className="kv-card__title" data-kv-rule-name="">{r.ruleName}</h3>
              <dl className="kv-facts">
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.kindLabel')}</dt><dd>{t.t(kindKey(r.kind))}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.whenLabel')}</dt><dd data-kv-threshold="">{th(t, r.kind, r.threshold)}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.peopleLabel')}</dt><dd data-kv-people={r.recipientCount}>{t.t('ops5.alerts.people', { n: r.recipientCount })}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.cooldownLabel')}</dt><dd>{r.cooldownMinutes === null ? t.t('ops5.alerts.unknown') : t.t('ops5.alerts.cooldown', { m: r.cooldownMinutes })}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.stateLabel')}</dt><dd><span className="kv-badge">{t.t(r.isActive ? 'ops5.alerts.active' : 'ops5.alerts.paused')}</span></dd></div>
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.evaluatedLabel')}</dt><dd>{r.lastEvaluatedAt ? at(t, r.lastEvaluatedAt) : t.t('ops5.alerts.neverEvaluated')}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('ops5.alerts.lastChangeLabel')}</dt><dd><LastChange t={t} r={r} /></dd></div>
              </dl>
              {r.openChange ? (
                <div className="kv-fine" data-kv-open-change={r.openChange.id} data-kv-proposed-by-you={r.openChange.proposedByYou ? 'yes' : 'no'}>
                  <span className="kv-badge">{t.t('ops5.alerts.proposedWaiting')}</span>
                  <ul>{r.openChange.changes.map((c) => <li key={c.field}>{t.t(`ops5.alerts.change.${c.field}`)} — {t.t(`ops5.alerts.dir.${c.direction}`)}</li>)}</ul>
                  <p>{t.t('ops5.alerts.proposedAt', { at: at(t, r.openChange.proposedAt) })}{' · '}{t.t(r.openChange.proposedByYou ? 'ops5.alerts.proposedByYou' : 'ops5.alerts.proposedByAnother')}</p>
                  <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`${ALERTS.rules}?act=confirm&change=${r.openChange.id}&rule=${r.id}`} data-kv-act="review">{t.t('ops5.alerts.reviewBtn')}</Link></p>
                </div>
              ) : (
                <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`${ALERTS.rules}?act=confirm&rule=${r.id}`} data-kv-act="propose">{t.t('ops5.alerts.proposeBtn')}</Link></p>
              )}
              <h4>{t.t('ops5.alerts.firedTitle')}</h4>
              {fired === null ? <p className="kv-error" role="alert" data-kv-error="fired">{t.t('ops5.alerts.firedFailed')}</p> : <FiredList t={t} rows={firedFor(fired, r.id)} />}
            </div>
          ))}
          <h2>{t.t('ops5.alerts.breachAlerts')}</h2>
          <p className="kv-muted" data-kv-statement="ops5.alerts.breachAlertsNote">{t.t('ops5.alerts.breachAlertsNote')}</p>
          {fired === null ? <p className="kv-error" role="alert" data-kv-error="breach-alerts">{t.t('ops5.alerts.firedFailed')}</p>
            : breachAlerts(fired).length === 0 ? <p className="kv-empty-state" data-kv-empty="breach-alerts">{t.t('ops5.alerts.breachAlertsNone')}</p> : (
              <ul className="kv-list" data-kv-breach-alerts={breachAlerts(fired).length}>
                {breachAlerts(fired).map((f) => (
                  <li key={f.id} data-kv-breach-alert={f.breachId ?? ''}>
                    {t.t('ops5.alerts.firedAt', { at: at(t, f.firedAt) })}{' · '}
                    <span data-kv-told={f.told}>{f.told === 0 ? t.t('ops5.alerts.toldNobody') : t.t('ops5.alerts.told', { n: f.told })}</span>{' · '}
                    <Link className="kv-link" href={incidentHref(f.breachId as string)} data-kv-edge="W403">{t.t('ops5.alerts.openIncident')}</Link>
                  </li>
                ))}
              </ul>
            )}
          {fired !== null && silenceAlerts(fired).length > 0 ? (
            <p data-kv-silence-alerts={silenceAlerts(fired).length}>
              {t.t('ops5.alerts.silenceAlerts', { n: silenceAlerts(fired).length })}{' '}
              <Link className="kv-link" href={IOT.health} data-kv-edge="W404">{t.t('ops5.alerts.openHealth')}</Link>
            </p>
          ) : null}
          <p className="kv-muted" data-kv-note="feed-latest">{t.t('ops5.alerts.feedLatest')}</p>
        </>
      )}
      <Ops5Refusals t={t} surface="alert_rules" />
    </section>
  );
}

// ══ W3292 (REAL) · the change form for one rule, or a new rule ══
function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return <div className="kv-field"><label htmlFor={id} className="kv-field__label">{label}</label>{children}{hint ? <p className="kv-field__hint">{hint}</p> : null}</div>;
}
function ThresholdFields({ t, kind }: { t: Tr; kind: string | null }) {
  return (
    <fieldset className="kv-fieldset" data-kv-threshold-fields={kind ?? 'any'}>
      <legend>{t.t('ops5.form.thresholdLegend')}</legend>
      <p className="kv-field__hint">{t.t(kind ? 'ops5.form.thresholdKeep' : 'ops5.form.thresholdDefaults')}</p>
      {kind === null || kind === 'cold_chain_breach' ? <>
        <Field id="ch-win" label={t.t('ops5.form.windowHours')}><input id="ch-win" name="windowHours" className="kv-input" inputMode="numeric" pattern="\d{1,3}" /></Field>
        <Field id="ch-min" label={t.t('ops5.form.minBreaches')}><input id="ch-min" name="minBreaches" className="kv-input" inputMode="numeric" pattern="\d{1,4}" /></Field>
        <Field id="ch-sub" label={t.t('ops5.form.subjectType')}>
          <select id="ch-sub" name="subjectType" className="kv-select" defaultValue="">
            <option value="">{t.t(kind ? 'ops5.form.keep' : 'ops5.form.everySubject')}</option>
            {(['bmc_unit', 'shipment', 'warehouse_chamber', 'vaccine_box'] as const).map((s) => <option key={s} value={s}>{t.t(`ops4.iot.type.${s}`)}</option>)}
          </select>
        </Field>
      </> : null}
      {kind === null || kind === 'device_silent'
        ? <Field id="ch-sil" label={t.t('ops5.form.silentHours')}><input id="ch-sil" name="silentHours" className="kv-input" inputMode="numeric" pattern="\d{1,3}" /></Field> : null}
      {kind === null || kind === 'maintenance_due' ? (
        <Field id="ch-mnt" label={t.t('ops5.form.maintenanceAlert')}>
          <select id="ch-mnt" name="maintenanceAlert" className="kv-select" defaultValue="">
            <option value="">{t.t(kind ? 'ops5.form.keep' : 'ops5.form.useDefault')}</option>
            {MAINTENANCE_ALERTS.map((a) => <option key={a} value={a}>{t.t(`ops5.alerts.th.maintenance.${a}`)}</option>)}
          </select>
        </Field>
      ) : null}
    </fieldset>
  );
}
export function ChangeFormError({ t, error }: { t: Tr; error: string | null }) {
  return error ? <p className="kv-error" role="alert" data-kv-form-error={error}>{t.t(`ops5.form.error.${error}`)}</p> : null;
}
export function ChangeForm({ t, rule, idemKey, action, error }: { t: Tr; rule: RuleRow; idemKey: string; action: Action; error: string | null }) {
  return (
    <div data-kv-change-form={rule.id}>
      <h2 data-kv-rule-name="">{rule.ruleName}</h2>
      <p>{t.t(kindKey(rule.kind))}{' · '}{th(t, rule.kind, rule.threshold)}{' · '}{t.t('ops5.alerts.people', { n: rule.recipientCount })}{' · '}
        {rule.cooldownMinutes === null ? t.t('ops5.alerts.unknown') : t.t('ops5.alerts.cooldown', { m: rule.cooldownMinutes })}{' · '}{t.t(rule.isActive ? 'ops5.alerts.active' : 'ops5.alerts.paused')}</p>
      <ChangeFormError t={t} error={error} />
      <form action={action} className="kv-card kv-form">
        <input type="hidden" name="id" value={rule.id} />
        <input type="hidden" name="key" value={idemKey} />
        <Field id="ch-on" label={t.t('ops5.form.onOff')}>
          <select id="ch-on" name="isActive" className="kv-select" defaultValue="">
            <option value="">{t.t('ops5.form.keep')}</option>
            <option value={rule.isActive ? 'pause' : 'resume'}>{t.t(rule.isActive ? 'ops5.form.pause' : 'ops5.form.resume')}</option>
          </select>
        </Field>
        <Field id="ch-name" label={t.t('ops5.form.ruleName')}><input id="ch-name" name="ruleName" className="kv-input" maxLength={150} /></Field>
        <Field id="ch-cd" label={t.t('ops5.form.cooldown')} hint={t.t('ops5.form.cooldownHint', { min: COOLDOWN_MIN, max: COOLDOWN_MAX })}>
          <input id="ch-cd" name="cooldownMinutes" className="kv-input" inputMode="numeric" pattern="\d{1,5}" />
        </Field>
        <Field id="ch-add" label={t.t('ops5.form.add')} hint={t.t('ops5.form.idsHint', { max: MAX_RECIPIENTS })}><textarea id="ch-add" name="add" className="kv-textarea" rows={2} /></Field>
        <Field id="ch-rm" label={t.t('ops5.form.remove')} hint={t.t('ops5.form.idsHint', { max: MAX_RECIPIENTS })}><textarea id="ch-rm" name="remove" className="kv-textarea" rows={2} /></Field>
        <ThresholdFields t={t} kind={rule.kind} />
        <Field id="ch-why" label={t.t('ops5.form.reason')}><textarea id="ch-why" name="reason" className="kv-textarea" rows={2} minLength={10} maxLength={500} required /></Field>
        <p className="kv-field__hint">{t.t('ops5.form.serverDecides')}</p>
        <div className="kv-form__actions"><button type="submit" className="kv-btn">{t.t('ops5.form.send')}</button></div>
      </form>
    </div>
  );
}
export function NewRuleForm({ t, idemKey, action, error }: { t: Tr; idemKey: string; action: Action; error: string | null }) {
  return (
    <div data-kv-change-form="new">
      <ChangeFormError t={t} error={error} />
      <form action={action} className="kv-card kv-form">
        <input type="hidden" name="key" value={idemKey} />
        <Field id="nr-kind" label={t.t('ops5.alerts.kindLabel')}>
          <select id="nr-kind" name="kind" className="kv-select" required>{ALERT_KINDS.map((k) => <option key={k} value={k}>{t.t(kindKey(k))}</option>)}</select>
        </Field>
        <Field id="nr-name" label={t.t('ops5.form.ruleName')}><input id="nr-name" name="ruleName" className="kv-input" minLength={3} maxLength={150} required /></Field>
        <ThresholdFields t={t} kind={null} />
        <Field id="nr-rcpt" label={t.t('ops5.form.people')} hint={t.t('ops5.form.idsHint', { max: MAX_RECIPIENTS })}><textarea id="nr-rcpt" name="recipients" className="kv-textarea" rows={3} required /></Field>
        <Field id="nr-cd" label={t.t('ops5.form.cooldown')} hint={t.t('ops5.form.cooldownHint', { min: COOLDOWN_MIN, max: COOLDOWN_MAX })}>
          <input id="nr-cd" name="cooldownMinutes" className="kv-input" inputMode="numeric" pattern="\d{1,5}" />
        </Field>
        <Field id="nr-why" label={t.t('ops5.form.reason')}><textarea id="nr-why" name="reason" className="kv-textarea" rows={2} minLength={10} maxLength={500} required /></Field>
        <p className="kv-field__hint">{t.t('ops5.form.newApplies')}</p>
        <div className="kv-form__actions"><button type="submit" className="kv-btn">{t.t('ops5.form.create')}</button></div>
      </form>
    </div>
  );
}
/** W3292 · the open proposal: confirm is offered ONLY to another person, withdraw ONLY to the proposer (the server refuses the rest by name). */
export function ProposalReview({ t, rule, idemKey, confirmAction, withdrawAction }: { t: Tr; rule: RuleRow | null; idemKey: string; confirmAction: Action; withdrawAction: Action }) {
  const c = rule?.openChange ?? null;
  if (!rule || !c) return <p className="kv-empty-state" data-kv-empty="proposal">{t.t('ops5.review.gone')}</p>;
  return (
    <div data-kv-proposal={c.id} data-kv-proposed-by-you={c.proposedByYou ? 'yes' : 'no'}>
      <h2 data-kv-rule-name="">{rule.ruleName}</h2>
      <p><span className="kv-badge">{t.t('ops5.alerts.proposedWaiting')}</span></p>
      <ul>{c.changes.map((x) => <li key={x.field}>{t.t(`ops5.alerts.change.${x.field}`)} — {t.t(`ops5.alerts.dir.${x.direction}`)}</li>)}</ul>
      <p>{t.t('ops5.alerts.proposedAt', { at: at(t, c.proposedAt) })}{' · '}{t.t(c.proposedByYou ? 'ops5.alerts.proposedByYou' : 'ops5.alerts.proposedByAnother')}</p>
      <p className="kv-muted">{t.t('ops5.review.reasonKept')}</p>
      {c.proposedByYou ? (
        <form action={withdrawAction} className="kv-inline-form" data-kv-offer="withdraw">
          <input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="rule" value={rule.id} /><input type="hidden" name="key" value={idemKey} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops5.review.withdrawBtn')}</button>
        </form>
      ) : (
        <form action={confirmAction} className="kv-inline-form" data-kv-offer="confirm">
          <input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="rule" value={rule.id} /><input type="hidden" name="key" value={idemKey} />
          <button type="submit" className="kv-btn">{t.t('ops5.review.confirmBtn')}</button>
        </form>
      )}
    </div>
  );
}
/** W3293 · what the SERVER did. */
export function ChangeDoneNote({ t, done }: { t: Tr; done: ChangeDone | null }) {
  return <p className="kv-success" data-kv-done={done ?? 'unknown'}>{t.t(done ? `ops5.done.${done}` : 'ops5.done.unknown')}</p>;
}
/** W3294 · the refusal by name; Retry is the act again on the same rule. */
export function ChangeFailureNote({ t, reason, retryHref }: { t: Tr; reason: ChangeFailure; retryHref: string }) {
  return (
    <>
      <p className="kv-error" role="alert" data-kv-failure={reason}>{t.t(`ops5.failure.${reason}`)}</p>
      <p className="kv-pager"><Link className="kv-btn" href={retryHref} data-kv-real="retry">{t.t('ops5.chain.retry')}</Link></p>
    </>
  );
}

// ══ W403 · /iot/alert-incident?id= ══
export interface AlertIncidentProps { t: Tr; lang: string; state: IotState | 'notFound'; id: string | null; breach: ColdBreach | null }
export function AlertIncidentView({ t, lang, state, id, breach }: AlertIncidentProps) {
  if (state === 'off' || state === 'forbidden') return <NotShown t={t} state={state} page="incident" />;
  const self = id ? incidentHref(id) : ALERTS.incident;
  const b = breach;
  const dur = b ? durationParts(b.durationSeconds) : null;
  const loss = b ? lossOf(b.loss) : null;
  return (
    <section data-kv-ops5="alert-incident" data-kv-state={state}>
      <h1>{t.t('ops5.incident.title')}</h1>
      <p className="kv-muted" data-kv-statement="ops5.incident.signedIn">{t.t('ops5.incident.signedIn')}</p>
      <p className="kv-statement" data-kv-statement="ops5.q1.words">{t.t('ops5.q1.words')}</p>
      {state === 'notFound' || (state === 'ok' && !b) ? (
        <div className="kv-empty-state" data-kv-empty="breach"><h2>{t.t('ops5.incident.notFound.title')}</h2><p>{t.t('ops5.incident.notFound.body')}</p></div>
      ) : state === 'error' || !b ? <ReadError t={t} href={`${self}${self.includes('?') ? '&' : '?'}act=confirm`} /> : (
        <>
          <h2 data-kv-breach={b.id}>{t.t('ops5.incident.subject', { type: t.t(`ops4.iot.type.${b.subjectType}`), ref: b.subjectRef })}</h2>
          <p className="kv-muted" data-kv-statement="ops4.iot.breachRule">{t.t('ops4.iot.breachRule')}</p>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('ops5.incident.band')}</dt><dd data-kv-band={`${b.band.minC}|${b.band.maxC}`}>{t.t('ops4.iot.bandText', { min: b.band.minC, max: b.band.maxC })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops5.incident.peak')}</dt><dd data-kv-peak={b.peakC}>{t.t('ops5.incident.peakText', { peak: b.peakC, direction: t.t(`ops4.iot.direction.${b.direction}`), n: b.readingsOut })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops5.incident.logger')}</dt><dd>{b.device ? t.t('ops4.iot.loggerSerial', { serial: b.device.serial ?? t.t('ops4.iot.serialUnknown') }) : t.t('ops4.iot.noLogger')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops5.incident.duration')}</dt><dd data-kv-duration={b.durationSeconds ?? 'open'}>
              {b.closedAt ? (dur ? t.t('ops5.incident.durationText', { min: dur.min, sec: dur.sec }) : t.t('ops5.alerts.unknown')) : t.t('ops5.incident.stillOpen')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops5.incident.alert')}</dt><dd data-kv-alert-state={b.alert.state} data-kv-told={b.alert.recipients}>
              {b.alert.state === 'alerted' ? t.t('ops5.incident.alerted', { n: b.alert.recipients }) : t.t('ops5.incident.noRecipient')}</dd></div>
          </dl>
          <h3>{t.t('ops5.incident.timeline')}</h3>
          <ol className="kv-list" data-kv-timeline={timeline(b).length}>
            {timeline(b).map((s) => <li key={s.step} data-kv-step={s.step}>{t.t(`ops5.incident.step.${s.step}`, { at: at(t, s.at) })}</li>)}
          </ol>
          <h3>{t.t('ops5.incident.acts')}</h3>
          <ul className="kv-list" data-kv-acts="">
            <li data-kv-act-recorded="acknowledge">{b.acknowledgedAt ? t.t('ops5.incident.ackAt', { at: at(t, b.acknowledgedAt) }) : t.t('ops5.incident.ackNone')}</li>
            <li data-kv-act-recorded="record_action" data-kv-note={b.actionNote ? 'exists' : 'none'}>
              {b.actionAt ? t.t(b.actionNote ? 'ops5.incident.actionAtWithNote' : 'ops5.incident.actionAt', { at: at(t, b.actionAt) }) : t.t('ops5.incident.actionNone')}</li>
            <li data-kv-act-recorded="record_outcome" data-kv-outcome={b.outcome ?? 'none'} data-kv-reason={b.outcomeReason ? 'exists' : 'none'}>
              {b.outcome ? <>{t.t('ops5.incident.outcomeAt', { outcome: t.t(outcomeKey(b.outcome)), at: at(t, b.outcomeAt) })}{b.outcomeReason ? <>{' '}{t.t('ops5.incident.reasonKept')}</> : null}</> : t.t('ops5.incident.outcomeNone')}</li>
            {b.outcome === 'loss_recorded' ? (
              <li data-kv-loss={loss ? `${loss.minor}|${loss.currency}` : 'unreadable'}>
                {loss ? t.t('ops5.incident.loss', { amount: formatMoneyMinor(loss.minor, loss.currency, lang) }) : t.t('ops5.incident.lossUnreadable')}</li>
            ) : null}
          </ul>
          <h3>{t.t('ops5.incident.buyer')}</h3>
          <p data-kv-buyer={b.buyer.offerState} data-kv-buyer-reason={b.buyer.reason ? 'exists' : 'none'}>
            {b.buyer.offerState === 'none' ? t.t('ops5.incident.buyerNone')
              : b.buyer.offerState === 'offered' ? t.t('ops5.incident.buyerOffered', { at: at(t, b.buyer.offeredAt) })
              : t.t('ops5.incident.buyerDecided', { decision: t.t(decisionKey(b.buyer.decision)), at: at(t, b.buyer.decidedAt) })}
            {b.buyer.disputeId ? <>{' '}{t.t('ops5.incident.disputeOpened')}</> : null}
          </p>
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`${self}&act=confirm`} data-kv-chain-link="retry">{t.t('ops5.incident.retry')}</Link></p>
        </>
      )}
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={ALERTS.rules} data-kv-edge="W402">{t.t('ops5.incident.backToRules')}</Link></p>
      <Ops5Refusals t={t} surface="alert_incident" />
    </section>
  );
}
