// apps/admin-api/src/modules/compliance-ops/services/audit-trail.service.ts · W040 (PC-56 ADMIN-5e).
//
// The per-entity lifecycle drill. Everything interesting here is about what the caller is allowed to SEE, and the
// split is the canon's: the timeline needs `audit.read`, the change diffs need `audit.values.read`, and a viewer
// holding only the first gets the whole story with the values withheld rather than an error page.
//
// READING A TRAIL IS ITSELF AUDITED. Opening the complete history of one entity — every actor, every reason, every
// IP — is an act, and on this platform acts by privileged operators land in the same table being read. That the
// audit log records reads of the audit log is deliberate and slightly recursive: the alternative is the one surface
// where somebody can look at everything and leave no trace.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { parseEntityRef, formatEntityRef, diffOf, diffIsEmpty, RETENTION_CLAIM, type DiffPanel } from '../domain/audit-trail';
import { InvalidComplianceQueryError } from '../domain/compliance-ops.errors';

export interface TrailEntry {
  id: string; action: string; actorUserId: string | null; actorRole: string | null;
  tenantId: string | null; reason: string | null; ip: string | null; requestId: string | null;
  userAgent: string | null; createdAt: string;
  diff: DiffPanel; diffEmpty: boolean;
}

@Injectable()
export class AuditTrailService {
  constructor(private readonly repo: ComplianceRepository, private readonly audit: AdminAuditWriter) {}

  async trail(actor: AdminRequestContext, ref: string, limit: number, canReadValues: boolean) {
    const parsed = parseEntityRef(ref);
    if (!parsed) {
      throw new InvalidComplianceQueryError(
        'an entity reference looks like `listing/LST-2026-084497` — a type, a slash, and an id');
    }
    // Fetch one over the limit so the console can say the trail was truncated rather than implying the entity's
    // life ended at row 200.
    const rows = await this.repo.entityTrail({ ...parsed, limit: limit + 1, withValues: canReadValues });
    const page = rows.slice(0, limit);

    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'audit.entity_trail_read', entityType: parsed.entityType, entityId: parsed.entityId,
      // Records WHETHER the values were disclosed. Two operators reading the same trail with different grants did
      // two different things, and a ledger that could not tell them apart would be no use in deciding who saw what.
      newValue: { valuesDisclosed: canReadValues, rows: page.length },
      reason: 'entity audit trail opened', ip: actor.ip, requestId: actor.requestId || null,
    });

    const entries: TrailEntry[] = page.map((r: any) => {
      const diff = diffOf(r.oldValue ?? null, r.newValue ?? null, canReadValues);
      return {
        id: r.id, action: r.action, actorUserId: r.actorUserId, actorRole: r.actorRole,
        tenantId: r.tenantId, reason: r.reason, ip: r.ip, requestId: r.requestId,
        userAgent: r.userAgent, createdAt: new Date(r.createdAt).toISOString(),
        diff, diffEmpty: diffIsEmpty(diff),
      };
    });

    return {
      ref: formatEntityRef(parsed),
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      entries,
      truncated: rows.length > limit,
      limit,
      /** So the console can draw W040's "Diffs masked" state from a fact rather than inferring it from empty panels. */
      valuesDisclosed: canReadValues,
      retention: RETENTION_CLAIM,
    };
  }
}
