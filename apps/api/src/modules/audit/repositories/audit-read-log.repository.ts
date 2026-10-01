// modules/audit/repositories/audit-read-log.repository.ts · PC-56 TENANT-9c (F-9) · AUDIT READS ARE THEMSELVES AUDITED.
//
// W200: *"every view taken here is itself logged"*; W436: *"Opening this drill-down is itself a privileged read — it lands
// in audit_log with your auditor identity"*. The read wrote nothing. One row per auditor read now, into 0181's
// `audit_read_log` (partitioned monthly like audit_log, RLS FORCE'd, append-only by grant AND trigger). It is a SEPARATE
// table from audit_log on purpose: a read log in the trail would make the trail's own page grow every time it is read, and
// "privileged actions (FY)" would count the auditor reading them.
//
// RECORDED BEFORE RETURNED (1b's rule). The service writes this row and only then hands the rows back; a failed write fails
// the read — an unlogged view is the one thing the canon says cannot happen here.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { ReadPurpose } from '../domain/auditor-realm';

export interface ReadLogEntry {
  tenantId: string; actorUserId: string; actorRole: string; purpose: ReadPurpose; surface: string;
  filter: Record<string, unknown>; rowCount: number; spanFirst: string | null; spanLast: string | null;
  /** The read's window as CIVIL days in the cooperative's zone; the database turns them into instants (to = end of day). */
  window?: { from: string; to: string; zone: string } | null; requestId?: string | null;
}

export interface ReadLogRow { id: string; purpose: string; surface: string; rowCount: number; actorRole: string; createdAt: string }

@Injectable()
export class AuditReadLogRepository {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async record(e: ReadLogEntry): Promise<string> {
    return this.uow.run(e.tenantId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO audit_read_log (tenant_id, actor_user_id, actor_role, purpose, surface, filter, row_count, span_first, span_last,
                                     window_from, window_to, request_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,
                 CASE WHEN $10::date IS NULL THEN NULL ELSE ($10::date)::timestamp AT TIME ZONE $13 END,
                 CASE WHEN $11::date IS NULL THEN NULL ELSE (($11::date) + 1)::timestamp AT TIME ZONE $13 - interval '1 microsecond' END,
                 $12) RETURNING id::text AS id`,
        [e.tenantId, e.actorUserId, e.actorRole, e.purpose, e.surface.slice(0, 120), JSON.stringify(e.filter ?? {}), e.rowCount,
         e.spanFirst, e.spanLast, e.window?.from ?? null, e.window?.to ?? null, e.requestId ? e.requestId.slice(0, 60) : null, e.window?.zone ?? 'UTC']);
      return r.rows[0].id;
    }, { userId: e.actorUserId });
  }

  /** Is `grantId` THIS actor's own `trail_reveal` of THIS entry, younger than `minutes`? (The reveal's console hand-off.) */
  async hasLiveReveal(tenantId: string, actorUserId: string, entryId: string, grantId: string, minutes: number): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM audit_read_log
                       WHERE id = $1::bigint AND tenant_id = $2 AND actor_user_id = $3 AND purpose = 'trail_reveal' AND span_first = $4
                         AND created_at > now() - ($5::int * interval '1 minute')) AS ok`,
      [grantId, tenantId, actorUserId, entryId, minutes]);
    return r.rows[0]?.ok === true;
  }

  /** The auditor's own last reads (W200 *"This view, logged"* — the row it just wrote is among them). */
  async recentFor(tenantId: string, actorUserId: string, limit = 5): Promise<ReadLogRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id::text AS id, purpose, surface, row_count AS "rowCount", actor_role AS "actorRole", created_at AS "createdAt"
         FROM audit_read_log WHERE tenant_id = $1 AND actor_user_id = $2
        ORDER BY created_at DESC, id DESC LIMIT ${Math.min(Math.max(limit, 1), 20)}`,
      [tenantId, actorUserId]);
    return r.rows.map((x: any) => ({ ...x, createdAt: x.createdAt instanceof Date ? x.createdAt.toISOString() : String(x.createdAt) })); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}
