// modules/insurance/repositories/insurance-claim.repository.ts · all SQL for insurance_claims. tenant_id in
// EVERY query (Law 1) + RLS (already applied -- 0011 predates 0014's generic tenant-RLS backfill, same as
// insurance_policies, confirmed by grounding). No version column -> mutations lock FOR UPDATE. Lists are
// keyset (Law 11, never OFFSET), mirrors insurance-policy.repository.ts exactly. Evidence attach/list rides
// the EXISTING polymorphic media_links table (entity_type='insurance_claim'), byte-structurally identical
// to modules/listings/repositories/listing-media.repository.ts's own attach()/countForListing() pattern --
// no new table, no new upload primitive.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { ClaimStatus } from '../domain/insurance-claim.state';
import { InsuranceClaimNotFoundError } from '../domain/insurance.errors';
import { memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';

const COLS = `id, tenant_id, policy_id, claimant_user_id, event_date, event_type_id, description, status,
  intimated_within_72h, surveyor_user_id, survey_report, approved_minor, payout_id, closed_at, created_at`;

function toDomain(r: any): InsuranceClaim {
  return InsuranceClaim.rehydrate({
    id: r.id, tenantId: r.tenant_id, policyId: r.policy_id, claimantUserId: r.claimant_user_id,
    eventDate: r.event_date instanceof Date ? r.event_date.toISOString().slice(0, 10) : r.event_date,
    eventTypeId: r.event_type_id, description: r.description, status: r.status as ClaimStatus,
    intimatedWithin72h: r.intimated_within_72h, surveyorUserId: r.surveyor_user_id,
    surveyReport: r.survey_report, approvedMinor: r.approved_minor !== null ? BigInt(r.approved_minor) : null,
    payoutId: r.payout_id, closedAt: r.closed_at, createdAt: r.created_at,
  });
}

export interface ClaimListQuery { claimantUserId?: string; policyId?: string; status?: ClaimStatus; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class InsuranceClaimRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** PC-56 PARTNER-3a (founder Q2): `claimant_user_id` is the policy's HOLDER; `created_by` is the person who FILED (the holder, or a desk
   *  member filing on the holder's behalf) — the one place the filer is knowable, read back by `filerOf` for the decider-conflict check. */
  async insert(tx: TxContext, claim: InsuranceClaim, filedBy: string): Promise<void> {
    const c = claim.toProps();
    await tx.query(
      `INSERT INTO insurance_claims
        (id, tenant_id, policy_id, claimant_user_id, event_date, event_type_id, description, status,
         intimated_within_72h, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.id, c.tenantId, c.policyId, c.claimantUserId, c.eventDate, c.eventTypeId, c.description, c.status, c.intimatedWithin72h, filedBy],
    );
  }

  /** PC-56 PARTNER-3a (founder Q2): who FILED the claim (`created_by`, add_std_columns) — null on a row written before the rule. */
  async filerOf(tx: TxContext, tenantId: string, id: string): Promise<string | null> {
    const r = await tx.query<{ created_by: string | null }>(`SELECT created_by FROM insurance_claims WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0]?.created_by ?? null;
  }

  /** PC-56 PARTNER-3a (founder Q5): is this person an ACTIVE member of the claim's organisation? A live `user_tenant_roles` grant (any role,
   *  `is_active`, not deleted) in THIS tenant, and no live suspension there (`tenant_member_suspensions`, the shared predicate). */
  async isActiveMember(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query<{ ok: boolean }>(
      `SELECT (EXISTS (SELECT 1 FROM user_tenant_roles utr
                        WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.is_active AND utr.deleted_at IS NULL)
               AND NOT ${memberSuspendedSql('$1', '$2')}) AS ok`, [tenantId, userId]);
    return r.rows[0]?.ok === true;
  }

  async update(tx: TxContext, claim: InsuranceClaim): Promise<void> {
    const c = claim.toProps();
    await tx.query(
      `UPDATE insurance_claims SET status=$3, surveyor_user_id=$4, survey_report=$5::jsonb,
         approved_minor=$6, payout_id=$7, closed_at=$8, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [c.id, c.tenantId, c.status, c.surveyorUserId, c.surveyReport ? JSON.stringify(c.surveyReport) : null,
       c.approvedMinor !== null ? c.approvedMinor.toString() : null, c.payoutId, c.closedAt],
    );
  }

  /** Read for a write -- locked within the caller's transaction (Law 1: tenant_id bound). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<InsuranceClaim> {
    const r = await tx.query(`SELECT ${COLS} FROM insurance_claims WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    if (!r.rows[0]) throw new InsuranceClaimNotFoundError(id);
    return toDomain(r.rows[0]);
  }

  async getById(tenantId: string, id: string): Promise<InsuranceClaim | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM insurance_claims WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Keyset list (Law 11 -- never OFFSET), off the replica. "My claims" (claimantUserId set) or the
   *  insurer-manage queue (unset). */
  async listFor(tenantId: string, q: ClaimListQuery): Promise<InsuranceClaim[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.claimantUserId) where += ` AND claimant_user_id=${p(q.claimantUserId)}`;
    if (q.policyId) where += ` AND policy_id=${p(q.policyId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lim = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM insurance_claims WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lim}`, params);
    return r.rows.map(toDomain);
  }

  /** Attach uploaded evidence media to a claim (screen 290), via the EXISTING polymorphic media_links
   *  table -- no new table, byte-structurally the same idempotent-attach guard as
   *  ListingMediaRepository.attach(). */
  async attachEvidence(tx: TxContext, claimId: string, mediaIds: string[]): Promise<void> {
    let sort = await this.countEvidence(tx, claimId);
    for (const mediaId of mediaIds) {
      await tx.query(
        `INSERT INTO media_links (id, media_id, entity_type, entity_id, purpose, sort_order)
         SELECT $1, $2, 'insurance_claim', $3, 'evidence', $4
          WHERE NOT EXISTS (
            SELECT 1 FROM media_links WHERE entity_type = 'insurance_claim' AND entity_id = $3 AND media_id = $2
          )`,
        [uuidv7(), mediaId, claimId, sort++],
      );
    }
  }

  async countEvidence(tx: TxContext, claimId: string): Promise<number> {
    const r = await tx.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM media_links WHERE entity_type = 'insurance_claim' AND entity_id = $1 AND purpose = 'evidence'`,
      [claimId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  /** A clean, scanned media asset the caller uploaded (anti-IDOR: only the uploader's own media; tenant-owned
   *  or platform-shared) -- the gate before letting a claimant attach evidence to their OWN claim. Mirrors
   *  ListingMediaRepository.photoAttachable exactly, except any kind (image/video), not image-only. */
  async evidenceAttachable(tx: TxContext, tenantId: string, mediaAssetId: string, userId: string): Promise<boolean> {
    const r = await tx.query<{ ok: boolean }>(
      `SELECT true AS ok FROM media_assets
         WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND uploader_user_id = $3
           AND kind IN ('image','video') AND scan_status = 'clean' AND deleted_at IS NULL`,
      [mediaAssetId, tenantId, userId]);
    return !!r.rows[0]?.ok;
  }

  /** Resolve a claim_event lookup code (screen 289's event-type chips) to its lookup_values id. */
  async resolveEventTypeId(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM lookup_values WHERE type_code='claim_event' AND tenant_id IS NULL AND code=$1 AND is_active=true`, [code]);
    return r.rows[0]?.id ?? null;
  }
}
