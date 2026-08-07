// apps/admin-api/src/modules/impersonation/services/impersonation-history.service.ts · the AUDIT surface: list
// grants (keyset, filterable by admin/target/status), read a single grant, list the actions taken under a grant,
// and RECORD an action (the exhaustive per-action log). recordAction is the canonical writer the honouring apps/api
// calls for every request made under an act-as token — it refuses to log against a missing / non-active / expired
// grant (so a stale token can't keep writing). All reads are keyset (never OFFSET), bounded.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ImpersonationRepository, GrantListQuery, ActionListQuery } from '../repositories/impersonation.repository';
import { GrantNotFoundError } from '../domain/impersonation.errors';
import { RecordActionDto } from '../dto/impersonation.dto';

@Injectable()
export class ImpersonationHistoryService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: ImpersonationRepository) {}

  async listGrants(q: GrantListQuery) {
    // PC-56 ADMIN-9b · **RECONCILE BEFORE READING.** Expiry was a column and an unused index: no job, no trigger, no
    // read filter, so an elapsed grant read `active` for ever — and kept holding `uq_imp_active_per_admin_target`, so
    // that operator could never get a fresh grant for that target again. Reconciled at the door for the same reason
    // 0118 put dormancy in the guard: the two jobs this platform relied on for reconciliation had both silently stopped.
    await this.repo.reconcileExpired();
    const items = (await this.repo.listGrants(q)).map((g) => g.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  async getGrant(id: string) {
    await this.repo.reconcileExpired(id);
    const grant = await this.repo.getGrant(id);
    if (!grant) throw new GrantNotFoundError(id);
    const counts = await this.repo.actionCounts(id);
    return {
      ...grant.toJSON(),
      // The action counts, split by outcome. "12 pages opened" and "12 pages opened, 3 write attempts blocked" are
      // different sessions, and the second is the one somebody needs to look at.
      actionCounts: counts,
      // **WHETHER THE HONOURING SIDE IS ACTUALLY RUNNING.** Every claim on W008 depends on it, and before this wave the
      // answer was no — silently. A console that cannot say which half is live is a console that lets the reader assume
      // both are.
      enforcement: this.enforcementState(),
    };
  }

  /** What this platform can honestly claim about an act-as session today. Read by the console and by nothing else, so
   *  the sentence and the state cannot drift apart. */
  enforcementState() {
    return {
      // Built in ADMIN-9b: apps/api verifies the token, refuses mutating methods, checks the grant on every request,
      // and writes one action row per request from the server rather than from the operator.
      verifierExists: true,
      readOnlyEnforcedAtRequestTime: true,
      perRequestLoggingByPlatform: true,
      revocationTakesEffect: 'the next request the operator makes',
      // Named rather than implied: the two realms verify one token format with two implementations.
      formatDuplicationOwner: 'ADMIN-9b-Q1',
    };
  }

  /** The backlog `ck_imp_terminal_has_ended_at` was landed NOT VALID for: grants whose window elapsed while nothing
   *  reconciled them. Surfaced rather than quietly fixed, because the count IS the finding. */
  async staleActive() {
    return { count: await this.repo.staleActiveCount() };
  }

  async listActions(q: ActionListQuery) {
    if (!(await this.repo.getGrant(q.grantId))) throw new GrantNotFoundError(q.grantId);
    const items = await this.repo.listActions(q);
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /** Record ONE action performed under a grant. The operator may only record against their OWN active, unexpired
   *  grant — a stale/closed/other grant is refused (no log injection, no writing past the time-box). */
  async recordAction(actor: AdminRequestContext, grantId: string, dto: RecordActionDto) {
    return this.pool.withTx(async (client) => {
      const grant = await this.repo.getGrantForUpdate(client, grantId);
      if (!grant) throw new GrantNotFoundError(grantId);
      const p = grant.toJSON();
      if (p.adminUserId !== actor.userId || p.status !== 'active' || grant.isExpired(new Date())) throw new GrantNotFoundError(grantId);  // 404, not 403 — don't reveal others' grants
      const row = await this.repo.insertAction(client, { grantId, targetTenantId: p.targetTenantId, method: dto.method, path: dto.path, action: dto.action ?? null });
      return { id: row.id, grantId, method: dto.method, path: dto.path, action: dto.action ?? null, createdAt: row.createdAt };
    });
  }
}
