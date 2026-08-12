// apps/admin-api/src/modules/safety-desk/services/safety-desk.service.ts · W058 (PC-56 ADMIN-SWEEP-b3).
//
// Transactions and audit; rules in domain/. Two honesty lines run through every method: the desk RECORDS human acts
// (it performs none — no paging provider exists), and it reads case METADATA only (no thread content — the
// repository never touches messages, and W058's "even platform owner" clause is enforced by that absence).
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SafetyDeskRepository } from '../repositories/safety-desk.repository';
import {
  isEmergencyCategory, assertStep, assertStepDetail, stepStatus, requesterView, caseAge,
  PROTOCOLS, SafetyRuleError, type EmergencyCategory,
} from '../domain/safety-desk';
import { SafetyCaseNotFoundError, SafetyCaseConflictError, InvalidSafetyStepError } from '../domain/safety-desk.errors';
import type { RecordStepDto } from '../dto/safety-desk.dto';

const VET_PANEL_LIMIT = 8;

@Injectable()
export class SafetyDeskService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: SafetyDeskRepository,
  ) {}

  async desk(q: { cursor?: { c: string; id: string }; limit: number }, viewer: string) {
    const now = new Date();
    const rows = await this.repo.activeCases({ cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id, tenantId: r.tenantId, ticketNo: r.ticketNo, categoryCode: r.categoryCode,
        channel: r.channel, status: r.status, subject: r.subject,
        age: caseAge(r.createdAt, now), createdAt: r.createdAt,
        tenantDistrict: r.tenantDistrict,   // the TENANT's home district — never the requester's address
        responders: r.responders,
        latestStep: r.latestStepCode ? { code: r.latestStepCode, status: r.latestStepStatus } : null,
      })),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${last.createdAt instanceof Date ? last.createdAt.toISOString() : last.createdAt}|${last.id}`).toString('base64') : null,
      protocols: PROTOCOLS,
      viewer,
    };
  }

  /** One case: metadata, requester (masked; her identity is the most protected fact here), steps, responders —
   *  and for emergency_vet cases, the vets whose own published offer is to be called out. */
  async getCase(id: string, viewer: string) {
    const c = await this.repo.getCase(id);
    if (!c) throw new SafetyCaseNotFoundError();
    const [requester, steps, responders] = await Promise.all([
      c.requesterUserId ? this.repo.requester(c.requesterUserId) : Promise.resolve(null),
      this.repo.steps(id), this.repo.responders(id),
    ]);
    let vets: any[] = [];
    if (c.categoryCode === 'emergency_vet') {
      const regionId = await this.repo.tenantRegionId(c.tenantId);
      vets = await this.repo.emergencyVets(regionId, VET_PANEL_LIMIT);
      // The vet panel shows published emergency contacts — a read somebody may have to account for, so it is a row.
      await this.audit.log({
        actorUserId: viewer, actorRole: null, action: 'safety.vets_read', entityType: 'support_ticket', entityId: id,
        oldValue: null, newValue: { vets: vets.length }, reason: 'emergency vet panel', ip: null, requestId: null,
      });
    }
    return {
      id: c.id, tenantId: c.tenantId, ticketNo: c.ticketNo, categoryCode: c.categoryCode,
      channel: c.channel, status: c.status, subject: c.subject,
      age: caseAge(c.createdAt, new Date()), createdAt: c.createdAt, tenantDistrict: c.tenantDistrict,
      requester: requester ? requesterView(requester) : null,
      steps, responders,
      joined: responders.some((x) => x.adminId === viewer),
      protocol: isEmergencyCategory(c.categoryCode) ? PROTOCOLS[c.categoryCode as EmergencyCategory] : [],
      vets,
    };
  }

  /** "Join" — additive, audited, idempotent (a double click is one presence). */
  async join(actor: AdminRequestContext, id: string) {
    const c = await this.repo.getCase(id);
    if (!c) throw new SafetyCaseNotFoundError();
    return this.pool.withTx(async (tx) => {
      const joined = await this.repo.join(tx, id, actor.userId);
      if (joined) {
        await this.audit.write(tx, {
          actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
          action: 'safety.case_joined', entityType: 'support_ticket', entityId: id,
          oldValue: null, newValue: { categoryCode: c.categoryCode }, reason: 'joined the case',
          ip: actor.ip, requestId: actor.requestId || null,
        });
      }
      return { ok: true, joined, already: !joined };
    });
  }

  /** Record a protocol step. A `would_page` step writes provider_pending with the COMPOSED truth; a human step
   *  demands the who/what. Only responders write steps — the register is of people who are in the room. */
  async recordStep(actor: AdminRequestContext, id: string, dto: RecordStepDto) {
    const c = await this.repo.getCase(id);
    if (!c) throw new SafetyCaseNotFoundError();
    let step, detail: string;
    try {
      step = assertStep(c.categoryCode, dto.stepCode);
      detail = assertStepDetail(step.kind, dto.detail);
    } catch (e) {
      if (e instanceof SafetyRuleError) {
        throw e.code === 'SAFETY_DETAIL_TOO_SHORT' ? new InvalidSafetyStepError(e) : new SafetyCaseConflictError(e);
      }
      throw e;
    }
    return this.pool.withTx(async (tx) => {
      const responders = await this.repo.responders(id);
      if (!responders.some((x) => x.adminId === actor.userId)) {
        throw new SafetyCaseConflictError(new SafetyRuleError('SAFETY_NOT_A_RESPONDER',
          'Only a responder on this case records its steps — press Join first, so the register shows who was in the room.'));
      }
      const status = stepStatus(step.kind);
      await this.repo.insertStep(tx, {
        ticketId: id, categoryCode: c.categoryCode, stepCode: step.code, status, detail,
        actorAdminId: actor.userId, vetProfileId: dto.vetProfileId ?? null,
      });
      await this.audit.write(tx, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'safety.step_recorded', entityType: 'support_ticket', entityId: id,
        oldValue: null, newValue: { stepCode: step.code, status, vetProfileId: dto.vetProfileId ?? null },
        reason: detail.slice(0, 200), ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, stepCode: step.code, status };
    });
  }
}
