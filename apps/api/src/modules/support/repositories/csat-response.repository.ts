// modules/support/repositories/csat-response.repository.ts · the CSAT RESPONSE LEDGER (migration 0099, PC-56 ADMIN-2c).
//
// WHY THIS REPOSITORY EXISTS AT ALL, when `support_tickets.csat_score` already held a rating: because that column is
// overwritable and the ticket entity CLEARS IT ON REOPEN, so the ratings the desk most needs — the bad ones, which are
// the ones most likely to be followed by a reopen — were being deleted. Every rating is now a row here and nothing is
// ever overwritten.
//
// tenant_id in every query (Law 1) + RLS. INSERT-ONLY BY DESIGN: there is no update method and no delete method, and
// migration 0099 grants kv_app neither privilege. A rating is a thing a farmer said; the platform does not edit it.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface CsatResponseRow {
  id: string; ticketId: string; score: number;
  comment: string | null; commentLanguage: string | null;
  ratedAt: Date; ratedAtIsEstimated: boolean;
  ticketStatus: string; ratedAgentUserId: string | null;
}

export interface InsertCsatResponse {
  tenantId: string; ticketId: string; respondentUserId: string | null; score: number;
  comment: string | null; commentLanguage: string | null;
  ticketStatus: string; ratedAgentUserId: string | null;
}

@Injectable()
export class CsatResponseRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Append one rating. Runs inside the caller's transaction (Law 4) — the ledger row and the ticket's derived
   * `csat_score` must land together or not at all, or the two representations disagree and the column becomes a lie.
   *
   * ON CONFLICT DO NOTHING against `uq_csat_response_occasion` (ticket, respondent, ticket_status): a double-tap on a
   * flaky rural connection must not create two identical ratings, while a GENUINE re-rating after the ticket moves on
   * (reopened → resolved again) is a different occasion and is therefore allowed. Returns null when the insert was
   * deduped, so the caller can tell "recorded" from "already recorded" rather than reporting success twice.
   */
  async append(tx: TxContext, p: InsertCsatResponse): Promise<{ id: string } | null> {
    const res = await tx.query(
      `INSERT INTO support_csat_responses
         (tenant_id, ticket_id, respondent_user_id, score, comment, comment_language, ticket_status,
          rated_agent_user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [p.tenantId, p.ticketId, p.respondentUserId, p.score, p.comment, p.commentLanguage, p.ticketStatus,
       p.ratedAgentUserId]);
    const row = res.rows[0] as { id: string } | undefined;
    return row ? { id: row.id } : null;
  }

  /** The LATEST rating for a ticket, read inside the write transaction so the ticket's derived column cannot be
   *  computed from a stale replica. Deliberately not a MAX(score) or an average: the column means "the latest rating". */
  async latestScoreFor(tx: TxContext, tenantId: string, ticketId: string): Promise<number | null> {
    const res = await tx.query(
      `SELECT score FROM support_csat_responses
        WHERE tenant_id = $1 AND ticket_id = $2 AND deleted_at IS NULL
        ORDER BY rated_at DESC, id DESC LIMIT 1`, [tenantId, ticketId]);
    const row = res.rows[0] as { score: number } | undefined;
    return row ? Number(row.score) : null;
  }

  /** Every rating a ticket has ever had, newest first — the thing that was impossible before this table. Read path, so
   *  the replica is fine. */
  async historyFor(tenantId: string, ticketId: string): Promise<CsatResponseRow[]> {
    const res = await this.replica.forTenant(tenantId).query(
      `SELECT id, ticket_id, score, comment, comment_language, rated_at, rated_at_is_estimated,
              ticket_status, rated_agent_user_id
         FROM support_csat_responses
        WHERE tenant_id = $1 AND ticket_id = $2 AND deleted_at IS NULL
        ORDER BY rated_at DESC, id DESC
        LIMIT 50`, [tenantId, ticketId]);
    return (res.rows as any[]).map((r) => ({
      id: r.id, ticketId: r.ticket_id, score: Number(r.score),
      comment: r.comment ?? null, commentLanguage: r.comment_language ?? null,
      ratedAt: r.rated_at, ratedAtIsEstimated: r.rated_at_is_estimated === true,
      ticketStatus: r.ticket_status, ratedAgentUserId: r.rated_agent_user_id ?? null,
    }));
  }
}
