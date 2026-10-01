// modules/audit/services/audit.service.ts · read-only audit-trail use-cases (CQRS, Law 12).
// authz THROWS (Law 6): a caller without `audit.read` gets 403. No writes — the trail is immutable and is
// only ever written by core/audit AuditWriter inside business transactions. Keyset cursor is an opaque
// base64 of `created_at|id`; the wire shape mirrors the SDK AuditEntry.
import { Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { AuditRepository, AuditRow } from '../repositories/audit.repository';
import { QueryAuditDto } from '../dto/audit.dto';
import { encodeAuditCursor, decodeAuditCursor } from '../domain/audit.cursor';

export interface AuditActor { userId: string; canRead: boolean; }

const wire = (r: AuditRow) => ({
  id: r.id, actorUserId: r.actorUserId, actorRole: r.actorRole, action: r.action,
  entityType: r.entityType, entityId: r.entityId, oldValue: r.oldValue ?? null, newValue: r.newValue ?? null,
  reason: r.reason, requestId: r.requestId,
  createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
});

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async list(tenantId: string, actor: AuditActor, q: QueryAuditDto) {
    if (!actor.canRead) throw new ForbiddenError('audit.read required');
    const rows = await this.repo.listFor(tenantId, {
      action: q.action, entityType: q.entityType, entityId: q.entityId, actorUserId: q.actorUserId,
      from: q.from, to: q.to, cursor: decodeAuditCursor(q.cursor), limit: q.limit,
    });
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeAuditCursor(last.cursorTs, last.id) : null;
    return { items: rows.map(wire), nextCursor };
  }

  async getById(tenantId: string, actor: AuditActor, id: string) {
    if (!actor.canRead) throw new ForbiddenError('audit.read required');
    const row = await this.repo.getById(tenantId, id);
    return row ? wire(row) : null;
  }
}
