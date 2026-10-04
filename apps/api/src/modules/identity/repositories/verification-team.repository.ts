// modules/identity/repositories/verification-team.repository.ts · PC-56 TENANT-SW-c · the SQL of the verification desk's claims and the
// team's seats, invites, conflicts, overrides, sessions and 2FA. Every query binds `tenant_id = $1` (Law 1) except the PERSON tables
// (`user_totp`, `user_recovery_codes`, `sessions`), which are keyed by the person. Writes take the caller's transaction; reads go to
// the replica unless a decision depends on them (then `tx`). Microsecond keysets (`US_SQL`) wherever a list pages.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL, KeysetCursor } from '../../../shared/pagination/us-keyset';
import { UNGRANTABLE_PERMISSIONS } from '../../../core/rbac/ungrantable';
import { maskPhone } from '../domain/verification-team';

const iso = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface ClaimRow { id: string; documentId: string; claimedBy: string; claimedAt: string; expiresAt: string; releasedAt: string | null; releaseKind: string | null }
const toClaim = (x: any): ClaimRow => ({ id: x.id, documentId: x.document_id, claimedBy: x.claimed_by, claimedAt: x.claimed_at, expiresAt: x.expires_at, releasedAt: x.released_at ?? null, releaseKind: x.release_kind ?? null });
const CLAIM_COLS = `c.id, c.document_id, c.claimed_by, ${iso('c.claimed_at')} AS claimed_at, ${iso('c.expires_at')} AS expires_at, ${iso('c.released_at')} AS released_at, c.release_kind`;

export interface ConflictRow {
  id: string; staffUserId: string; staffName: string | null; memberUserId: string; memberName: string | null; relation: string; relationNote: string | null;
  reason: string; declaredBy: string; declaredVia: string; active: boolean; createdAt: string; revokedBy: string | null; revokedAt: string | null; revokeReason: string | null;
}
const toConflict = (x: any): ConflictRow => ({
  id: x.id, staffUserId: x.staff_user_id, staffName: x.staff_name ?? null, memberUserId: x.member_user_id, memberName: x.member_name ?? null, relation: x.relation,
  relationNote: x.relation_note ?? null, reason: x.reason, declaredBy: x.declared_by, declaredVia: x.declared_via, active: Boolean(x.active), createdAt: x.created_at,
  revokedBy: x.revoked_by ?? null, revokedAt: x.revoked_at ?? null, revokeReason: x.revoke_reason ?? null,
});
const CONFLICT_SQL = `SELECT c.id, c.staff_user_id, su.full_name AS staff_name, c.member_user_id, mu.full_name AS member_name, c.relation, c.relation_note, c.reason,
  c.declared_by, c.declared_via, c.active, ${iso('c.created_at')} AS created_at, c.revoked_by, ${iso('c.revoked_at')} AS revoked_at, c.revoke_reason
  FROM staff_conflict_declarations c LEFT JOIN users su ON su.id = c.staff_user_id LEFT JOIN users mu ON mu.id = c.member_user_id`;

export interface InviteRow {
  id: string; phoneMasked: string; roleCode: string; deskIds: string[]; invitedBy: string; invitedByName: string | null; languageCode: string; channel: string;
  status: string; expiresAt: string; sentAt: string | null; sendFailure: string | null; acceptedUserId: string | null; acceptedAt: string | null;
  revokedBy: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string; cursorTs: string; live: boolean;
}
const toInvite = (x: any): InviteRow => ({
  id: x.id, phoneMasked: maskPhone(x.phone), roleCode: x.role_code, deskIds: x.desk_ids ?? [], invitedBy: x.invited_by, invitedByName: x.invited_by_name ?? null,
  languageCode: x.language_code, channel: x.channel, status: x.status, expiresAt: x.expires_at, sentAt: x.sent_at ?? null, sendFailure: x.send_failure ?? null,
  acceptedUserId: x.accepted_user_id ?? null, acceptedAt: x.accepted_at ?? null, revokedBy: x.revoked_by ?? null, revokedAt: x.revoked_at ?? null,
  revokeReason: x.revoke_reason ?? null, createdAt: x.created_at, cursorTs: x.cursor_ts, live: Boolean(x.live),
});
const INVITE_SQL = `SELECT i.id, i.phone, r.code AS role_code, i.desk_ids, i.invited_by, u.full_name AS invited_by_name, i.language_code, i.channel, i.status,
  ${iso('i.expires_at')} AS expires_at, ${iso('i.sent_at')} AS sent_at, i.send_failure, i.accepted_user_id, ${iso('i.accepted_at')} AS accepted_at,
  i.revoked_by, ${iso('i.revoked_at')} AS revoked_at, i.revoke_reason, ${iso('i.created_at')} AS created_at, ${US_SQL('i.created_at')} AS cursor_ts,
  (i.status = 'pending' AND i.expires_at > now()) AS live
  FROM staff_invites i JOIN roles r ON r.id = i.role_id LEFT JOIN users u ON u.id = i.invited_by`;

export interface OverrideRow {
  userTenantRoleId: string; roleCode: string; permissionCode: string; isGranted: boolean; reason: string; grantedBy: string | null; grantedByName: string | null;
  grantedAt: string | null; expiresAt: string | null; revokedAt: string | null; revokedBy: string | null; revokeReason: string | null; proposalId: string | null;
  live: boolean; legacy: boolean;
}
export interface OverrideProposalRow {
  id: string; userTenantRoleId: string; granteeUserId: string; granteeName: string | null; permissionCode: string; overrideExpiresAt: string | null; reason: string;
  proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string; status: string; confirmedBy: string | null; confirmedAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; cursorTs: string;
}
const toProposal = (x: any): OverrideProposalRow => ({
  id: x.id, userTenantRoleId: x.user_tenant_role_id, granteeUserId: x.grantee_user_id, granteeName: x.grantee_name ?? null, permissionCode: x.permission_code,
  overrideExpiresAt: x.override_expires_at ?? null, reason: x.reason, proposedBy: x.proposed_by, proposedByName: x.proposed_by_name ?? null, proposedAt: x.proposed_at,
  expiresAt: x.expires_at, status: x.status, confirmedBy: x.confirmed_by ?? null, confirmedAt: x.confirmed_at ?? null, refusedBy: x.refused_by ?? null,
  refusedAt: x.refused_at ?? null, refuseReason: x.refuse_reason ?? null, cursorTs: x.cursor_ts,
});
const PROPOSAL_SQL = `SELECT p.id, p.user_tenant_role_id, p.grantee_user_id, g.full_name AS grantee_name, p.permission_code, ${iso('p.override_expires_at')} AS override_expires_at,
  p.reason, p.proposed_by, pu.full_name AS proposed_by_name, ${iso('p.proposed_at')} AS proposed_at, ${iso('p.expires_at')} AS expires_at, p.status, p.confirmed_by,
  ${iso('p.confirmed_at')} AS confirmed_at, p.refused_by, ${iso('p.refused_at')} AS refused_at, p.refuse_reason, ${US_SQL('p.proposed_at')} AS cursor_ts
  FROM staff_override_proposals p LEFT JOIN users g ON g.id = p.grantee_user_id LEFT JOIN users pu ON pu.id = p.proposed_by`;

export interface StaffListRow {
  userId: string; name: string | null; roles: string[]; desks: Array<{ id: string; code: string; name: string }>; overrides: number; twoFactor: 'confirmed' | 'pending' | 'not_enrolled';
  lastActiveAt: string | null; since: string; cursorTs: string; suspended: boolean;
}

@Injectable()
export class VerificationTeamRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string) { return this.replica.forTenant(tenantId); }

  // ═══════════════════════════════════════════════ A · claims
  /** The caller's live claim (unreleased, unexpired) — and the pending document it holds. */
  async liveClaimOfTx(tx: TxContext, tenantId: string, userId: string): Promise<ClaimRow | null> {
    const r = await tx.query(`SELECT ${CLAIM_COLS} FROM kyc_claims c WHERE c.tenant_id = $1 AND c.claimed_by = $2 AND c.released_at IS NULL AND c.expires_at > now() FOR UPDATE`, [tenantId, userId]);
    return r.rows[0] ? toClaim(r.rows[0]) : null;
  }
  async claimByIdTx(tx: TxContext, tenantId: string, id: string): Promise<ClaimRow | null> {
    const r = await tx.query(`SELECT ${CLAIM_COLS} FROM kyc_claims c WHERE c.tenant_id = $1 AND c.id = $2 FOR UPDATE`, [tenantId, id]);
    return r.rows[0] ? toClaim(r.rows[0]) : null;
  }
  async documentStatusTx(tx: TxContext, tenantId: string, documentId: string): Promise<string | null> {
    const r = await tx.query<{ status: string }>(`SELECT status::text AS status FROM kyc_documents WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, documentId]);
    return r.rows[0]?.status ?? null;
  }
  /** Release every STALE claim this person still holds (so the one-live-claim-per-person index frees). */
  async releaseOwnStaleTx(tx: TxContext, tenantId: string, userId: string): Promise<number> {
    const r = await tx.query(`UPDATE kyc_claims SET released_at = now(), release_kind = 'expired' WHERE tenant_id = $1 AND claimed_by = $2 AND released_at IS NULL AND expires_at <= now()`, [tenantId, userId]);
    return r.rowCount ?? 0;
  }
  /**
   * THE CLAIM (W157 "Take next"): the OLDEST pending MEMBER document the claimant may decide — not theirs, not submitted by them, not one
   * they are recused from (0199 `kv_kyc_recusal`: a declared conflict, or they onboarded the member), not live-claimed by anyone —
   * locked FOR UPDATE SKIP LOCKED, so two people taking next at the same instant get two different documents.
   */
  async lockNextTx(tx: TxContext, tenantId: string, userId: string, excludeDocumentId: string | null): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT k.id FROM kyc_documents k
        WHERE k.tenant_id = $1 AND k.deleted_at IS NULL AND k.status = 'pending' AND k.subject_kind = 'user'
          AND k.submitted_by <> $2 AND k.user_id <> $2
          AND kv_kyc_recusal($1, $2, k.user_id) IS NULL
          AND ($3::uuid IS NULL OR k.id <> $3::uuid)
          AND NOT EXISTS (SELECT 1 FROM kyc_claims c WHERE c.document_id = k.id AND c.released_at IS NULL AND c.expires_at > now())
        ORDER BY k.created_at, k.id
        FOR UPDATE OF k SKIP LOCKED
        LIMIT 1`, [tenantId, userId, excludeDocumentId]);
    return r.rows[0]?.id ?? null;
  }
  async releaseStaleOnDocTx(tx: TxContext, tenantId: string, documentId: string): Promise<void> {
    await tx.query(`UPDATE kyc_claims SET released_at = now(), release_kind = 'expired' WHERE tenant_id = $1 AND document_id = $2 AND released_at IS NULL AND expires_at <= now()`, [tenantId, documentId]);
  }
  async insertClaimTx(tx: TxContext, tenantId: string, documentId: string, userId: string): Promise<ClaimRow> {
    const r = await tx.query(`INSERT INTO kyc_claims (tenant_id, document_id, claimed_by, expires_at) VALUES ($1, $2, $3, now() + interval '15 minutes')
      RETURNING id, document_id, claimed_by, ${iso('claimed_at')} AS claimed_at, ${iso('expires_at')} AS expires_at, NULL::text AS released_at, NULL::text AS release_kind`, [tenantId, documentId, userId]);
    return toClaim(r.rows[0]);
  }
  async releaseTx(tx: TxContext, tenantId: string, id: string, by: string, kind: 'skip' | 'released', skipReason: string | null, note: string | null): Promise<number> {
    const r = await tx.query(`UPDATE kyc_claims SET released_at = now(), released_by = $3, release_kind = $4, skip_reason_code = $5, release_note = $6
      WHERE tenant_id = $1 AND id = $2 AND released_at IS NULL`, [tenantId, id, by, kind, skipReason, note]);
    return r.rowCount ?? 0;
  }
  /** A decision closes any live claim on the document (`decided`). */
  async releaseForDecisionTx(tx: TxContext, tenantId: string, documentId: string, by: string): Promise<void> {
    await tx.query(`UPDATE kyc_claims SET released_at = now(), released_by = $3, release_kind = 'decided' WHERE tenant_id = $1 AND document_id = $2 AND released_at IS NULL`, [tenantId, documentId, by]);
  }
  async staleClaimIdsTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM kyc_claims WHERE tenant_id = $1 AND released_at IS NULL AND expires_at <= now() ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [tenantId, limit]);
    return r.rows.map((x) => x.id);
  }
  async expireClaimTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`UPDATE kyc_claims SET released_at = now(), release_kind = 'expired' WHERE tenant_id = $1 AND id = $2 AND released_at IS NULL AND expires_at <= now()`, [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }
  /** The live claim on a document (who holds it — the service masks the name for anyone but the holder). */
  async liveClaimOnDoc(tenantId: string, documentId: string, tx?: TxContext): Promise<(ClaimRow & { claimedByName: string | null }) | null> {
    const q = tx ?? this.db(tenantId);
    const r = await q.query(`SELECT ${CLAIM_COLS}, u.full_name AS claimed_by_name FROM kyc_claims c LEFT JOIN users u ON u.id = c.claimed_by
      WHERE c.tenant_id = $1 AND c.document_id = $2 AND c.released_at IS NULL AND c.expires_at > now()`, [tenantId, documentId]);
    const x = r.rows[0];
    return x ? { ...toClaim(x), claimedByName: x.claimed_by_name ?? null } : null;
  }
  /** The recusal code for (staff, member), as the database judges it (0199 `kv_kyc_recusal`). */
  async recusal(tenantId: string, staffUserId: string, memberUserId: string | null, tx?: TxContext): Promise<string | null> {
    if (!memberUserId) return null;
    const q = tx ?? this.db(tenantId);
    const r = await q.query<{ v: string | null }>(`SELECT kv_kyc_recusal($1, $2, $3) AS v`, [tenantId, staffUserId, memberUserId]);
    return r.rows[0]?.v ?? null;
  }
  /** Who onboarded this member (the creators of their role rows here, never themselves) — names for the W158 banner. */
  async onboarders(tenantId: string, memberUserId: string): Promise<Array<{ userId: string; name: string | null }>> {
    const r = await this.db(tenantId).query<any>(
      `SELECT DISTINCT u.created_by AS user_id, cu.full_name AS name FROM user_tenant_roles u LEFT JOIN users cu ON cu.id = u.created_by
        WHERE u.tenant_id = $1 AND u.user_id = $2 AND u.created_by IS NOT NULL AND u.created_by <> u.user_id`, [tenantId, memberUserId]);
    return r.rows.map((x: any) => ({ userId: x.user_id, name: x.name ?? null }));
  }

  /** W157 "Median verify time (7d)": median(decided_at − submitted_at) over the desk's decisions of the last 7 days. */
  async medianDecisionSeconds(tenantId: string, days: number): Promise<{ seconds: number | null; decisions: number }> {
    const r = await this.db(tenantId).query<{ median: string | null; n: number }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.decided_at - k.created_at)))::text AS median, count(*)::int AS n
         FROM kyc_document_decisions d JOIN kyc_documents k ON k.id = d.document_id AND k.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.act IN ('verify', 'reject', 'request_more') AND d.via = 'desk' AND d.decided_at >= now() - make_interval(days => $2)`, [tenantId, days]);
    const x = r.rows[0];
    return { seconds: x && x.median !== null ? Math.round(Number(x.median)) : null, decisions: Number(x?.n ?? 0) };
  }
  async pendingClaimedCount(tenantId: string): Promise<number> {
    const r = await this.db(tenantId).query<{ n: number }>(`SELECT count(*)::int AS n FROM kyc_claims WHERE tenant_id = $1 AND released_at IS NULL AND expires_at > now()`, [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  /**
   * W158 "What unlocks on verify" — a READ of the 0125 money gate: for each active role of the subject that this document's type
   * evidences (0180 `kyc_doc_type_roles`), its effective KYC status and the payout purposes (`payout_purpose_roles`) that role's gate
   * governs. A role not yet verified is what this decision would unlock; a verified one is already open.
   */
  async unlocks(tenantId: string, memberUserId: string, docTypeCode: string): Promise<Array<{ roleCode: string; effective: string; purposes: string[] }>> {
    const r = await this.db(tenantId).query<any>(
      `SELECT r.code AS role_code, kyc_role_effective_status(utr.tenant_id, utr.user_id, r.code, utr.kyc_status::text) AS effective,
              COALESCE(array_agg(DISTINCT ppr.purpose_code ORDER BY ppr.purpose_code) FILTER (WHERE ppr.purpose_code IS NOT NULL), '{}') AS purposes
         FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
         JOIN kyc_doc_type_roles m ON m.role_code = r.code AND m.doc_type_code = $3 AND m.deleted_at IS NULL
         LEFT JOIN payout_purpose_roles ppr ON ppr.role_code = r.code AND ppr.deleted_at IS NULL
        WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.is_active AND utr.deleted_at IS NULL
        GROUP BY r.code, utr.tenant_id, utr.user_id, utr.kyc_status ORDER BY r.code`, [tenantId, memberUserId, docTypeCode]);
    return r.rows.map((x: any) => ({ roleCode: x.role_code, effective: x.effective, purposes: x.purposes ?? [] }));
  }
  /** W158 "already vault-verified for worker role — reused": the subject's OTHER verified, in-date documents whose evidenced roles
   *  overlap this document's — read, never typed. */
  async evidenceReuse(tenantId: string, memberUserId: string, documentId: string, docTypeCode: string): Promise<Array<{ documentId: string; docTypeCode: string; roles: string[]; viaProvider: boolean; verifiedAt: string | null }>> {
    const r = await this.db(tenantId).query<any>(
      `SELECT o.id, o.doc_type_code, (o.verify_method LIKE 'ekyc:%') AS via_provider, ${iso('o.reviewed_at')} AS verified_at,
              array_agg(DISTINCT m2.role_code ORDER BY m2.role_code) AS roles
         FROM kyc_documents o JOIN kyc_doc_type_roles m2 ON m2.doc_type_code = o.doc_type_code AND m2.deleted_at IS NULL
        WHERE o.tenant_id = $1 AND o.user_id = $2 AND o.id <> $3 AND o.status = 'verified' AND o.deleted_at IS NULL
          AND (o.valid_until IS NULL OR o.valid_until >= kyc_tenant_today($1))
          AND m2.role_code IN (SELECT m.role_code FROM kyc_doc_type_roles m WHERE m.doc_type_code = $4 AND m.deleted_at IS NULL)
        GROUP BY o.id, o.doc_type_code, o.verify_method, o.reviewed_at ORDER BY o.reviewed_at DESC NULLS LAST LIMIT 10`, [tenantId, memberUserId, documentId, docTypeCode]);
    return r.rows.map((x: any) => ({ documentId: x.id, docTypeCode: x.doc_type_code, roles: x.roles ?? [], viaProvider: Boolean(x.via_provider), verifiedAt: x.verified_at ?? null }));
  }

  // ═══════════════════════════════════════════════ A3 · conflicts
  async conflictsOfStaff(tenantId: string, staffUserId: string, includeLifted = true): Promise<ConflictRow[]> {
    const r = await this.db(tenantId).query(`${CONFLICT_SQL} WHERE c.tenant_id = $1 AND c.staff_user_id = $2 ${includeLifted ? '' : 'AND c.active'} ORDER BY c.active DESC, c.created_at DESC LIMIT 200`, [tenantId, staffUserId]);
    return r.rows.map(toConflict);
  }
  async conflictByIdTx(tx: TxContext, tenantId: string, id: string): Promise<ConflictRow | null> {
    const r = await tx.query(`${CONFLICT_SQL} WHERE c.tenant_id = $1 AND c.id = $2 FOR UPDATE OF c`, [tenantId, id]);
    return r.rows[0] ? toConflict(r.rows[0]) : null;
  }
  async insertConflictTx(tx: TxContext, c: { tenantId: string; staffUserId: string; memberUserId: string; relation: string; relationNote: string | null; reason: string; declaredBy: string; via: 'self' | 'admin' }): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO staff_conflict_declarations (tenant_id, staff_user_id, member_user_id, relation, relation_note, reason, declared_by, declared_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [c.tenantId, c.staffUserId, c.memberUserId, c.relation, c.relationNote, c.reason, c.declaredBy, c.via]);
    return r.rows[0].id;
  }
  async liftConflictTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE staff_conflict_declarations SET active = false, revoked_by = $3, revoked_at = now(), revoke_reason = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, by, reason]);
  }
  /** Members of this tenant a staff member may name in a declaration (a search by name — the form's picker; no phones). */
  async memberSearch(tenantId: string, q: string, limit = 20): Promise<Array<{ userId: string; name: string | null; roles: string[] }>> {
    const r = await this.db(tenantId).query<any>(
      `SELECT u.id AS user_id, u.full_name AS name, array_agg(DISTINCT ro.code ORDER BY ro.code) AS roles
         FROM user_tenant_roles utr JOIN users u ON u.id = utr.user_id JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL AND ($2 = '' OR u.full_name ILIKE '%' || $2 || '%')
        GROUP BY u.id, u.full_name ORDER BY u.full_name NULLS LAST, u.id LIMIT $3`, [tenantId, q, limit]);
    return r.rows.map((x: any) => ({ userId: x.user_id, name: x.name ?? null, roles: x.roles ?? [] }));
  }

  // ═══════════════════════════════════════════════ B1 · seats
  async seatPlan(tenantId: string, tx?: TxContext): Promise<{ planCode: string; planName: string; seats: number | null; defined: boolean } | null> {
    const q = tx ?? this.db(tenantId);
    const r = await q.query<any>(`SELECT plan_code, plan_name, seats, defined FROM kv_staff_seat_plan($1)`, [tenantId]);
    const x = r.rows[0];
    return x ? { planCode: x.plan_code, planName: x.plan_name, seats: x.seats === null ? null : Number(x.seats), defined: Boolean(x.defined) } : null;
  }
  async seatsUsed(tenantId: string, tx?: TxContext): Promise<number> {
    const q = tx ?? this.db(tenantId);
    const r = await q.query<{ n: number }>(`SELECT kv_staff_seats_used($1) AS n`, [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  async holdsSeatTx(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id WHERE u.tenant_id = $1 AND u.user_id = $2 AND r.is_staff
      AND u.deleted_at IS NULL AND u.revoked_at IS NULL AND (u.is_active OR u.approved_at IS NULL) LIMIT 1`, [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  async staffRoleCodes(tenantId: string): Promise<string[]> {
    const r = await this.db(tenantId).query<{ code: string }>(`SELECT code FROM roles WHERE is_staff AND deleted_at IS NULL AND is_active ORDER BY code`);
    return r.rows.map((x) => x.code);
  }
  async roleByCodeTx(tx: TxContext, code: string): Promise<{ id: string; code: string; isStaff: boolean; isPlatform: boolean } | null> {
    const r = await tx.query<any>(`SELECT id, code, is_staff, scope FROM roles WHERE code = $1 AND deleted_at IS NULL AND is_active`, [code]);
    const x = r.rows[0];
    return x ? { id: x.id, code: x.code, isStaff: Boolean(x.is_staff), isPlatform: x.scope === 'platform' } : null;
  }
  async activeAdminIdsTx(tx: TxContext, tenantId: string): Promise<string[]> {
    const r = await tx.query<{ user_id: string }>(`SELECT DISTINCT utr.user_id FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
      WHERE utr.tenant_id = $1 AND r.code = 'tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL AND kv_is_tenant_admin($1, utr.user_id)`, [tenantId]);
    return r.rows.map((x) => x.user_id);
  }

  // ═══════════════════════════════════════════════ B4 · the team table (W183) and one staff member (W184)
  /** Everyone holding a staff role (active, or awaiting approval, not revoked) — µs keyset on the earliest staff role's instant. */
  async staffList(tenantId: string, opts: { cursor?: KeysetCursor; limit: number }): Promise<StaffListRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const cur = opts.cursor ? `WHERE (s.since, s.user_id) < (${p(opts.cursor.ts)}::timestamptz, ${p(opts.cursor.id)}::uuid)` : '';
    const lim = p(Math.min(Math.max(opts.limit, 1), 100));
    const r = await this.db(tenantId).query<any>(
      `WITH s AS (
         SELECT utr.user_id, min(utr.created_at) AS since, array_agg(DISTINCT r.code ORDER BY r.code) AS roles
           FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
          WHERE utr.tenant_id = $1 AND r.is_staff AND utr.deleted_at IS NULL AND utr.revoked_at IS NULL AND (utr.is_active OR utr.approved_at IS NULL)
          GROUP BY utr.user_id)
       SELECT s.user_id, u.full_name AS name, s.roles, ${US_SQL('s.since')} AS cursor_ts, ${iso('s.since')} AS since, ${iso('u.last_active_at')} AS last_active_at,
              COALESCE((SELECT json_agg(json_build_object('id', d.id, 'code', d.code, 'name', d.name) ORDER BY d.code)
                          FROM desk_members dm JOIN desks d ON d.id = dm.desk_id AND d.tenant_id = $1
                         WHERE dm.tenant_id = $1 AND dm.user_id = s.user_id AND dm.removed_at IS NULL), '[]'::json) AS desks,
              (SELECT count(*)::int FROM staff_permission_overrides spo JOIN user_tenant_roles a ON a.id = spo.user_tenant_role_id
                WHERE a.tenant_id = $1 AND a.user_id = s.user_id AND a.deleted_at IS NULL AND spo.revoked_at IS NULL AND (spo.expires_at IS NULL OR spo.expires_at > now())) AS overrides,
              CASE WHEN t.confirmed_at IS NOT NULL AND t.disabled_at IS NULL THEN 'confirmed' WHEN t.user_id IS NOT NULL AND t.disabled_at IS NULL THEN 'pending' ELSE 'not_enrolled' END AS two_factor,
              EXISTS (SELECT 1 FROM tenant_member_suspensions kvs WHERE kvs.tenant_id = $1 AND kvs.user_id = s.user_id AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL) AS suspended
         FROM s JOIN users u ON u.id = s.user_id LEFT JOIN user_totp t ON t.user_id = s.user_id
         ${cur}
        ORDER BY s.since DESC, s.user_id DESC LIMIT ${lim}`, params);
    return r.rows.map((x: any) => ({
      userId: x.user_id, name: x.name ?? null, roles: x.roles ?? [], desks: x.desks ?? [], overrides: Number(x.overrides ?? 0), twoFactor: x.two_factor,
      lastActiveAt: x.last_active_at ?? null, since: x.since, cursorTs: x.cursor_ts, suspended: Boolean(x.suspended),
    }));
  }

  /** Effective permissions of every listed person — the role-cache resolution (roles ∪ live grants ∪ desks − live denies), in one query. */
  async effectivePermissions(tenantId: string, userIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (userIds.length === 0) return out;
    const r = await this.db(tenantId).query<{ user_id: string; codes: string[] }>(
      `WITH act AS (
         SELECT utr.id AS utr_id, utr.user_id, utr.role_id FROM user_tenant_roles utr
          WHERE utr.tenant_id = $1 AND utr.user_id = ANY($2::uuid[]) AND utr.is_active AND utr.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions kvs WHERE kvs.tenant_id = $1 AND kvs.user_id = utr.user_id AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL)),
       base AS (SELECT a.user_id, rp.permission_code AS code FROM act a JOIN role_permissions rp ON rp.role_id = a.role_id),
       grants AS (SELECT a.user_id, spo.permission_code AS code FROM act a JOIN staff_permission_overrides spo ON spo.user_tenant_role_id = a.utr_id
                   WHERE spo.is_granted AND spo.revoked_at IS NULL AND (spo.expires_at IS NULL OR spo.expires_at > now())),
       denies AS (SELECT a.user_id, spo.permission_code AS code FROM act a JOIN staff_permission_overrides spo ON spo.user_tenant_role_id = a.utr_id
                   WHERE NOT spo.is_granted AND spo.revoked_at IS NULL AND (spo.expires_at IS NULL OR spo.expires_at > now())),
       desk AS (SELECT dm.user_id, dp.permission_code AS code FROM desk_members dm
                  JOIN desks d ON d.id = dm.desk_id AND d.tenant_id = $1 AND d.status = 'active'
                  JOIN desk_permissions dp ON dp.desk_id = d.id AND dp.removed_at IS NULL
                 WHERE dm.tenant_id = $1 AND dm.removed_at IS NULL AND dm.user_id IN (SELECT user_id FROM act) AND NOT (dp.permission_code = ANY($3::text[]))),
       u AS (SELECT user_id, code FROM base UNION SELECT user_id, code FROM grants UNION SELECT user_id, code FROM desk)
       SELECT u.user_id, array_agg(DISTINCT u.code) AS codes FROM u
        WHERE NOT EXISTS (SELECT 1 FROM denies d WHERE d.user_id = u.user_id AND d.code = u.code)
        GROUP BY u.user_id`, [tenantId, userIds, [...UNGRANTABLE_PERMISSIONS]]);
    for (const x of r.rows) out.set(x.user_id, new Set(x.codes ?? []));
    return out;
  }

  async staffPerson(tenantId: string, userId: string): Promise<null | {
    userId: string; name: string | null; lastActiveAt: string | null; twoFactor: 'confirmed' | 'pending' | 'not_enrolled'; twoFactorConfirmedAt: string | null; suspended: boolean;
    assignments: Array<{ id: string; roleCode: string; isStaff: boolean; isActive: boolean; approvedAt: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string; createdBy: string | null }>;
    desks: Array<{ id: string; code: string; name: string; addedAt: string; addedBy: string }>;
  }> {
    const db = this.db(tenantId);
    const u = await db.query<any>(`SELECT u.id, u.full_name, ${iso('u.last_active_at')} AS last_active_at, ${iso('t.confirmed_at')} AS confirmed_at,
        CASE WHEN t.confirmed_at IS NOT NULL AND t.disabled_at IS NULL THEN 'confirmed' WHEN t.user_id IS NOT NULL AND t.disabled_at IS NULL THEN 'pending' ELSE 'not_enrolled' END AS two_factor,
        EXISTS (SELECT 1 FROM tenant_member_suspensions kvs WHERE kvs.tenant_id = $1 AND kvs.user_id = u.id AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL) AS suspended
      FROM users u LEFT JOIN user_totp t ON t.user_id = u.id
      WHERE u.id = $2 AND EXISTS (SELECT 1 FROM user_tenant_roles x WHERE x.tenant_id = $1 AND x.user_id = u.id AND x.deleted_at IS NULL)`, [tenantId, userId]);
    const x = u.rows[0];
    if (!x) return null;
    const [a, d] = await Promise.all([
      db.query<any>(`SELECT utr.id, r.code AS role_code, r.is_staff, utr.is_active, ${iso('utr.approved_at')} AS approved_at, ${iso('utr.revoked_at')} AS revoked_at, utr.revoke_reason,
          ${iso('utr.created_at')} AS created_at, utr.created_by
        FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.deleted_at IS NULL ORDER BY r.is_staff DESC, r.code`, [tenantId, userId]),
      db.query<any>(`SELECT d.id, d.code, d.name, ${iso('dm.added_at')} AS added_at, dm.added_by FROM desk_members dm JOIN desks d ON d.id = dm.desk_id AND d.tenant_id = $1
        WHERE dm.tenant_id = $1 AND dm.user_id = $2 AND dm.removed_at IS NULL ORDER BY d.code`, [tenantId, userId]),
    ]);
    return {
      userId: x.id, name: x.full_name ?? null, lastActiveAt: x.last_active_at ?? null, twoFactor: x.two_factor, twoFactorConfirmedAt: x.confirmed_at ?? null, suspended: Boolean(x.suspended),
      assignments: a.rows.map((y: any) => ({ id: y.id, roleCode: y.role_code, isStaff: Boolean(y.is_staff), isActive: Boolean(y.is_active), approvedAt: y.approved_at ?? null,
        revokedAt: y.revoked_at ?? null, revokeReason: y.revoke_reason ?? null, createdAt: y.created_at, createdBy: y.created_by ?? null })),
      desks: d.rows.map((y: any) => ({ id: y.id, code: y.code, name: y.name, addedAt: y.added_at, addedBy: y.added_by })),
    };
  }

  async overridesOf(tenantId: string, userId: string): Promise<OverrideRow[]> {
    const r = await this.db(tenantId).query<any>(
      `SELECT spo.user_tenant_role_id, r.code AS role_code, spo.permission_code, spo.is_granted, spo.reason, spo.granted_by, gu.full_name AS granted_by_name,
              ${iso('spo.granted_at')} AS granted_at, ${iso('spo.expires_at')} AS expires_at, ${iso('spo.revoked_at')} AS revoked_at, spo.revoked_by, spo.revoke_reason, spo.proposal_id,
              (spo.revoked_at IS NULL AND (spo.expires_at IS NULL OR spo.expires_at > now())) AS live
         FROM staff_permission_overrides spo JOIN user_tenant_roles utr ON utr.id = spo.user_tenant_role_id JOIN roles r ON r.id = utr.role_id
         LEFT JOIN users gu ON gu.id = spo.granted_by
        WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.deleted_at IS NULL
        ORDER BY live DESC, spo.granted_at DESC NULLS LAST, spo.permission_code`, [tenantId, userId]);
    return r.rows.map((x: any) => ({
      userTenantRoleId: x.user_tenant_role_id, roleCode: x.role_code, permissionCode: x.permission_code, isGranted: Boolean(x.is_granted), reason: x.reason,
      grantedBy: x.granted_by ?? null, grantedByName: x.granted_by_name ?? null, grantedAt: x.granted_at ?? null, expiresAt: x.expires_at ?? null,
      revokedAt: x.revoked_at ?? null, revokedBy: x.revoked_by ?? null, revokeReason: x.revoke_reason ?? null, proposalId: x.proposal_id ?? null,
      live: Boolean(x.live), legacy: String(x.reason).startsWith('legacy: no reason recorded'),
    }));
  }

  // ═══════════════════════════════════════════════ C · overrides (writes) + proposals
  async upsertOverrideTx(tx: TxContext, o: { utrId: string; code: string; isGranted: boolean; reason: string; expiresAt: string | null; by: string }): Promise<void> {
    await tx.query(
      `INSERT INTO staff_permission_overrides (user_tenant_role_id, permission_code, is_granted, reason, granted_by, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, now(), $6::timestamptz)
       ON CONFLICT (user_tenant_role_id, permission_code) DO UPDATE
          SET is_granted = EXCLUDED.is_granted, reason = EXCLUDED.reason, granted_by = EXCLUDED.granted_by, granted_at = now(), expires_at = EXCLUDED.expires_at,
              revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL`, [o.utrId, o.code, o.isGranted, o.reason, o.by, o.expiresAt]);
  }
  async revokeOverrideTx(tx: TxContext, utrId: string, code: string, by: string, reason: string): Promise<number> {
    const r = await tx.query(`UPDATE staff_permission_overrides SET revoked_at = now(), revoked_by = $3, revoke_reason = $4 WHERE user_tenant_role_id = $1 AND permission_code = $2 AND revoked_at IS NULL`, [utrId, code, by, reason]);
    return r.rowCount ?? 0;
  }
  async revokeAllOverridesTx(tx: TxContext, utrId: string, by: string, reason: string): Promise<string[]> {
    const r = await tx.query<{ permission_code: string }>(`UPDATE staff_permission_overrides SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE user_tenant_role_id = $1 AND revoked_at IS NULL RETURNING permission_code`, [utrId, by, reason]);
    return r.rows.map((x) => x.permission_code);
  }
  async insertProposalTx(tx: TxContext, p: { tenantId: string; utrId: string; granteeUserId: string; code: string; overrideExpiresAt: string | null; reason: string; proposedBy: string }): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO staff_override_proposals (tenant_id, user_tenant_role_id, grantee_user_id, permission_code, override_expires_at, reason, proposed_by, expires_at)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7, now() + interval '7 days') RETURNING id`, [p.tenantId, p.utrId, p.granteeUserId, p.code, p.overrideExpiresAt, p.reason, p.proposedBy]);
    return r.rows[0].id;
  }
  async proposalForUpdate(tx: TxContext, tenantId: string, id: string): Promise<OverrideProposalRow | null> {
    const r = await tx.query(`${PROPOSAL_SQL} WHERE p.tenant_id = $1 AND p.id = $2 FOR UPDATE OF p`, [tenantId, id]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }
  async confirmProposalTx(tx: TxContext, tenantId: string, id: string, by: string): Promise<void> {
    await tx.query(`UPDATE staff_override_proposals SET status = 'confirmed', confirmed_by = $3, confirmed_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, by]);
  }
  async refuseProposalTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE staff_override_proposals SET status = 'refused', refused_by = $3, refused_at = now(), refuse_reason = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, by, reason]);
  }
  async proposals(tenantId: string, opts: { status?: string; userId?: string; cursor?: KeysetCursor; limit: number }): Promise<OverrideProposalRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = ['p.tenant_id = $1'];
    if (opts.status) where.push(`p.status = ${p(opts.status)}`);
    if (opts.userId) where.push(`p.grantee_user_id = ${p(opts.userId)}::uuid`);
    if (opts.cursor) where.push(`(p.proposed_at, p.id) < (${p(opts.cursor.ts)}::timestamptz, ${p(opts.cursor.id)}::uuid)`);
    const lim = p(Math.min(Math.max(opts.limit, 1), 100));
    const r = await this.db(tenantId).query(`${PROPOSAL_SQL} WHERE ${where.join(' AND ')} ORDER BY p.proposed_at DESC, p.id DESC LIMIT ${lim}`, params);
    return r.rows.map(toProposal);
  }
  async checkerCodes(tenantId: string, tx?: TxContext): Promise<Map<string, string>> {
    const q = tx ?? this.db(tenantId);
    const r = await q.query<{ code: string; class: string }>(`SELECT code, class FROM override_checker_codes ORDER BY code`);
    return new Map(r.rows.map((x) => [x.code, x.class]));
  }

  // ═══════════════════════════════════════════════ C2 · removal
  async utrForUpdate(tx: TxContext, tenantId: string, id: string): Promise<{ id: string; userId: string; roleCode: string; isStaff: boolean; isActive: boolean; revokedAt: string | null } | null> {
    const r = await tx.query<any>(`SELECT utr.id, utr.user_id, r.code AS role_code, r.is_staff, utr.is_active, utr.revoked_at::text AS revoked_at
      FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id WHERE utr.tenant_id = $1 AND utr.id = $2 AND utr.deleted_at IS NULL FOR UPDATE OF utr`, [tenantId, id]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, roleCode: x.role_code, isStaff: Boolean(x.is_staff), isActive: Boolean(x.is_active), revokedAt: x.revoked_at ?? null } : null;
  }
  async revokeUtrTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE user_tenant_roles SET is_active = false, revoked_at = now(), revoked_by = $3, revoke_reason = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, by, reason]);
  }
  async otherLiveStaffRoleTx(tx: TxContext, tenantId: string, userId: string, exceptUtrId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id WHERE u.tenant_id = $1 AND u.user_id = $2 AND u.id <> $3 AND r.is_staff
      AND u.deleted_at IS NULL AND u.revoked_at IS NULL AND u.is_active LIMIT 1`, [tenantId, userId, exceptUtrId]);
    return (r.rowCount ?? 0) > 0;
  }
  async liveDeskIdsTx(tx: TxContext, tenantId: string, userId: string): Promise<string[]> {
    const r = await tx.query<{ desk_id: string }>(`SELECT desk_id FROM desk_members WHERE tenant_id = $1 AND user_id = $2 AND removed_at IS NULL`, [tenantId, userId]);
    return r.rows.map((x) => x.desk_id);
  }
  async cutSessionsTx(tx: TxContext, tenantId: string, userId: string, by: string, reason: string): Promise<string> {
    const r = await tx.query<{ at: string }>(
      `INSERT INTO tenant_session_revocations (tenant_id, user_id, revoked_after, revoked_by, reason) VALUES ($1, $2, now(), $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET revoked_after = now(), revoked_by = EXCLUDED.revoked_by, reason = EXCLUDED.reason, updated_at = now()
       RETURNING ${iso('revoked_after')} AS at`, [tenantId, userId, by, reason]);
    return r.rows[0].at;
  }
  async sessionCutoff(tenantId: string, userId: string): Promise<string | null> {
    const r = await this.db(tenantId).query<{ at: string }>(`SELECT ${iso('revoked_after')} AS at FROM tenant_session_revocations WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
    return r.rows[0]?.at ?? null;
  }

  // ═══════════════════════════════════════════════ B2 · invites
  async insertInviteTx(tx: TxContext, i: { tenantId: string; phone: string; roleId: string; deskIds: string[]; invitedBy: string; languageCode: string; tokenHash: string; tokenSealedFor: (id: string) => string }): Promise<{ id: string; expiresAt: string }> {
    const id = (await tx.query<{ id: string }>(`SELECT uuid_generate_v7() AS id`)).rows[0].id;
    const r = await tx.query<{ id: string; expires_at: string }>(
      `INSERT INTO staff_invites (id, tenant_id, phone, role_id, desk_ids, invited_by, language_code, channel, token_hash, token_sealed, expires_at)
       VALUES ($1,$2,$3,$4,$5::uuid[],$6,$7,'sms',$8,$9, now() + interval '7 days') RETURNING id, ${iso('expires_at')} AS expires_at`,
      [id, i.tenantId, i.phone, i.roleId, i.deskIds, i.invitedBy, i.languageCode, i.tokenHash, i.tokenSealedFor(id)]);
    return { id: r.rows[0].id, expiresAt: r.rows[0].expires_at };
  }
  async inviteForUpdate(tx: TxContext, tenantId: string, id: string): Promise<(InviteRow & { phone: string; roleId: string; tokenSealed: string | null; expired: boolean }) | null> {
    const r = await tx.query<any>(`${INVITE_SQL.replace('SELECT i.id,', 'SELECT i.role_id, i.token_sealed, (i.expires_at <= now()) AS expired, i.id,')} WHERE i.tenant_id = $1 AND i.id = $2 FOR UPDATE OF i`, [tenantId, id]);
    const x = r.rows[0];
    return x ? { ...toInvite(x), phone: x.phone, roleId: x.role_id, tokenSealed: x.token_sealed ?? null, expired: Boolean(x.expired) } : null;
  }
  async inviteByHashForUpdate(tx: TxContext, tenantId: string, hash: string): Promise<(InviteRow & { phone: string; roleId: string; expired: boolean }) | null> {
    const r = await tx.query<any>(`${INVITE_SQL.replace('SELECT i.id,', 'SELECT i.role_id, (i.expires_at <= now()) AS expired, i.id,')} WHERE i.tenant_id = $1 AND i.token_hash = $2 FOR UPDATE OF i`, [tenantId, hash]);
    const x = r.rows[0];
    return x ? { ...toInvite(x), phone: x.phone, roleId: x.role_id, expired: Boolean(x.expired) } : null;
  }
  async pendingInviteForPhoneTx(tx: TxContext, tenantId: string, phone: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM staff_invites WHERE tenant_id = $1 AND phone = $2 AND status = 'pending'`, [tenantId, phone]);
    return r.rows[0]?.id ?? null;
  }
  async markInviteSentTx(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE staff_invites SET sent_at = now(), token_sealed = NULL, send_failure = NULL WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`, [tenantId, id]);
  }
  async markInviteSendFailedTx(tx: TxContext, tenantId: string, id: string, failure: string): Promise<void> {
    await tx.query(`UPDATE staff_invites SET send_failure = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`, [tenantId, id, failure.slice(0, 80)]);
  }
  async acceptInviteTx(tx: TxContext, tenantId: string, id: string, userId: string): Promise<void> {
    await tx.query(`UPDATE staff_invites SET status = 'accepted', accepted_user_id = $3, accepted_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, userId]);
  }
  async revokeInviteTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE staff_invites SET status = 'revoked', revoked_by = $3, revoked_at = now(), revoke_reason = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, by, reason]);
  }
  async expireInviteTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`UPDATE staff_invites SET status = 'expired', expired_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'pending' AND expires_at <= now()`, [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async invites(tenantId: string, opts: { status?: string; cursor?: KeysetCursor; limit: number }): Promise<InviteRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = ['i.tenant_id = $1'];
    if (opts.status) where.push(`i.status = ${p(opts.status)}`);
    if (opts.cursor) where.push(`(i.created_at, i.id) < (${p(opts.cursor.ts)}::timestamptz, ${p(opts.cursor.id)}::uuid)`);
    const lim = p(Math.min(Math.max(opts.limit, 1), 100));
    const r = await this.db(tenantId).query(`${INVITE_SQL} WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC, i.id DESC LIMIT ${lim}`, params);
    return r.rows.map(toInvite);
  }
  async activeDeskIdsTx(tx: TxContext, tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const r = await tx.query<{ id: string }>(`SELECT id FROM desks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [tenantId, ids]);
    return r.rows.map((x) => x.id);
  }
  async tenantName(tenantId: string, tx?: TxContext): Promise<string> {
    const q = tx ?? this.db(tenantId);
    const r = await q.query<{ n: string }>(`SELECT display_name AS n FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows[0]?.n ?? '';
  }

  // ═══════════════════════════════════════════════ B3 · 2FA (PERSON tables — keyed by user, no tenant)
  async totpForUpdate(tx: TxContext, userId: string): Promise<{ secretEnc: string; confirmedAt: string | null; lastUsedStep: number | null; disabledAt: string | null } | null> {
    const r = await tx.query<any>(`SELECT secret_enc, confirmed_at::text AS confirmed_at, last_used_step::text AS last_used_step, disabled_at::text AS disabled_at FROM user_totp WHERE user_id = $1 FOR UPDATE`, [userId]);
    const x = r.rows[0];
    return x ? { secretEnc: x.secret_enc, confirmedAt: x.confirmed_at ?? null, lastUsedStep: x.last_used_step === null ? null : Number(x.last_used_step), disabledAt: x.disabled_at ?? null } : null;
  }
  async totpState(tenantId: string, userId: string): Promise<{ enrolled: boolean; confirmed: boolean; confirmedAt: string | null; recoveryLeft: number }> {
    const r = await this.db(tenantId).query<any>(`SELECT t.confirmed_at IS NOT NULL AND t.disabled_at IS NULL AS confirmed, t.user_id IS NOT NULL AND t.disabled_at IS NULL AS enrolled,
        ${iso('t.confirmed_at')} AS confirmed_at,
        (SELECT count(*)::int FROM user_recovery_codes c WHERE c.user_id = $1 AND c.used_at IS NULL AND c.retired_at IS NULL) AS left
      FROM (SELECT $1::uuid AS uid) q LEFT JOIN user_totp t ON t.user_id = q.uid`, [userId]);
    const x = r.rows[0] ?? {};
    return { enrolled: Boolean(x.enrolled), confirmed: Boolean(x.confirmed), confirmedAt: x.confirmed ? (x.confirmed_at ?? null) : null, recoveryLeft: Number(x.left ?? 0) };
  }
  async insertTotpTx(tx: TxContext, userId: string, secretEnc: string): Promise<void> {
    await tx.query(`INSERT INTO user_totp (user_id, secret_enc) VALUES ($1, $2)`, [userId, secretEnc]);
  }
  async reEnrolTotpTx(tx: TxContext, userId: string, secretEnc: string): Promise<void> {
    await tx.query(`UPDATE user_totp SET secret_enc = $2, confirmed_at = NULL, last_used_step = NULL, last_used_at = NULL, disabled_at = NULL, disabled_reason = NULL WHERE user_id = $1`, [userId, secretEnc]);
  }
  async confirmTotpTx(tx: TxContext, userId: string, step: number): Promise<void> {
    await tx.query(`UPDATE user_totp SET confirmed_at = now(), last_used_step = $2, last_used_at = clock_timestamp() WHERE user_id = $1`, [userId, step]);
  }
  /** THE REPLAY GUARD: the step only ever increases — 0199's trigger refuses an equal or earlier one (`[TOTP_REPLAY]`). */
  async useTotpStepTx(tx: TxContext, userId: string, step: number): Promise<void> {
    await tx.query(`UPDATE user_totp SET last_used_step = $2, last_used_at = clock_timestamp() WHERE user_id = $1`, [userId, step]);
  }
  async disableTotpTx(tx: TxContext, userId: string, reason: string): Promise<void> {
    await tx.query(`UPDATE user_totp SET disabled_at = now(), disabled_reason = $2 WHERE user_id = $1 AND disabled_at IS NULL`, [userId, reason]);
    await tx.query(`UPDATE user_recovery_codes SET retired_at = now() WHERE user_id = $1 AND used_at IS NULL AND retired_at IS NULL`, [userId]);
  }
  async replaceRecoveryCodesTx(tx: TxContext, userId: string, hashes: string[]): Promise<void> {
    await tx.query(`UPDATE user_recovery_codes SET retired_at = now() WHERE user_id = $1 AND used_at IS NULL AND retired_at IS NULL`, [userId]);
    const batch = (await tx.query<{ id: string }>(`SELECT uuid_generate_v7() AS id`)).rows[0].id;
    for (const h of hashes) await tx.query(`INSERT INTO user_recovery_codes (user_id, batch_id, code_hash) VALUES ($1, $2, $3)`, [userId, batch, h]);
  }
  /** Use one recovery code: 'ok' (marked used now), 'used' (already used or retired), 'none' (no such code). */
  async useRecoveryCodeTx(tx: TxContext, userId: string, hash: string): Promise<'ok' | 'used' | 'none'> {
    const r = await tx.query(`UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL AND retired_at IS NULL`, [userId, hash]);
    if ((r.rowCount ?? 0) > 0) return 'ok';
    const e = await tx.query(`SELECT 1 FROM user_recovery_codes WHERE user_id = $1 AND code_hash = $2`, [userId, hash]);
    return (e.rowCount ?? 0) > 0 ? 'used' : 'none';
  }
  async userName(tx: TxContext, userId: string): Promise<string | null> {
    const r = await tx.query<{ n: string | null }>(`SELECT full_name AS n FROM users WHERE id = $1`, [userId]);
    return r.rows[0]?.n ?? null;
  }

  // ═══════════════════════════════════════════════ sessions (PERSON table)
  async sessionByRefreshHashForUpdate(tx: TxContext, hash: string): Promise<{ id: string; userId: string; pending: boolean; ageSec: number; revoked: boolean; expired: boolean } | null> {
    const r = await tx.query<any>(`SELECT id, user_id, two_factor_pending, extract(epoch FROM (now() - created_at))::int AS age, revoked_at IS NOT NULL AS revoked, expires_at <= now() AS expired
      FROM sessions WHERE refresh_token_hash = $1 FOR UPDATE`, [hash]);
    const x = r.rows[0];
    return x ? { id: x.id, userId: x.user_id, pending: Boolean(x.two_factor_pending), ageSec: Number(x.age), revoked: Boolean(x.revoked), expired: Boolean(x.expired) } : null;
  }
  async markSessionPendingTx(tx: TxContext, sessionId: string): Promise<void> {
    await tx.query(`UPDATE sessions SET two_factor_pending = true WHERE id = $1`, [sessionId]);
  }
  async completeTwoFactorTx(tx: TxContext, sessionId: string, refreshHash: string, expiresAt: Date): Promise<void> {
    await tx.query(`UPDATE sessions SET two_factor_pending = false, two_factor_verified_at = now(), refresh_token_hash = $2, expires_at = $3, last_seen_at = now() WHERE id = $1`, [sessionId, refreshHash, expiresAt]);
  }
  /** Is this session cut off for this tenant (born at or before the cut-off), or still waiting for its second factor? */
  async sessionPostureTx(tx: TxContext, sessionId: string, tenantId: string): Promise<{ cutOff: boolean; pending: boolean }> {
    const r = await tx.query<any>(`SELECT s.two_factor_pending AS pending, (r.revoked_after IS NOT NULL AND s.created_at <= r.revoked_after) AS cut
      FROM sessions s LEFT JOIN tenant_session_revocations r ON r.tenant_id = $2 AND r.user_id = s.user_id WHERE s.id = $1`, [sessionId, tenantId]);
    const x = r.rows[0] ?? {};
    return { cutOff: Boolean(x.cut), pending: Boolean(x.pending) };
  }
  async hasConfirmedTotpTx(tx: TxContext, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL AND disabled_at IS NULL`, [userId]);
    return (r.rowCount ?? 0) > 0;
  }
}
