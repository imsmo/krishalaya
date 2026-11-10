// modules/logistics/services/ops-alert.service.ts · PC-55 A6. Rules CRUD + the evaluator.
// THE CONSTRAINT THAT SHAPED THIS (from the A6 order): the evaluator writes to the EXISTING notification spine
// and adds NO delivery channel. So firing an alert = ONE outbox event ('ops.alert_fired'); communication's
// DomainEventFanoutHandler + the seeded catalog row carry it to each recipient's own channels, honouring their
// preferences and QUIET HOURS. An urgent alert is still not permitted to bypass a human's consent (Rule Zero).
// The fired-log row is written in the SAME tx as the outbox event, so "we paged someone" and "we recorded that
// we paged someone" can never disagree.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { OpsAlertRepository, AlertRule, AlertRuleChange } from '../repositories/ops-alert.repository';
import { LogisticsOpsRefusedError } from '../domain/logistics.errors';
import {
  validateThreshold, defaultsFor, dedupeKey, severityFor, alertTitle, outboxTypeFor, silenceText, silentMinutesOf, classifyRuleChange,
  type AlertKind, type AlertSeverity, type AlertRuleState,
} from '../domain/ops-alert.rules';

export interface AlertActor { userId: string; canManage: boolean; ip?: string | null }
export type AlertRulePatch = { ruleName?: string; threshold?: Record<string, unknown>; recipientUserIds?: string[]; channelHint?: string | null; cooldownMinutes?: number; isActive?: boolean; reason?: string };
export type AlertRuleCreate = { kind: AlertKind; ruleName: string; threshold?: Record<string, unknown>; recipientUserIds: string[]; channelHint?: string; cooldownMinutes?: number; reason?: string };

/** The rule's movable fields — 0237's projection, key for key (the guard compares a change row's `after` to exactly this). */
export const stateOf = (r: AlertRule): AlertRuleState => ({
  ruleName: r.ruleName, threshold: r.threshold ?? {}, recipientUserIds: [...(r.recipientUserIds ?? [])],
  channelHint: r.channelHint ?? null, cooldownMinutes: r.cooldownMinutes, isActive: r.isActive,
});
/** Canonical JSON (sorted keys) — "the rule moved since the proposal" is a deep comparison, never a reference one. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o: Record<string, unknown>, k) => { o[k] = (x as Record<string, unknown>)[k]; return o; }, {}) : x));
export const sameState = (a: AlertRuleState, b: AlertRuleState) => canon(a) === canon(b);

const REASON_MIN = 10;
const refuse = (code: string, message: string, status: number, details: Record<string, unknown> = {}) => new LogisticsOpsRefusedError(code, message, status, details);

@Injectable()
export class OpsAlertService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly repo: OpsAlertRepository,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
  ) {}
  private assert(a: AlertActor) { if (!a.canManage) throw new ForbiddenError('requires logistics.manage'); }
  private reasonOf(raw: string | undefined): string {
    const reason = (raw ?? '').trim();
    if (reason.length < REASON_MIN) throw refuse('REASON_REQUIRED', 'A reason of at least 10 characters is recorded with every alert rule change', 422);
    return reason;
  }
  /** F-10 (PC-56 HOTFIX-14): a rule names only active members of this organisation — the notification spine itself checks no membership. */
  private async assertMembers(tenantId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const outsiders = await this.repo.nonMembers(tenantId, userIds);   // a read — before the idempotency record and the unit of work (E12)
    if (outsiders.length > 0) throw refuse('ALERT_RECIPIENT_NOT_MEMBER', 'An alert rule names only people who are members of this organisation', 422, { count: outsiders.length });
  }

  /**
   * PC-56 HOTFIX-14 (OPS5-B1): a NEW rule makes alerting louder, so it applies at once — keyed, strictly validated, recorded (an
   * `audit_log` row with the rule as made and the reason; `created_by`/`updated_by` written). Every refusal is BEFORE the idempotency
   * record (E12).
   */
  async createRule(tenantId: string, a: AlertActor, key: string, dto: AlertRuleCreate) {
    this.assert(a);
    const reason = this.reasonOf(dto.reason);
    const threshold = { ...defaultsFor(dto.kind), ...(dto.threshold ?? {}) };
    const v = validateThreshold(dto.kind, threshold);
    if (!v.ok) throw new BadRequestError(v.error);
    if (dto.recipientUserIds.length === 0) throw new BadRequestError('a rule with no recipients would page nobody — name at least one user');
    const recipients = [...new Set(dto.recipientUserIds)];
    await this.assertMembers(tenantId, recipients);
    return this.idem.remember(key, a.userId, 'logistics.alert_rule_create', () => this.uow.run(tenantId, async (tx) => {
      const id = uuidv7();
      const state: AlertRuleState = { ruleName: dto.ruleName, threshold, recipientUserIds: recipients, channelHint: dto.channelHint ?? null, cooldownMinutes: dto.cooldownMinutes ?? 60, isActive: true };
      const res = await this.repo.insertRule(tx, { id, tenantId, kind: dto.kind, ruleName: dto.ruleName, threshold, recipientUserIds: recipients, channelHint: dto.channelHint, cooldownMinutes: state.cooldownMinutes, by: a.userId });
      if (!res.ok) throw new ConflictError(`a rule named '${dto.ruleName}' already exists`);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.alert_rule_created', entityType: 'ops_alert_rule', entityId: id,
        oldValue: null, newValue: { kind: dto.kind, ...state }, reason, ip: a.ip ?? null });
      return { id, kind: dto.kind, threshold, status: 'applied' as const };
    }, { userId: a.userId }));
  }

  /**
   * PC-56 HOTFIX-14 · NOBODY SILENCES THE ALARM ALONE (OPS5-B1 + OPS5-B2, OPS-5 Q3-A). An edit is classified field by field
   * (`classifyRuleChange`): a change that could make an alert QUIETER (a pause, a person removed, a threshold loosened, a longer
   * cooldown — or any mix containing one) becomes a PROPOSAL — the rule is untouched and keeps alerting until ANOTHER `logistics.manage`
   * holder confirms it; a change that can only make alerting LOUDER (or names nothing that decides who is told) applies at once. Both
   * are keyed and recorded with their before/after and the reason. Refusals by name, before the idempotency record (E12); the locked
   * row is re-judged inside the transaction, and 0237's guard refuses a quieter UPDATE that no confirmed change row matches.
   */
  async updateRule(tenantId: string, a: AlertActor, key: string, id: string, patch: AlertRulePatch) {
    this.assert(a);
    const reason = this.reasonOf(patch.reason);
    const existing = await this.repo.findRule(tenantId, id);
    if (!existing) throw new NotFoundError('rule not found');
    const kind = existing.kind as AlertKind;
    if (patch.threshold) {
      const v = validateThreshold(kind, patch.threshold);
      if (!v.ok) throw new BadRequestError(v.error);
    }
    if (patch.recipientUserIds && patch.recipientUserIds.length === 0) throw new BadRequestError('a rule must keep at least one recipient');
    const plan = (rule: AlertRule) => {
      const before = stateOf(rule);
      const after: AlertRuleState = {
        ruleName: patch.ruleName ?? before.ruleName,
        threshold: patch.threshold ?? before.threshold,
        recipientUserIds: patch.recipientUserIds ? [...new Set(patch.recipientUserIds)] : before.recipientUserIds,
        // F-11: `channelHint: null` CLEARS it (the old COALESCE could not); an absent key keeps it.
        channelHint: 'channelHint' in patch ? patch.channelHint ?? null : before.channelHint,
        cooldownMinutes: patch.cooldownMinutes ?? before.cooldownMinutes,
        isActive: patch.isActive ?? before.isActive,
      };
      return { before, after, ...classifyRuleChange(kind, before, after) };
    };
    const first = plan(existing);
    await this.assertMembers(tenantId, first.after.recipientUserIds.filter((u) => !first.before.recipientUserIds.includes(u)));
    // ALERT_RULE_CHANGE_ALREADY_OPEN depends on STATE the first call itself creates, so it is judged INSIDE the idempotency record, on the
    // locked rule (the HOTFIX-13 precedent): a retried request replays its own 202, a different request is refused and its claim released.

    return this.idem.remember(key, a.userId, 'logistics.alert_rule_update', () => this.uow.run(tenantId, async (tx) => {
      const rule = await this.repo.findRule(tenantId, id, tx, true);
      if (!rule) throw new NotFoundError('rule not found');
      const p = plan(rule);
      if (p.verdict === 'propose') {
        if (await this.repo.openChangeFor(tenantId, id, tx)) throw this.alreadyOpen();
        const changeId = uuidv7();
        await this.repo.insertChange(tx, { id: changeId, tenantId, ruleId: id, before: p.before, after: p.after, reason, by: a.userId });
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.alert_rule_change_proposed', entityType: 'ops_alert_rule', entityId: id,
          oldValue: p.before, newValue: { ...p.after, changeId, changes: p.changes }, reason, ip: a.ip ?? null });
        return { id, status: 'proposed' as const, changeId, changes: p.changes };
      }
      const ok = await this.repo.updateRule(tx, tenantId, id, p.after, a.userId);
      if (!ok) throw new NotFoundError('rule not found');
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.alert_rule_updated', entityType: 'ops_alert_rule', entityId: id,
        oldValue: p.before, newValue: { ...p.after, changes: p.changes }, reason, ip: a.ip ?? null });
      return { id, status: 'applied' as const, changes: p.changes };
    }, { userId: a.userId }));
  }
  private alreadyOpen() { return refuse('ALERT_RULE_CHANGE_ALREADY_OPEN', 'This rule already has a proposed change waiting for a second person', 409); }

  /** WHO may confirm — a fact of the person, stable across a retry, so it is refused BEFORE the idempotency record (E12) and again inside. */
  private assertNotProposer(change: AlertRuleChange | null, me: string): asserts change is AlertRuleChange {
    if (!change) throw refuse('ALERT_RULE_CHANGE_NOT_FOUND', 'That proposed change does not exist in this organisation', 404);
    if (change.proposedBy === me) throw refuse('ALERT_RULE_CONFIRMER_IS_PROPOSER', 'A second person confirms this change — not the person who proposed it', 403);
  }
  /** The full set, on the LOCKED rows inside the idempotency record: the state refusals (still open; the rule unmoved) depend on what a first
   *  call writes, so judging them before the record would answer a retried confirmation "not open" instead of replaying it (HOTFIX-13). */
  private assertConfirmable(change: AlertRuleChange | null, rule: AlertRule | null, me: string): asserts change is AlertRuleChange {
    this.assertNotProposer(change, me);
    if (change.state !== 'proposed') throw refuse('ALERT_RULE_CHANGE_NOT_OPEN', `That change is no longer waiting (it is ${change.state})`, 409);
    if (!rule || !sameState(stateOf(rule), change.before)) {
      throw refuse('ALERT_RULE_CHANGED_SINCE_PROPOSAL', 'The rule has changed since this was proposed; nothing was overwritten — withdraw it and propose again', 409);
    }
  }

  /** PC-56 HOTFIX-14: a SECOND `logistics.manage` holder confirms — the rule becomes the proposal's `after`, in the same transaction. */
  async confirmChange(tenantId: string, a: AlertActor, key: string, changeId: string) {
    this.assert(a);
    this.assertNotProposer(await this.repo.findChange(tenantId, changeId), a.userId);
    return this.idem.remember(key, a.userId, 'logistics.alert_rule_change_confirm', () => this.uow.run(tenantId, async (tx) => {
      const change = await this.repo.findChange(tenantId, changeId, tx, true);
      const rule = change ? await this.repo.findRule(tenantId, change.ruleId, tx, true) : null;
      this.assertConfirmable(change, rule, a.userId);
      if (!(await this.repo.confirmChange(tx, tenantId, changeId, a.userId))) throw refuse('ALERT_RULE_CHANGE_NOT_OPEN', 'That change is no longer waiting', 409);
      if (!(await this.repo.updateRule(tx, tenantId, change.ruleId, change.after, a.userId))) throw new NotFoundError('rule not found');
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.alert_rule_change_confirmed', entityType: 'ops_alert_rule', entityId: change.ruleId,
        oldValue: change.before, newValue: { ...change.after, changeId, proposedBy: change.proposedBy }, reason: change.reason, ip: a.ip ?? null });
      return { id: changeId, ruleId: change.ruleId, state: 'confirmed' as const };
    }, { userId: a.userId }));
  }

  /** PC-56 HOTFIX-14: the PROPOSER withdraws their own proposal (the rule never moved; it keeps alerting as it was). */
  async withdrawChange(tenantId: string, a: AlertActor, key: string, changeId: string) {
    this.assert(a);
    const mine = (c: AlertRuleChange | null): AlertRuleChange => {
      if (!c) throw refuse('ALERT_RULE_CHANGE_NOT_FOUND', 'That proposed change does not exist in this organisation', 404);
      if (c.proposedBy !== a.userId) throw refuse('ALERT_RULE_WITHDRAW_NOT_PROPOSER', 'Only the person who proposed this change can withdraw it', 403);
      return c;
    };
    mine(await this.repo.findChange(tenantId, changeId));   // who — before the idempotency record (E12)
    return this.idem.remember(key, a.userId, 'logistics.alert_rule_change_withdraw', () => this.uow.run(tenantId, async (tx) => {
      const c = mine(await this.repo.findChange(tenantId, changeId, tx, true));
      if (c.state !== 'proposed') throw refuse('ALERT_RULE_CHANGE_NOT_OPEN', `That change is no longer waiting (it is ${c.state})`, 409);
      if (!(await this.repo.withdrawChange(tx, tenantId, changeId, a.userId))) throw refuse('ALERT_RULE_CHANGE_NOT_OPEN', 'That change is no longer waiting', 409);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.alert_rule_change_withdrawn', entityType: 'ops_alert_rule', entityId: c.ruleId,
        oldValue: { changeId, state: 'proposed' }, newValue: { changeId, state: 'withdrawn' }, reason: null, ip: a.ip ?? null });
      return { id: changeId, ruleId: c.ruleId, state: 'withdrawn' as const };
    }, { userId: a.userId }));
  }

  private changeWire(kind: AlertKind, c: AlertRuleChange, me: string) {
    return { id: c.id, ruleId: c.ruleId, state: c.state, before: c.before, after: c.after, reason: c.reason,
      changes: classifyRuleChange(kind, c.before, c.after).changes,
      proposedBy: c.proposedBy, proposedByYou: c.proposedBy === me, proposedAt: c.proposedAt,
      confirmedBy: c.confirmedBy, confirmedAt: c.confirmedAt, withdrawnAt: c.withdrawnAt };
  }
  /** GET …/alert-rules/:id/changes — every proposal on one rule and how it ended (read). */
  async changes(tenantId: string, a: AlertActor, ruleId: string) {
    this.assert(a);
    const rule = await this.repo.findRule(tenantId, ruleId);
    if (!rule) throw new NotFoundError('rule not found');
    return (await this.repo.listChanges(tenantId, ruleId)).map((c) => this.changeWire(rule.kind as AlertKind, c, a.userId));
  }

  /** The rules, each with its OPEN proposal if any (so the console can offer confirm to another person and withdraw to the proposer). */
  async rules(tenantId: string, a: AlertActor, q: { kind?: string; activeOnly?: boolean }) {
    this.assert(a);
    const [rules, open] = await Promise.all([this.repo.listRules(tenantId, q), this.repo.openChanges(tenantId)]);
    const byRule = new Map(open.map((c) => [c.ruleId, c]));
    return rules.map((r) => {
      const c = byRule.get(r.id);
      return { ...r, openChange: c ? this.changeWire(r.kind as AlertKind, c, a.userId) : null };
    });
  }
  /** [HOTFIX-1] The PUBLIC read another module may call for "who would be told" (dairy's BMC monitor, W170). The
   *  caller has already enforced its own permission; this exists so no module reaches into OpsAlertRepository —
   *  which LogisticsModule never exported, so `DairyBmcReadModel` could not be constructed and the API could not boot.
   *  PC-56 HOTFIX-14 (F-2): it takes the same filter as the rule list, so the cooler monitor can ask for ACTIVE rules only. */
  listRules(tenantId: string, q: { kind?: string; activeOnly?: boolean } = {}): Promise<AlertRule[]> { return this.repo.listRules(tenantId, q); }
  feed(tenantId: string, a: AlertActor, q: { kind?: string; severity?: string; unacknowledgedOnly?: boolean; limit: number }) { this.assert(a); return this.repo.feed(tenantId, q); }

  async acknowledge(tenantId: string, a: AlertActor, id: string) {
    this.assert(a);
    const ok = await this.uow.run(tenantId, (tx) => this.repo.acknowledge(tx, tenantId, id, a.userId), { userId: a.userId });
    if (!ok) throw new ConflictError('alert not found or already acknowledged');
    return { id, acknowledged: true };
  }

  /** EVALUATE one tenant's active rules against the ledgered read-models. Called by the cadence job (and
   *  available as a Manage-gated "run now" so an operator can test a rule they just wrote). */
  async evaluateTenant(tenantId: string, actorUserId = 'system'): Promise<{ evaluated: number; fired: number; suppressed: number }> {
    const rules = await this.repo.activeRulesForTenant(tenantId);
    if (rules.length === 0) return { evaluated: 0, fired: 0, suppressed: 0 };
    const now = Date.now();
    let fired = 0, suppressed = 0;

    for (const rule of rules) {
      const hits = await this.evidenceFor(tenantId, rule);
      for (const hit of hits) {
        const key = dedupeKey(rule.id, hit.subjectRef, now, rule.cooldownMinutes);
        const wrote = await this.uow.run(tenantId, async (tx) => {
          const id = uuidv7();
          const created = await this.repo.recordFired(tx, {
            id, tenantId, ruleId: rule.id, kind: rule.kind, severity: hit.severity,
            subjectType: hit.subjectType, subjectRef: hit.subjectRef, detail: hit.detail,
            recipients: rule.recipientUserIds, dedupeKey: key, notified: true,
          });
          if (!created) return false;                     // cooldown bucket already fired — stay quiet
          // ONE outbox event; the notification spine owns delivery, preferences and quiet hours.
          // THE EVENT TYPE CARRIES THE SEVERITY (TENANT-6d-5), because quiet hours are decided by the CATALOGUE
          // event's priority and `ops.alert_fired` is catalogued `important` — so every critical alert this service has
          // ever raised was suppressed on push, SMS and voice between a recipient's quiet hours. A warm tank at 02:00
          // now travels as a critical event; a maintenance reminder still waits for morning.
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'ops_alert', aggregateId: id, eventType: outboxTypeFor(hit.severity),
            payload: {
              v: 1, alertId: id, ruleId: rule.id, ruleName: rule.ruleName, kind: rule.kind,
              severity: hit.severity, subjectType: hit.subjectType, subjectRef: hit.subjectRef,
              title: alertTitle(rule.kind as AlertKind), body: hit.body,
              channelHint: rule.channelHint, recipientUserIds: rule.recipientUserIds, detail: hit.detail,
            },
          });
          return true;
        }, { userId: actorUserId });
        if (wrote) fired++; else suppressed++;
      }
    }
    await this.uow.run(tenantId, (tx) => this.repo.touchEvaluated(tx, tenantId, rules.map((r) => r.id)), { userId: actorUserId });
    return { evaluated: rules.length, fired, suppressed };
  }

  /** Turn a rule into concrete hits, reading ONLY the W54-12 ledgered models. */
  // `severity` is the TYPED union rather than `string` (TENANT-6d-5): it now decides which catalogued event carries the
  // alert — and therefore whether it may wake somebody — so the compiler, not a runtime string compare, is what
  // guarantees only a real severity reaches that decision.
  private async evidenceFor(tenantId: string, rule: AlertRule): Promise<Array<{ subjectType: string | null; subjectRef: string | null; severity: AlertSeverity; detail: Record<string, unknown>; body: string }>> {
    const t = rule.threshold as Record<string, number | string | undefined>;
    if (rule.kind === 'cold_chain_breach') {
      const windowHours = Number(t.windowHours ?? 6);
      const minBreaches = Number(t.minBreaches ?? 1);
      const rows = await this.repo.coldChainBreachCounts(tenantId, windowHours, t.subjectType as string | undefined);
      return rows.filter((r) => r.breaches >= minBreaches).map((r) => ({
        subjectType: r.subjectType, subjectRef: r.deviceRef ?? r.subjectId,
        severity: severityFor('cold_chain_breach', { breaches: r.breaches }),
        detail: { breaches: r.breaches, windowHours, lastTempC: r.lastTempC, lastAt: r.lastAt, subjectId: r.subjectId },
        // PC-56 TENANT-SW-e: a RULE counts OUT-OF-BAND READINGS (the rows' own excursion flag, against the band copied at write) — the
        // operator chose the count. A BREACH is a different object (two consecutive DEVICE readings, opened and alerted by the database).
        body: `${r.breaches} out-of-band reading(s) in the last ${windowHours}h on ${r.subjectType} ${r.deviceRef ?? r.subjectId} (last ${r.lastTempC ?? '?'}°C).`,
      }));
    }
    if (rule.kind === 'device_silent') {
      // MINUTES, through the one function that knows both units (TENANT-6d-5). The threshold is reported alongside the
      // measured gap so the notification says what it was judged against, not just that it happened.
      const silentMinutes = silentMinutesOf(rule.threshold as Record<string, unknown>);
      const rows = await this.repo.silentDevices(tenantId, silentMinutes);
      // PC-56 OPS-4c (E13): a REGISTERED LOGGER, by its serial, judged on its SIGNED readings only (the repository) — never a typed reference.
      return rows.map((r) => ({
        subjectType: 'device', subjectRef: r.serial,
        severity: severityFor('device_silent', { silentMinutes: r.silentMinutes }),
        detail: { deviceId: r.deviceId, lastSeen: r.lastSeen, silentMinutes: r.silentMinutes, thresholdMinutes: silentMinutes },
        body: `Logger ${r.serial} has not reported for ${silenceText(r.silentMinutes)} (last signed reading received ${r.lastSeen}).`,
      }));
    }
    const which = String(t.alert ?? 'any');
    const rows = await this.repo.maintenanceAlerts(tenantId, which);
    return rows.map((r) => ({
      subjectType: 'equipment_asset', subjectRef: r.assetId,
      severity: severityFor('maintenance_due', { alert: r.alert }),
      detail: { alert: r.alert, lastServiceOn: r.lastServiceOn },
      body: r.alert === 'needs_attention'
        ? `Machine ${r.assetId} reported a breakdown and needs attention.`
        : `Machine ${r.assetId} is due for service (last service ${r.lastServiceOn ?? 'never recorded'}).`,
    }));
  }
}
