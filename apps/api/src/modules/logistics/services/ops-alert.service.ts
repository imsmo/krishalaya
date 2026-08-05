// modules/logistics/services/ops-alert.service.ts · PC-55 A6. Rules CRUD + the evaluator.
// THE CONSTRAINT THAT SHAPED THIS (from the A6 order): the evaluator writes to the EXISTING notification spine
// and adds NO delivery channel. So firing an alert = ONE outbox event ('ops.alert_fired'); communication's
// DomainEventFanoutHandler + the seeded catalog row carry it to each recipient's own channels, honouring their
// preferences and QUIET HOURS. An urgent alert is still not permitted to bypass a human's consent (Rule Zero).
// The fired-log row is written in the SAME tx as the outbox event, so "we paged someone" and "we recorded that
// we paged someone" can never disagree.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { OpsAlertRepository, AlertRule } from '../repositories/ops-alert.repository';
import { validateThreshold, defaultsFor, dedupeKey, severityFor, alertTitle, type AlertKind } from '../domain/ops-alert.rules';

export interface AlertActor { userId: string; canManage: boolean }

@Injectable()
export class OpsAlertService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly repo: OpsAlertRepository,
  ) {}
  private assert(a: AlertActor) { if (!a.canManage) throw new ForbiddenError('requires logistics.manage'); }

  async createRule(tenantId: string, a: AlertActor, dto: { kind: AlertKind; ruleName: string; threshold?: Record<string, unknown>; recipientUserIds: string[]; channelHint?: string; cooldownMinutes?: number }) {
    this.assert(a);
    const threshold = { ...defaultsFor(dto.kind), ...(dto.threshold ?? {}) };
    const v = validateThreshold(dto.kind, threshold);
    if (!v.ok) throw new BadRequestError(v.error);
    if (dto.recipientUserIds.length === 0) throw new BadRequestError('a rule with no recipients would page nobody — name at least one user');
    const id = uuidv7();
    const res = await this.uow.run(tenantId, (tx) => this.repo.insertRule(tx, {
      id, tenantId, kind: dto.kind, ruleName: dto.ruleName, threshold,
      recipientUserIds: dto.recipientUserIds, channelHint: dto.channelHint, cooldownMinutes: dto.cooldownMinutes ?? 60,
    }), { userId: a.userId });
    if (!res.ok) throw new ConflictError(`a rule named '${dto.ruleName}' already exists`);
    return { id, kind: dto.kind, threshold };
  }

  async updateRule(tenantId: string, a: AlertActor, id: string, patch: { ruleName?: string; threshold?: Record<string, unknown>; recipientUserIds?: string[]; channelHint?: string | null; cooldownMinutes?: number; isActive?: boolean }) {
    this.assert(a);
    if (patch.threshold) {
      const rules = await this.repo.listRules(tenantId);
      const existing = rules.find((r) => r.id === id);
      if (!existing) throw new NotFoundError('rule not found');
      const v = validateThreshold(existing.kind as AlertKind, patch.threshold);
      if (!v.ok) throw new BadRequestError(v.error);
    }
    if (patch.recipientUserIds && patch.recipientUserIds.length === 0) throw new BadRequestError('a rule must keep at least one recipient');
    const ok = await this.uow.run(tenantId, (tx) => this.repo.updateRule(tx, tenantId, id, patch), { userId: a.userId });
    if (!ok) throw new NotFoundError('rule not found');
    return { id };
  }

  rules(tenantId: string, a: AlertActor, q: { kind?: string; activeOnly?: boolean }) { this.assert(a); return this.repo.listRules(tenantId, q); }
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
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'ops_alert', aggregateId: id, eventType: 'ops.alert_fired',
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
  private async evidenceFor(tenantId: string, rule: AlertRule): Promise<Array<{ subjectType: string | null; subjectRef: string | null; severity: string; detail: Record<string, unknown>; body: string }>> {
    const t = rule.threshold as Record<string, number | string | undefined>;
    if (rule.kind === 'cold_chain_breach') {
      const windowHours = Number(t.windowHours ?? 6);
      const minBreaches = Number(t.minBreaches ?? 1);
      const rows = await this.repo.coldChainBreachCounts(tenantId, windowHours, t.subjectType as string | undefined);
      return rows.filter((r) => r.breaches >= minBreaches).map((r) => ({
        subjectType: r.subjectType, subjectRef: r.deviceRef ?? r.subjectId,
        severity: severityFor('cold_chain_breach', { breaches: r.breaches }),
        detail: { breaches: r.breaches, windowHours, lastTempC: r.lastTempC, lastAt: r.lastAt, subjectId: r.subjectId },
        body: `${r.breaches} temperature breach(es) in the last ${windowHours}h on ${r.subjectType} ${r.deviceRef ?? r.subjectId} (last ${r.lastTempC ?? '?'}°C).`,
      }));
    }
    if (rule.kind === 'device_silent') {
      const silentHours = Number(t.silentHours ?? 12);
      const rows = await this.repo.silentDevices(tenantId, silentHours);
      return rows.map((r) => ({
        subjectType: 'device', subjectRef: r.deviceRef,
        severity: severityFor('device_silent', { silentHours: r.silentHours }),
        detail: { lastSeen: r.lastSeen, silentHours: r.silentHours, thresholdHours: silentHours },
        body: `Sensor ${r.deviceRef} has not reported for ~${r.silentHours}h (last seen ${r.lastSeen}).`,
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
