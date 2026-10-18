// modules/partner-console/repositories/partner-console.repository.ts · PC-56 PARTNER-0 — all SQL of the partner console realm.
//
// TWO CONNECTION POSTURES, as in 0090's partner-api repository:
//
//  1. THE AXIS READS (the applications, the team) run inside `withAxis()`: a transaction that assumes the least-privilege role `kv_partner`
//     (SET LOCAL ROLE — it evaporates at COMMIT/ROLLBACK) and sets `app.partner_id` LOCAL from the VERIFIED TOKEN. 0225's policies then admit
//     only this partner's consented applications (`partner_owns_application`), and its column grants never expose `applicant_user_id` or the
//     free-text purpose. The `product_id`/partner predicates below are defence in depth; delete them and nothing leaks. A DETAIL read writes its
//     audit row in the SAME transaction after `RESET ROLE` (back to kv_app), as a TENANT row of the application's organisation — the read and
//     its trail commit together or not at all.
//  2. THE CONTROL PLANE (memberships, invites, the session check, a partner-realm audit row) runs in the caller's PartnerRealmUnitOfWork
//     transaction (kv_app on shard 0, app.partner_id from the token / the invite row): the `*Tx` methods.
//
// CROSS-SHARD (Rule Zero): applications live on their TENANT's shard, so the list scatters over every shard and merges on (created_at, id);
// memberships / invites / sessions are control-plane rows on shard 0. At SHARD_COUNT=1 both are one query.
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { AppConfig } from '../../../core/config/app-config';
import { TxContext } from '../../../core/database/unit-of-work';
import { AuditEntry, AuditWriter } from '../../../core/audit/audit.writer';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';

export interface PartnerApplicationRow {
  id: string; applicantRef: string; tenantId: string;
  product: { id: string; name: string }; purposeCategory: string | null; purposeText: string | null;
  amountRequestedMinor: string; amountApprovedMinor: string | null; status: string;
  createdAt: string; decisionAt: string | null; coolingOffUntil: string | null; applicantPhoneMasked: string | null;
  /** µs instant of created_at (the keyset), not part of the read model. */
  cursorTs: string;
}
export interface PartnerInviteRow {
  id: string; partnerId: string; phone: string; roleId: string; roleCode: string;
  /** The partner administrator who invited — NULL for the platform's first-administrator invite (0226: `invitedByAdminId` instead). */
  invitedBy: string | null; invitedByAdminId: string | null; languageCode: string;
  status: string; expiresAt: string; tokenSealed: string | null; sentAt: string | null; sendFailure: string | null;
}
export interface DashboardShard {
  total: string; awaiting: string; approved: string; rejected: string; approvedMinor: string; activeLoans: string; outstandingMinor: string;
  due: string; onTime: string; latenciesSec: number[]; tenantIds: string[];
  oldest: Array<{ id: string; tenantId: string; productName: string; amountRequestedMinor: string; status: string; createdAt: string }>;
}
export interface MembershipRow { id: string; userId: string; partnerId: string; roleId: string; roleCode: string; isActive: boolean }

const APP_SELECT = `
  SELECT a.id, a.tenant_id, a.product_id, p.name AS product_name, p.kind_code,
         a.amount_requested_minor::text AS amount_requested_minor, a.amount_approved_minor::text AS amount_approved_minor,
         a.status::text AS status, ${US_SQL('a.created_at')} AS created_us, a.decision_at, a.cooling_off_until,
         partner_application_purpose(a.id) AS purpose_text, partner_applicant_phone_masked(a.id) AS phone_masked
    FROM loan_applications a JOIN partner_loan_products() p ON p.id = a.product_id`;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const toApp = (x: any): PartnerApplicationRow => ({
  id: x.id, applicantRef: x.id, tenantId: x.tenant_id,
  product: { id: x.product_id, name: x.product_name }, purposeCategory: x.kind_code ?? null, purposeText: x.purpose_text ?? null,
  amountRequestedMinor: x.amount_requested_minor, amountApprovedMinor: x.amount_approved_minor ?? null, status: x.status,
  createdAt: x.created_us, decisionAt: iso(x.decision_at), coolingOffUntil: iso(x.cooling_off_until), applicantPhoneMasked: x.phone_masked ?? null,
  cursorTs: x.created_us,
});

@Injectable()
export class PartnerConsoleRepository {
  constructor(private readonly pools: PgPoolProvider, private readonly config: AppConfig, private readonly audit: AuditWriter) {}

  private get shardCount(): number { return Math.max(1, this.config.shardCount); }

  // ═════════════════════════════════════ the kv_partner axis
  /**
   * One transaction on one shard as `kv_partner` with `app.partner_id` = the token's partner. `then` (optional) runs AFTER `RESET ROLE`, back
   * as kv_app in the SAME transaction — the place a detail read writes its audit row. `app.tenant_id` is never set while the axis role is
   * worn, so every tenant policy is false and only the 0090/0225 partner policies can admit a row.
   */
  private async withAxis<T>(shardId: number, partnerId: string, fn: (c: PoolClient) => Promise<T>, then?: (c: PoolClient, out: T) => Promise<void>): Promise<T> {
    const client = await this.pools.writer(shardId).connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE kv_partner');
      await client.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(client);
      await client.query('RESET ROLE');
      if (then) await then(client, out);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);   // belt-and-braces before the pool reuses it
      client.release();
    }
  }

  /** The consented applications on this partner's products, newest first, µs keyset. Scatters over the shards, merges, cuts to `limit`. */
  async listApplications(partnerId: string, q: { status?: string; reviewQueue?: boolean; cursor?: KeysetCursor; limit: number }): Promise<PartnerApplicationRow[]> {
    const shards = Array.from({ length: this.shardCount }, (_, i) => i);
    const perShard = await Promise.all(shards.map((s) => this.withAxis(s, partnerId, async (c) => {
      const r = await c.query(`${APP_SELECT}
         WHERE a.deleted_at IS NULL
           AND ($1::text IS NULL OR a.status::text = $1::text)
           AND (NOT $2::boolean OR a.status IN ('submitted', 'under_review'))
           AND ($3::timestamptz IS NULL OR (a.created_at, a.id) < ($3::timestamptz, $4::uuid))
         ORDER BY a.created_at DESC, a.id DESC LIMIT $5`,
        [q.status ?? null, q.reviewQueue === true, q.cursor?.ts ?? null, q.cursor?.id ?? null, q.limit]);
      return r.rows.map(toApp);
    })));
    return perShard.flat()
      .sort((a, b) => (a.cursorTs < b.cursorTs ? 1 : a.cursorTs > b.cursorTs ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, q.limit);
  }

  /**
   * ONE application, if the oracle admits it — and its audit row (a TENANT row of the application's organisation: `partner.application.read`,
   * the partner, the person) in the same transaction. Not admitted → null (the caller answers the 404 shape and audits the refused probe).
   */
  async applicationDetail(partnerId: string, id: string, trail: Omit<AuditEntry, 'tenantId' | 'entityId' | 'entityType' | 'action'>): Promise<PartnerApplicationRow | null> {
    const shards = Array.from({ length: this.shardCount }, (_, i) => i);
    for (const s of shards) {
      const row = await this.withAxis(s, partnerId, async (c) => {
        const r = await c.query(`${APP_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
        return r.rows[0] ? toApp(r.rows[0]) : null;
      }, async (c, out) => {
        if (!out) return;
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [out.tenantId]);
        const tx: TxContext = { tenantId: out.tenantId, query: async <R = any>(sql: string, p?: readonly unknown[]) => { const r = await c.query(sql, p as unknown[]); return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 }; } };
        await this.audit.write(tx, { ...trail, tenantId: out.tenantId, action: 'partner.application.read', entityType: 'loan_application', entityId: out.id });
      });
      if (row) return row;
    }
    return null;
  }

  /** The application's TENANT, if — and only if — the oracle admits it for this partner (the decision path derives its tenant here). */
  async admittedTenant(partnerId: string, id: string): Promise<string | null> {
    for (let s = 0; s < this.shardCount; s++) {
      const t = await this.withAxis(s, partnerId, async (c) => (await c.query<{ tenant_id: string }>(`SELECT tenant_id FROM loan_applications WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0]?.tenant_id ?? null);
      if (t) return t;
    }
    return null;
  }

  /** The team read on the axis (0225 definers: names and masked phones without a `users` grant). */
  async team(partnerId: string): Promise<{ members: any[]; invites: any[] }> {
    return this.withAxis(0, partnerId, async (c) => {
      const m = await c.query(`SELECT * FROM partner_team()`);
      const i = await c.query(`SELECT * FROM partner_pending_invites()`);
      return {
        members: m.rows.map((x: any) => ({ membershipId: x.membership_id, userId: x.user_id, name: x.full_name ?? null, phoneMasked: x.phone_masked, roleCode: x.role_code,
          active: x.is_active === true, since: iso(x.since), removedAt: iso(x.removed_at), removedReason: x.removed_reason ?? null, twoFactor: x.two_factor === true })),
        invites: i.rows.map((x: any) => ({ id: x.id, phoneMasked: x.phone_masked, roleCode: x.role_code, invitedBy: x.invited_by, expiresAt: iso(x.expires_at),
          sentAt: iso(x.sent_at), sendFailure: x.send_failure ?? null, createdAt: iso(x.created_at) })),
      };
    });
  }

  // ═════════════════════════════════════ PC-56 PARTNER-1a · the dashboard (founder D1) — ONE shard's partial figures, on the axis
  /**
   * Everything the dashboard counts, for this partner, on ONE shard, inside `withAxis` (kv_partner + app.partner_id from the token): the
   * applications are the oracle-admitted ones only (0225 — this partner's products AND a live consent), the loans and repayments the 0090
   * partner book (`loans.partner_id`). The caller merges the shards (counts and bigint sums add; latencies are concatenated raw so the
   * percentiles merge exactly). The month boundary is the calendar month of Asia/Kolkata computed BY THE DATABASE from now() — no clock in
   * the process, no hour literal; the on-time window is the last 90 IST days of due dates; the latency window the last 30 days of decisions.
   */
  async dashboardShard(shardId: number, partnerId: string): Promise<DashboardShard> {
    return this.withAxis(shardId, partnerId, async (c) => {
      const f = (await c.query(`
        WITH w AS (SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS m0,
                          ((date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 month') AT TIME ZONE 'Asia/Kolkata') AS m1)
        SELECT
          (SELECT count(*) FROM loan_applications a WHERE a.deleted_at IS NULL)::text AS total,
          (SELECT count(*) FROM loan_applications a WHERE a.deleted_at IS NULL AND a.status IN ('submitted', 'under_review'))::text AS awaiting,
          (SELECT count(*) FROM loan_applications a, w WHERE a.deleted_at IS NULL AND a.decision_at >= w.m0 AND a.decision_at < w.m1
              AND a.amount_approved_minor IS NOT NULL)::text AS approved,
          (SELECT count(*) FROM loan_applications a, w WHERE a.deleted_at IS NULL AND a.decision_at >= w.m0 AND a.decision_at < w.m1
              AND a.status = 'rejected')::text AS rejected,
          (SELECT COALESCE(sum(a.amount_approved_minor), 0) FROM loan_applications a, w WHERE a.deleted_at IS NULL AND a.decision_at >= w.m0
              AND a.decision_at < w.m1 AND a.amount_approved_minor IS NOT NULL)::text AS approved_minor,
          (SELECT count(*) FROM loans l WHERE l.deleted_at IS NULL AND l.status IN ('active', 'overdue'))::text AS active_loans,
          (SELECT COALESCE(sum(l.outstanding_minor), 0) FROM loans l WHERE l.deleted_at IS NULL AND l.status IN ('active', 'overdue'))::text AS outstanding_minor,
          (SELECT count(*) FROM loan_repayments r
            WHERE r.due_date > (now() AT TIME ZONE 'Asia/Kolkata')::date - 90 AND r.due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
              AND r.created_at >= now() - interval '2 years')::text AS due,
          (SELECT count(*) FROM loan_repayments r
            WHERE r.due_date > (now() AT TIME ZONE 'Asia/Kolkata')::date - 90 AND r.due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
              AND r.created_at >= now() - interval '2 years'
              AND r.paid_at IS NOT NULL AND (r.paid_at AT TIME ZONE 'Asia/Kolkata')::date <= r.due_date)::text AS on_time,
          (SELECT COALESCE(array_agg(floor(extract(epoch FROM (a.decision_at - a.created_at)))::bigint), '{}')
             FROM loan_applications a WHERE a.deleted_at IS NULL AND a.decision_at IS NOT NULL AND a.decision_at >= now() - interval '30 days'
              AND a.decision_at >= a.created_at) AS latencies,
          (SELECT COALESCE(array_agg(DISTINCT a.tenant_id), '{}') FROM loan_applications a WHERE a.deleted_at IS NULL) AS tenants`)).rows[0];
      const oldest = (await c.query(`
        SELECT a.id, a.tenant_id, p.name AS product_name, a.amount_requested_minor::text AS amount, a.status::text AS status, ${US_SQL('a.created_at')} AS created_us
          FROM loan_applications a JOIN partner_loan_products() p ON p.id = a.product_id
         WHERE a.deleted_at IS NULL AND a.status IN ('submitted', 'under_review')
         ORDER BY a.created_at ASC, a.id ASC LIMIT 5`)).rows;
      return {
        total: f.total, awaiting: f.awaiting, approved: f.approved, rejected: f.rejected, approvedMinor: f.approved_minor,
        activeLoans: f.active_loans, outstandingMinor: f.outstanding_minor, due: f.due, onTime: f.on_time,
        latenciesSec: (f.latencies as Array<string | number>).map((x) => Number(x)),
        tenantIds: (f.tenants as string[]).map(String),
        oldest: oldest.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, productName: x.product_name, amountRequestedMinor: x.amount, status: x.status, createdAt: x.created_us })),
      };
    });
  }

  /**
   * Each FPO's PUBLIC display name — 0204's `public_tenant_profile(id)` (SECURITY DEFINER, EXECUTE to kv_app): a live (active | grace)
   * organisation's display name, NULL for any other (the console prints a neutral word). Nothing else of the FPO is read.
   */
  async publicTenantNames(tenantIds: readonly string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (tenantIds.length === 0) return out;
    const r = await this.pools.writer(0).query(
      `SELECT t.id::text AS id, p.display_name AS name FROM unnest($1::uuid[]) AS t(id) LEFT JOIN LATERAL public_tenant_profile(t.id) p ON true`, [tenantIds]);
    for (const x of r.rows as Array<{ id: string; name: string | null }>) out.set(x.id, x.name ?? null);
    return out;
  }

  /** How many shards the scatter reads (the dashboard service loops over them). */
  get shards(): number { return this.shardCount; }

  // ═════════════════════════════════════ control plane (kv_app, the caller's partner-realm transaction)
  /** The distinct ACTIVE partners a person belongs to (active partner rows only), with names for the chooser. Needs app.user_id = userId. */
  async membershipsOfUserTx(tx: TxContext, userId: string): Promise<Array<{ partnerId: string; name: string }>> {
    const r = await tx.query<{ partner_id: string; name: string }>(
      `SELECT DISTINCT m.partner_id, fp.default_name AS name FROM partner_memberships m JOIN financial_partners fp ON fp.id = m.partner_id
        WHERE m.user_id = $1 AND m.is_active AND m.deleted_at IS NULL AND fp.is_active AND fp.deleted_at IS NULL ORDER BY 2, 1`, [userId]);
    return r.rows.map((x) => ({ partnerId: x.partner_id, name: x.name }));
  }
  /** Roles + permissions of a person in ONE partner (active memberships of an active partner) — DB-resolved, never client-supplied. */
  async accessTx(tx: TxContext, userId: string, partnerId: string): Promise<{ roles: string[]; permissions: string[] }> {
    const r = await tx.query<{ role: string; perm: string | null }>(
      `SELECT r.code AS role, rp.permission_code AS perm
         FROM partner_memberships m JOIN roles r ON r.id = m.role_id JOIN financial_partners fp ON fp.id = m.partner_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.user_id = $1 AND m.partner_id = $2 AND m.is_active AND m.deleted_at IS NULL AND r.scope = 'partner' AND fp.is_active AND fp.deleted_at IS NULL`,
      [userId, partnerId]);
    return { roles: [...new Set(r.rows.map((x) => x.role))].sort(), permissions: [...new Set(r.rows.map((x) => x.perm).filter((p): p is string => !!p))].sort() };
  }
  /** Is this access token's session still a live PARTNER session of this person for this partner (not revoked, not pending, not expired)? */
  async sessionLiveTx(tx: TxContext, sessionId: string, userId: string, partnerId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 AND realm = 'partner' AND partner_id = $3
        AND revoked_at IS NULL AND NOT two_factor_pending AND expires_at > now()`, [sessionId, userId, partnerId]);
    return r.rowCount > 0;
  }
  async partnerOrgTx(tx: TxContext, partnerId: string): Promise<{ id: string; code: string; name: string; kind: string; regulatorRef: string | null; sla: Record<string, unknown> } | null> {
    const r = await tx.query<any>(`SELECT id, code, default_name, partner_kind, regulator_ref, sla FROM financial_partners WHERE id = $1 AND deleted_at IS NULL`, [partnerId]);
    const x = r.rows[0];
    return x ? { id: x.id, code: x.code, name: x.default_name, kind: x.partner_kind, regulatorRef: x.regulator_ref ?? null, sla: (x.sla ?? {}) as Record<string, unknown> } : null;
  }
  async userPhoneTx(tx: TxContext, userId: string): Promise<string | null> {
    return (await tx.query<{ phone: string }>(`SELECT phone FROM users WHERE id = $1`, [userId])).rows[0]?.phone ?? null;
  }
  async setSessionUserTx(tx: TxContext, userId: string): Promise<void> {
    await tx.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  }
  async roleByCodeTx(tx: TxContext, code: string): Promise<{ id: string; code: string; scope: string } | null> {
    const r = await tx.query<{ id: string; code: string; scope: string }>(`SELECT id, code, scope FROM roles WHERE code = $1 AND is_active`, [code]);
    return r.rows[0] ?? null;
  }

  // ─── invites
  /** Which partner a token's invite belongs to — the 0225 oracle (a public page has no partner in scope yet). */
  async partnerForTokenTx(tx: TxContext, tokenHash: string): Promise<string | null> {
    return (await tx.query<{ p: string | null }>(`SELECT partner_invite_partner($1::char(64)) AS p`, [tokenHash])).rows[0]?.p ?? null;
  }
  private inviteSelect = `SELECT i.id, i.partner_id, i.phone, i.role_id, r.code AS role_code, i.invited_by, i.invited_by_admin_id, i.language_code, i.status, i.expires_at, i.token_sealed, i.sent_at, i.send_failure
      FROM partner_invites i JOIN roles r ON r.id = i.role_id`;
  private toInvite = (x: any): PartnerInviteRow => ({ id: x.id, partnerId: x.partner_id, phone: x.phone, roleId: x.role_id, roleCode: x.role_code, invitedBy: x.invited_by ?? null,
    invitedByAdminId: x.invited_by_admin_id ?? null, languageCode: x.language_code, status: x.status, expiresAt: new Date(x.expires_at).toISOString(), tokenSealed: x.token_sealed ?? null, sentAt: iso(x.sent_at), sendFailure: x.send_failure ?? null });
  async inviteByHashForUpdateTx(tx: TxContext, tokenHash: string): Promise<PartnerInviteRow | null> {
    const r = await tx.query(`${this.inviteSelect} WHERE i.token_hash = $1 FOR UPDATE OF i`, [tokenHash]);
    return r.rows[0] ? this.toInvite(r.rows[0]) : null;
  }
  async inviteForUpdateTx(tx: TxContext, id: string): Promise<PartnerInviteRow | null> {
    const r = await tx.query(`${this.inviteSelect} WHERE i.id = $1 FOR UPDATE OF i`, [id]);
    return r.rows[0] ? this.toInvite(r.rows[0]) : null;
  }
  /** A pending invite for this phone that is past its 7 days (it no longer blocks a new one). */
  async stalePendingForPhoneTx(tx: TxContext, partnerId: string, phone: string): Promise<string | null> {
    return (await tx.query<{ id: string }>(`SELECT id FROM partner_invites WHERE partner_id = $1 AND phone = $2 AND status = 'pending' AND expires_at <= now() FOR UPDATE`, [partnerId, phone])).rows[0]?.id ?? null;
  }
  async expireInviteTx(tx: TxContext, id: string): Promise<void> { await tx.query(`UPDATE partner_invites SET status = 'expired' WHERE id = $1`, [id]); }
  async insertInviteTx(tx: TxContext, i: { id: string; partnerId: string; phone: string; roleId: string; invitedBy: string; languageCode: string; tokenHash: string; tokenSealed: string }): Promise<{ id: string; expiresAt: string }> {
    const r = await tx.query<{ id: string; expires_at: string }>(
      `INSERT INTO partner_invites (id, partner_id, phone, role_id, invited_by, language_code, token_hash, token_sealed, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '7 days') RETURNING id, expires_at`,
      [i.id, i.partnerId, i.phone, i.roleId, i.invitedBy, i.languageCode, i.tokenHash, i.tokenSealed]);
    return { id: r.rows[0].id, expiresAt: new Date(r.rows[0].expires_at).toISOString() };
  }
  async revokeInviteTx(tx: TxContext, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE partner_invites SET status = 'revoked', revoked_by = $2, revoked_reason = $3 WHERE id = $1`, [id, by, reason]);
  }
  async acceptInviteTx(tx: TxContext, id: string, userId: string): Promise<void> {
    await tx.query(`UPDATE partner_invites SET status = 'accepted', accepted_user_id = $2 WHERE id = $1`, [id, userId]);
  }
  async markInviteSentTx(tx: TxContext, id: string): Promise<void> { await tx.query(`UPDATE partner_invites SET sent_at = now(), token_sealed = NULL WHERE id = $1`, [id]); }
  async markInviteSendFailedTx(tx: TxContext, id: string, failure: string): Promise<void> { await tx.query(`UPDATE partner_invites SET send_failure = $2 WHERE id = $1`, [id, failure.slice(0, 80)]); }

  // ─── memberships
  private membershipSelect = `SELECT m.id, m.user_id, m.partner_id, m.role_id, r.code AS role_code, m.is_active FROM partner_memberships m JOIN roles r ON r.id = m.role_id`;
  private toMembership = (x: any): MembershipRow => ({ id: x.id, userId: x.user_id, partnerId: x.partner_id, roleId: x.role_id, roleCode: x.role_code, isActive: x.is_active === true });
  async membershipForUpdateTx(tx: TxContext, id: string): Promise<MembershipRow | null> {
    const r = await tx.query(`${this.membershipSelect} WHERE m.id = $1 AND m.deleted_at IS NULL FOR UPDATE OF m`, [id]);
    return r.rows[0] ? this.toMembership(r.rows[0]) : null;
  }
  async membershipOfForUpdateTx(tx: TxContext, partnerId: string, userId: string, roleId: string): Promise<MembershipRow | null> {
    const r = await tx.query(`${this.membershipSelect} WHERE m.partner_id = $1 AND m.user_id = $2 AND m.role_id = $3 AND m.deleted_at IS NULL FOR UPDATE OF m`, [partnerId, userId, roleId]);
    return r.rows[0] ? this.toMembership(r.rows[0]) : null;
  }
  async insertMembershipTx(tx: TxContext, m: { id: string; userId: string; partnerId: string; roleId: string; invitedBy: string | null; inviteId: string }): Promise<void> {
    await tx.query(`INSERT INTO partner_memberships (id, user_id, partner_id, role_id, is_active, invited_by, invite_id, created_by) VALUES ($1, $2, $3, $4, true, $5, $6, $5)`,
      [m.id, m.userId, m.partnerId, m.roleId, m.invitedBy, m.inviteId]);
  }
  async reactivateMembershipTx(tx: TxContext, id: string, invitedBy: string | null, inviteId: string): Promise<void> {
    await tx.query(`UPDATE partner_memberships SET is_active = true, removed_at = NULL, removed_by = NULL, removed_reason = NULL, invited_by = $2, invite_id = $3, updated_by = $2 WHERE id = $1`,
      [id, invitedBy, inviteId]);
  }
  async removeMembershipTx(tx: TxContext, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE partner_memberships SET is_active = false, removed_at = now(), removed_by = $2, removed_reason = $3, updated_by = $2 WHERE id = $1`, [id, by, reason]);
  }
  /** Other ACTIVE partner_admin rows of this partner (the friendly check; 0225's trigger is the wall). */
  async otherActiveAdminsTx(tx: TxContext, partnerId: string, exceptMembershipId: string): Promise<number> {
    const r = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM partner_memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.partner_id = $1 AND m.id <> $2 AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin'`, [partnerId, exceptMembershipId]);
    return r.rows[0]?.n ?? 0;
  }
  /** Does the person still hold ANY active membership in this partner (their sessions there end when they hold none)? */
  async holdsAnyActiveTx(tx: TxContext, partnerId: string, userId: string): Promise<boolean> {
    return (await tx.query(`SELECT 1 FROM partner_memberships WHERE partner_id = $1 AND user_id = $2 AND is_active AND deleted_at IS NULL`, [partnerId, userId])).rowCount > 0;
  }
}
