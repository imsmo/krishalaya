// apps/admin-api/src/modules/compliance-ops/services/breach-response-console.service.ts · the DPDP §8 breach
// console. Open a breach incident and drive it through the lifecycle (open→contained→notified→closed). One ACID
// tx per write; every transition writes an append-only audit_log row IN THE SAME TX (§4). "notify" requires BOTH
// the regulator + data-principal notification timestamps (DPDP §8) — the controller validates their presence and
// the entity stamps them. The incident record stores affected-data CATEGORIES only — never raw PII.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ComplianceRepository, BreachListQuery } from '../repositories/compliance.repository';
import { Breach } from '../domain/breach.entity';
import {
  BreachNotFoundError, InvalidBreachUpdateError, BreachNotificationIncompleteError, BreachSignOffRequiredError,
  BreachStepNotFoundError,
} from '../domain/compliance-ops.errors';
import { assertNotifiable, assertStep, checklist, notifyClock, containmentMinutes, totalReached, unreached } from '../domain/breach-notification';
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { OpenBreachDto, UpdateBreachDto } from '../dto/compliance-ops.dto';

@Injectable()
export class BreachResponseConsoleService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: ComplianceRepository) {}

  async open(actor: AdminRequestContext, dto: OpenBreachDto) {
    const breach = Breach.rehydrate({
      id: randomUUID(), affectedTenantId: dto.affectedTenantId ?? null, status: 'open', severity: dto.severity,
      title: dto.title, affectedCount: dto.affectedCount, detectedAt: new Date(dto.detectedAt),
      containedAt: null, regulatorNotifiedAt: null, principalsNotifiedAt: null, closedAt: null, resolutionNote: null,
    });
    return this.pool.withTx(async (client) => {
      await this.repo.insertBreach(client, breach, actor.userId, dto.description, dto.affectedData, actor.userId);
      const p = breach.toJSON();
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.breach_opened', entityType: 'data_breach', entityId: p.id,
        newValue: { severity: p.severity, affectedCount: p.affectedCount, affectedTenantId: p.affectedTenantId }, reason: dto.title, ip: actor.ip, requestId: actor.requestId || null });
      return p;
    });
  }

  async update(actor: AdminRequestContext, id: string, dto: UpdateBreachDto) {
    return this.pool.withTx(async (client) => {
      const breach = await this.repo.getBreachForUpdate(client, id);
      if (!breach) throw new BreachNotFoundError(id);
      const before = breach.status;
      let change;
      if (dto.action === 'contain') {
        change = breach.contain();
      } else if (dto.action === 'notify') {
        if (!dto.regulatorNotifiedAt || !dto.principalsNotifiedAt) {
          throw new InvalidBreachUpdateError('notify requires both regulatorNotifiedAt and principalsNotifiedAt (DPDP §8)');
        }
        // ADMIN-5c: THE TWO TIMESTAMPS ARE NO LONGER SUFFICIENT. They are strings the operator typed, and on their own
        // they let the register state that the Data Protection Board was notified with nothing behind it. W043 requires
        // all three acts evidenced plus a DPO sign-off, and both are checked here, inside the same transaction as the
        // status move, against a locked read of the evidence table.
        const steps = await this.repo.notificationStepsForUpdate(client, id);
        const signOff = await this.repo.breachSignOff(id);
        const ready = assertNotifiable(steps, signOff?.signedOffBy ?? null);
        if (!ready.ok) {
          if (ready.reason === 'steps_outstanding') throw new BreachNotificationIncompleteError(ready.outstanding);
          throw new BreachSignOffRequiredError();
        }
        change = breach.markNotified(new Date(dto.regulatorNotifiedAt), new Date(dto.principalsNotifiedAt));
      } else {
        change = breach.close(dto.note);
      }
      await this.repo.updateBreach(client, breach, actor.userId);
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: `dpdp.breach_${change.to}`, entityType: 'data_breach', entityId: id,
        oldValue: { status: before }, newValue: { status: change.to }, reason: dto.note, ip: actor.ip, requestId: actor.requestId || null });
      return breach.toJSON();
    });
  }

  async get(id: string) {
    const b = await this.repo.getBreach(id);
    if (!b) throw new BreachNotFoundError(id);
    return b.toJSON();
  }

  async list(q: BreachListQuery) {
    const rows = await this.repo.listBreaches(q);
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /* ======================= ADMIN-5c · the notification checklist (W043) ======================= */

  /** Record one of the three acts, with the thing that makes it checkable.
   *
   *  One step per call. The whole value of the checklist is that it cannot be satisfied with a single gesture — a
   *  "mark all notified" action would recreate exactly the two-typed-timestamps problem in a new shape.
   */
  async recordStep(actor: AdminRequestContext, id: string, dto: { step: string; outcome: string; evidenceRef?: unknown; reachedCount?: unknown; channel?: unknown; note?: unknown }) {
    const v = assertStep(dto);   // throws a 422 naming the missing evidence or reason
    return this.pool.withTx(async (client) => {
      const breach = await this.repo.getBreachForUpdate(client, id);
      if (!breach) throw new BreachNotFoundError(id);
      // Replacing a live claim RETRACTS it first rather than updating in place — the withdrawn claim stays visible.
      await this.repo.retractNotificationStep(client, id, v.step);
      await this.repo.insertNotificationStep(client, { breachId: id, ...v, performedBy: actor.userId });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.breach_step_recorded', entityType: 'data_breach', entityId: id,
        newValue: { step: v.step, outcome: v.outcome, evidenceRef: v.evidenceRef, reachedCount: v.reachedCount, channel: v.channel },
        reason: v.note ?? `${v.step} ${v.outcome}`, ip: actor.ip, requestId: actor.requestId || null,
      });
      const steps = await this.repo.notificationStepsForUpdate(client, id);
      return { breachId: id, step: v.step, outcome: v.outcome, checklist: checklist(steps) };
    });
  }

  async retractStep(actor: AdminRequestContext, id: string, dto: { step: string; reason: string }) {
    return this.pool.withTx(async (client) => {
      const breach = await this.repo.getBreachForUpdate(client, id);
      if (!breach) throw new BreachNotFoundError(id);
      const n = await this.repo.retractNotificationStep(client, id, dto.step);
      if (n === 0) throw new BreachStepNotFoundError(dto.step);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.breach_step_retracted', entityType: 'data_breach', entityId: id,
        oldValue: { step: dto.step }, reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { breachId: id, step: dto.step, retracted: true as const };
    });
  }

  /** THE DPO SIGN-OFF — the platform's FIFTH two-person control, and the second built on the shared helper.
   *
   *  The person who DECLARED the breach cannot sign off that it was properly notified. They are the individual most
   *  motivated to see the row closed, usually at the worst hour of the night, and `ck_breach_signoff_ne_opener` refuses
   *  the same row at the database.
   */
  async signOff(actor: AdminRequestContext, id: string, note: string | null) {
    return this.pool.withTx(async (client) => {
      const breach = await this.repo.getBreachForUpdate(client, id);
      if (!breach) throw new BreachNotFoundError(id);
      const openedBy = await this.repo.breachOpenedBy(client, id);
      assertSecondPerson('signing off a breach notification', openedBy, actor.userId,
        'the person who declared this breach cannot also certify that it was properly notified.');

      // Sign-off asserts the steps are adequate, so it cannot precede them. Ordering it this way also means the DPO
      // reads the evidence before signing rather than after.
      const steps = await this.repo.notificationStepsForUpdate(client, id);
      const ready = assertNotifiable(steps, actor.userId);
      if (!ready.ok && ready.reason === 'steps_outstanding') throw new BreachNotificationIncompleteError(ready.outstanding);

      await this.repo.signOffBreach(client, id, actor.userId, note);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.breach_signed_off', entityType: 'data_breach', entityId: id,
        newValue: { signedOffBy: actor.userId, steps: steps.filter((x) => x.outcome !== 'retracted').length },
        reason: note ?? 'notification certified', ip: actor.ip, requestId: actor.requestId || null,
      });
      return { breachId: id, signedOffBy: actor.userId };
    });
  }

  /** W043's detail: the checklist, the clocks and the reach shortfall. */
  async notificationView(id: string, now = new Date()) {
    const [steps, meta] = await Promise.all([this.repo.notificationSteps(id), this.repo.breachSignOff(id)]);
    if (!meta) throw new BreachNotFoundError(id);
    const reached = totalReached(steps);
    return {
      checklist: checklist(steps),
      history: steps,
      signedOffBy: meta.signedOffBy, signedOffAt: meta.signedOffAt ? meta.signedOffAt.toISOString() : null, dpoNote: meta.note,
      openedBy: meta.openedBy,
      // The 72-hour clock runs from DETECTION and does NOT stop at containment — see domain/breach-notification.ts.
      notifyClock: notifyClock(meta.detectedAt, meta.regulatorNotifiedAt, now),
      containmentMinutes: containmentMinutes(meta.detectedAt, meta.containedAt),
      affectedCount: meta.affectedCount,
      reached,
      unreached: unreached(meta.affectedCount, reached),
      notifiable: assertNotifiable(steps, meta.signedOffBy),
    };
  }
}
