// modules/ai-governance/repositories/appeal.repository.ts · the tenant realm's window on `appeals`
// (PC-56 ADMIN-SWEEP-b1).
//
// `appeals` HAS NO tenant_id AND NO RLS (0067: platform staff review appeals across tenants), so this repository is
// where the scoping law lives instead: **every read binds `appellant = <caller>` and the INSERT writes the caller as
// appellant** — there is no code path here that touches another person's appeal. The DB grant is the second half of
// the bargain: 0132 gave kv_app INSERT and SELECT only, so even a bug here could not decide, reassign or delete one.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { APPEAL_SLA_HOURS } from '../domain/appeal-submit';

const COLS = `id, subject_ref AS "subjectRef", subject_action AS "subjectAction", appellant, status,
              sla_due_at AS "slaDueAt", decision_reason AS "decisionReason", decided_at AS "decidedAt",
              created_at AS "createdAt"`;

@Injectable()
export class AppealRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Insert with the 48h clock set HERE, on submit (W097). Returns null when a pending appeal by this appellant on
   *  this subject already exists — the partial unique index (0132) makes a village-network retry a dedupe, exactly
   *  as moderation_reports does it. */
  async insertDeduped(tx: TxContext, v: { subjectRef: string; subjectAction: string; appellant: string }): Promise<{ id: string; slaDueAt: string } | null> {
    const r = await tx.query(
      `INSERT INTO appeals (id, subject_ref, subject_action, appellant, status, sla_due_at, created_by)
       VALUES ($1, $2, $3, $4, 'pending', now() + ($5 || ' hours')::interval, $4)
       ON CONFLICT (subject_ref, appellant) WHERE status = 'pending' AND deleted_at IS NULL DO NOTHING
       RETURNING id, sla_due_at AS "slaDueAt"`,
      [uuidv7(), v.subjectRef, v.subjectAction, v.appellant, String(APPEAL_SLA_HOURS)]);
    return r.rows[0] ?? null;
  }

  /** "My appeals" — the farmer's own register, appellant-bound, keyset. Includes the decision reason once decided:
   *  W097's promise ("every closed appeal shows its reasoning to the appellant") is kept on READ as well as by the
   *  notice, because a notice can be missed and this page cannot. */
  async listMine(tx: TxContext, v: { appellant: string; cursor?: { c: string; id: string }; limit: number }): Promise<any[]> {
    const p: unknown[] = [v.appellant];
    let w = `appellant = $1 AND deleted_at IS NULL`;
    if (v.cursor) {
      p.push(v.cursor.c, v.cursor.id);
      w += ` AND (created_at < $2 OR (created_at = $2 AND id < $3))`;
    }
    p.push(v.limit);
    const r = await tx.query(
      `SELECT ${COLS} FROM appeals WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT $${p.length}`, p);
    return r.rows;
  }

  /* ---- ownership checks, tenant-scoped (RLS rides along on these tables) ---- */

  async ownsListing(tx: TxContext, tenantId: string, listingId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM listings WHERE id = $1 AND tenant_id = $2 AND seller_user_id = $3`, [listingId, tenantId, userId]);
    return !!r.rows[0];
  }

  async ownsReview(tx: TxContext, tenantId: string, reviewId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM reviews WHERE id = $1 AND tenant_id = $2 AND reviewer_user_id = $3`, [reviewId, tenantId, userId]);
    return !!r.rows[0];
  }
}
