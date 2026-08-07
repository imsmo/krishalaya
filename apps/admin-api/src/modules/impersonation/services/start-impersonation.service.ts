// apps/admin-api/src/modules/impersonation/services/start-impersonation.service.ts · open a READ-ONLY, time-boxed
// act-as session and mint the short-lived impersonation token (returned ONCE, never stored). Safety gates, in
// order: kill-switch (Law 10, disabled ⇒ refuse) → scope must be read_only → no self-impersonation → ttl within
// the hard cap → the target must be an active member of THAT tenant (else 404, no cross-tenant enumeration) and
// must NOT be a platform/staff account (never act as a privileged user). One ACID tx: insert the grant (one active
// per admin+target, else 409) + write the audit_log row, atomic (§4). The token carries typ='impersonation' +
// the actor (act) claim + scope, signed with the DEDICATED key — it can never act as money/god/write.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ImpersonationRepository } from '../repositories/impersonation.repository';
import { assertScope, assertTtl, assertNotSelf } from '../domain/scope';
import { mintImpersonationToken } from '../domain/impersonation-token';
import { ImpersonationDisabledError, CannotImpersonatePrivilegedError, TargetUserNotFoundError } from '../domain/impersonation.errors';
import { StartGrantDto } from '../dto/impersonation.dto';

@Injectable()
export class StartImpersonationService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: ImpersonationRepository, private readonly config: AdminConfig) {}

  async start(actor: AdminRequestContext, dto: StartGrantDto) {
    if (!this.config.impersonation.enabled) throw new ImpersonationDisabledError();   // kill-switch (Law 10)
    assertScope(dto.scope);
    assertNotSelf(actor.userId, dto.targetUserId);
    const ttl = assertTtl(dto.ttlSec, this.config.impersonation.maxTtlSec);

    const target = await this.repo.findTenantUser(dto.targetTenantId, dto.targetUserId);
    if (!target) throw new TargetUserNotFoundError(dto.targetUserId);                  // 404 — not a member of that tenant
    if (target.isPrivileged) throw new CannotImpersonatePrivilegedError();            // never act as staff/god

    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    return this.pool.withTx(async (client) => {
      const grant = await this.repo.insertGrant(client, { id, adminUserId: actor.userId, targetTenantId: dto.targetTenantId, targetUserId: dto.targetUserId, reason: dto.reason, scope: 'read_only', expiresAt });
      const { token, expSec } = mintImpersonationToken({
        secret: this.config.impersonation.secret, issuer: this.config.impersonation.issuer, audience: this.config.impersonation.audience,
        grantId: id, adminUserId: actor.userId, targetUserId: dto.targetUserId, targetTenantId: dto.targetTenantId, ttlSec: ttl, nowSec: Math.floor(now.getTime() / 1000),
      });
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'impersonation.started', entityType: 'impersonation_grant', entityId: id,
        newValue: { targetTenantId: dto.targetTenantId, targetUserId: dto.targetUserId, scope: 'read_only', expiresAt: expiresAt.toISOString() }, reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null });
      // PC-56 ADMIN-9b · **THE TARGET IS TOLD, IN THE SAME TRANSACTION.** W008 calls tenant visibility "the policy" and
      // nothing emitted anything. In-tx (Law 4) so a session cannot exist without the notice being queued, and the
      // payload carries the REASON the operator typed — a notice saying only "support accessed your account" is
      // technically transparent and practically useless to the person deciding whether to complain.
      await this.repo.emitNotification(client, {
        eventType: 'impersonation.session_started',
        grantId: id, targetTenantId: dto.targetTenantId, targetUserId: dto.targetUserId,
        payload: { reason: dto.reason, expiresAt: expiresAt.toISOString(), grantId: id },
      });
      // The token is a secret — returned ONCE to the operator's session, never persisted.
      return { grant: grant.toJSON(), token, expiresAt: new Date(expSec * 1000).toISOString() };
    });
  }
}
