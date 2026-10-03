// modules/identity/repositories/desk.repository.ts · PC-56 TENANT-13b · SQL for desks (0192): desks, desk_permissions, desk_members,
// desk_change_proposals, the desk_templates lookup, and the reads the cards and the labour suggestion need. tenant_id in EVERY query
// (Law 1) + RLS (0175 shape). Desk existence, status and permission rows are written ONLY after `app.desk_proposal_id` is set in the
// confirming transaction (0192 `trg_desk_proposal_gate`) — `citeProposalTx` is that act. µs keyset for the proposal list.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { DeskProposalKind, DeskProposalStatus } from '../domain/desk-rules';

export interface DeskRow {
  id: string; code: string; name: string; description: string | null; templateCode: string | null; status: 'active' | 'disabled';
  createdBy: string; confirmedBy: string; createdAt: string; disabledAt: string | null;
}
export interface DeskMemberRow { deskId: string; userId: string; name: string | null; addedBy: string; addedAt: string }
export interface DeskProposalRow {
  id: string; kind: DeskProposalKind; deskId: string | null; diff: any; reason: string; proposedBy: string; proposedByName: string | null;
  proposedAt: string; expiresAt: string; status: DeskProposalStatus; confirmedBy: string | null; confirmedAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null; cursorTs: string;
}

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const DESK_COLS = `d.id, d.code, d.name, d.description, d.template_code, d.status, d.created_by, d.confirmed_by, ${iso('d.created_at')} AS created_at, ${iso('d.disabled_at')} AS disabled_at`;
const deskOf = (x: any): DeskRow => ({
  id: x.id, code: x.code, name: x.name, description: x.description ?? null, templateCode: x.template_code ?? null, status: x.status,
  createdBy: x.created_by, confirmedBy: x.confirmed_by, createdAt: x.created_at, disabledAt: x.disabled_at ?? null,
});
const PROPOSAL_COLS = `p.id, p.kind, p.desk_id, p.diff, p.reason, p.proposed_by, u.full_name AS proposed_by_name, ${iso('p.proposed_at')} AS proposed_at,
  ${iso('p.expires_at')} AS expires_at, p.status, p.confirmed_by, ${iso('p.confirmed_at')} AS confirmed_at, p.refused_by, ${iso('p.refused_at')} AS refused_at,
  p.refuse_reason, ${iso('p.expired_at')} AS expired_at, ${US_SQL('p.created_at')} AS cursor_ts`;
const proposalOf = (x: any): DeskProposalRow => ({
  id: x.id, kind: x.kind, deskId: x.desk_id ?? null, diff: x.diff, reason: x.reason, proposedBy: x.proposed_by, proposedByName: x.proposed_by_name ?? null,
  proposedAt: x.proposed_at, expiresAt: x.expires_at, status: x.status, confirmedBy: x.confirmed_by ?? null, confirmedAt: x.confirmed_at ?? null,
  refusedBy: x.refused_by ?? null, refusedAt: x.refused_at ?? null, refuseReason: x.refuse_reason ?? null, expiredAt: x.expired_at ?? null, cursorTs: x.cursor_ts,
});

@Injectable()
export class DeskRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: TxContext) { return tx ?? this.replica.forTenant(tenantId); }

  /* ---- reads --------------------------------------------------------------------------------------------------------- */
  async desks(tenantId: string, tx?: TxContext): Promise<DeskRow[]> {
    const r = await this.on(tenantId, tx).query(`SELECT ${DESK_COLS} FROM desks d WHERE d.tenant_id=$1 ORDER BY d.created_at, d.id`, [tenantId]);
    return r.rows.map(deskOf);
  }
  async deskForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DeskRow | null> {
    const r = await tx.query(`SELECT ${DESK_COLS} FROM desks d WHERE d.tenant_id=$1 AND d.id=$2 FOR UPDATE`, [tenantId, id]);
    return r.rows[0] ? deskOf(r.rows[0]) : null;
  }
  async deskByCodeTx(tx: TxContext, tenantId: string, code: string): Promise<DeskRow | null> {
    const r = await tx.query(`SELECT ${DESK_COLS} FROM desks d WHERE d.tenant_id=$1 AND d.code=$2`, [tenantId, code]);
    return r.rows[0] ? deskOf(r.rows[0]) : null;
  }
  async livePermissions(tenantId: string, tx?: TxContext): Promise<Map<string, string[]>> {
    const r = await this.on(tenantId, tx).query(
      `SELECT desk_id, permission_code FROM desk_permissions WHERE tenant_id=$1 AND removed_at IS NULL ORDER BY permission_code`, [tenantId]);
    const m = new Map<string, string[]>();
    for (const x of r.rows as any[]) m.set(x.desk_id, [...(m.get(x.desk_id) ?? []), x.permission_code]);
    return m;
  }
  async liveMembers(tenantId: string, tx?: TxContext): Promise<DeskMemberRow[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT dm.desk_id, dm.user_id, u.full_name, dm.added_by, ${iso('dm.added_at')} AS added_at
         FROM desk_members dm LEFT JOIN users u ON u.id = dm.user_id
        WHERE dm.tenant_id=$1 AND dm.removed_at IS NULL ORDER BY dm.added_at, dm.id`, [tenantId]);
    return r.rows.map((x: any) => ({ deskId: x.desk_id, userId: x.user_id, name: x.full_name ?? null, addedBy: x.added_by, addedAt: x.added_at }));
  }
  async liveMemberIdsTx(tx: TxContext, tenantId: string, deskIds: string[]): Promise<string[]> {
    if (deskIds.length === 0) return [];
    const r = await tx.query(`SELECT DISTINCT user_id FROM desk_members WHERE tenant_id=$1 AND desk_id = ANY($2::uuid[]) AND removed_at IS NULL`, [tenantId, deskIds]);
    return r.rows.map((x: any) => String(x.user_id));
  }
  /** `permissions` codes + what the tenant_admin role holds (the grantable universe is the second minus the ungrantable list). */
  async permissionUniverse(tenantId: string, tx?: TxContext): Promise<{ known: Set<string>; admin: Set<string> }> {
    const q = this.on(tenantId, tx);
    const [k, a] = await Promise.all([
      q.query(`SELECT code FROM permissions ORDER BY code`),
      q.query(`SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'tenant_admin'`),
    ]);
    return { known: new Set(k.rows.map((x: any) => x.code)), admin: new Set(a.rows.map((x: any) => x.code)) };
  }
  async templateCodes(tenantId: string): Promise<Array<{ code: string; canonCodes: string[] }>> {
    const r = await this.on(tenantId).query(`SELECT code, canon_codes FROM desk_templates ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: x.code, canonCodes: x.canon_codes }));
  }
  /** Active, unsuspended tenant_admins (0192 `kv_is_tenant_admin`). */
  async adminIds(tenantId: string, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id=$1 AND ro.code='tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions s WHERE s.tenant_id=utr.tenant_id AND s.user_id=utr.user_id AND s.lifted_at IS NULL AND s.deleted_at IS NULL)`, [tenantId]);
    return r.rows.map((x: any) => String(x.user_id));
  }
  /** The people a desk member may be chosen from: active role holders of the tenant, with their roles and names (bounded). */
  async people(tenantId: string, limit = 500): Promise<Array<{ userId: string; name: string | null; roles: string[] }>> {
    const r = await this.on(tenantId).query(
      `SELECT utr.user_id, u.full_name, array_agg(DISTINCT ro.code ORDER BY ro.code) AS roles
         FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id LEFT JOIN users u ON u.id = utr.user_id
        WHERE utr.tenant_id=$1 AND utr.is_active AND utr.deleted_at IS NULL
        GROUP BY utr.user_id, u.full_name ORDER BY u.full_name NULLS LAST, utr.user_id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => ({ userId: x.user_id, name: x.full_name ?? null, roles: x.roles ?? [] }));
  }
  /** Members who hold an active role in the tenant (a desk member must). */
  async activeInTenantTx(tx: TxContext, tenantId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const r = await tx.query(`SELECT DISTINCT user_id FROM user_tenant_roles WHERE tenant_id=$1 AND user_id = ANY($2::uuid[]) AND is_active AND deleted_at IS NULL`, [tenantId, userIds]);
    return r.rows.map((x: any) => String(x.user_id));
  }
  /**
   * W185's suggestion row: labour bookings created this season by people who hold tenant_admin — the work the admins do themselves
   * because no labour desk exists. A real count; the caller prints it only when > 0 and no active desk carries labour.desk.
   */
  async adminLabourBookings(tenantId: string, from: Date, to: Date): Promise<number> {
    const r = await this.on(tenantId).query(
      `SELECT count(*)::int AS n FROM labour_bookings b
        WHERE b.tenant_id=$1 AND b.deleted_at IS NULL AND b.created_at >= $2 AND b.created_at < $3
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                       WHERE utr.tenant_id=b.tenant_id AND utr.user_id=b.created_by AND ro.code='tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL)`,
      [tenantId, from.toISOString(), to.toISOString()]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /* ---- proposals ----------------------------------------------------------------------------------------------------- */
  async insertProposalTx(tx: TxContext, p: { tenantId: string; kind: DeskProposalKind; deskId: string | null; diff: unknown; reason: string; proposedBy: string }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO desk_change_proposals (tenant_id, kind, desk_id, diff, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6, now(), now() + interval '7 days') RETURNING id`,
      [p.tenantId, p.kind, p.deskId, JSON.stringify(p.diff), p.reason, p.proposedBy]);
    return r.rows[0].id;
  }
  async liveProposalForDeskTx(tx: TxContext, tenantId: string, deskId: string): Promise<string | null> {
    const r = await tx.query(`SELECT id FROM desk_change_proposals WHERE tenant_id=$1 AND desk_id=$2 AND status='proposed'`, [tenantId, deskId]);
    return r.rows[0]?.id ?? null;
  }
  async liveCreateForCodeTx(tx: TxContext, tenantId: string, code: string): Promise<string | null> {
    const r = await tx.query(
      `SELECT id FROM desk_change_proposals WHERE tenant_id=$1 AND status='proposed'
          AND ((kind='create' AND diff->>'code' = $2) OR (kind='install_templates' AND diff->'desks' @> jsonb_build_array(jsonb_build_object('code', $2::text))))`,
      [tenantId, code]);
    return r.rows[0]?.id ?? null;
  }
  async proposalForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DeskProposalRow | null> {
    await tx.query(`SELECT 1 FROM desk_change_proposals WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
    const r = await tx.query(`SELECT ${PROPOSAL_COLS} FROM desk_change_proposals p LEFT JOIN users u ON u.id = p.proposed_by WHERE p.tenant_id=$1 AND p.id=$2`, [tenantId, id]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }
  async proposal(tenantId: string, id: string): Promise<DeskProposalRow | null> {
    const r = await this.on(tenantId).query(`SELECT ${PROPOSAL_COLS} FROM desk_change_proposals p LEFT JOIN users u ON u.id = p.proposed_by WHERE p.tenant_id=$1 AND p.id=$2`, [tenantId, id]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }
  async listProposals(tenantId: string, opts: { status?: DeskProposalStatus; cursor?: KeysetCursor; limit: number }): Promise<DeskProposalRow[]> {
    const params: unknown[] = [tenantId]; const where = ['p.tenant_id=$1'];
    if (opts.status) { params.push(opts.status); where.push(`p.status=$${params.length}`); }
    if (opts.cursor) { params.push(opts.cursor.ts, opts.cursor.id); where.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    params.push(opts.limit);
    const r = await this.on(tenantId).query(
      `SELECT ${PROPOSAL_COLS} FROM desk_change_proposals p LEFT JOIN users u ON u.id = p.proposed_by WHERE ${where.join(' AND ')}
        ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(proposalOf);
  }
  async confirmTx(tx: TxContext, tenantId: string, id: string, checker: string): Promise<void> {
    const r = await tx.query(`UPDATE desk_change_proposals SET status='confirmed', confirmed_by=$3, confirmed_at=now() WHERE tenant_id=$1 AND id=$2 AND status='proposed'`, [tenantId, id, checker]);
    if (r.rowCount !== 1) throw new Error(`desk proposal ${id}: confirm matched ${r.rowCount} rows`);
  }
  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    const r = await tx.query(`UPDATE desk_change_proposals SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4 WHERE tenant_id=$1 AND id=$2 AND status='proposed'`, [tenantId, id, by, reason]);
    if (r.rowCount !== 1) throw new Error(`desk proposal ${id}: refuse matched ${r.rowCount} rows`);
  }
  async expireTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`UPDATE desk_change_proposals SET status='expired', expired_at=now() WHERE tenant_id=$1 AND id=$2 AND status='proposed' AND expires_at <= now()`, [tenantId, id]);
    return r.rowCount === 1;
  }
  async dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query(`SELECT id FROM desk_change_proposals WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now() ORDER BY expires_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => x.id);
  }

  /* ---- the confirming transaction's writes (0192 gate: cite the proposal first) --------------------------------------- */
  async citeProposalTx(tx: TxContext, proposalId: string | null): Promise<void> {
    await tx.query(`SELECT set_config('app.desk_proposal_id', $1, true)`, [proposalId ?? '']);
  }
  async insertDeskTx(tx: TxContext, d: { tenantId: string; code: string; name: string; description: string | null; templateCode: string | null; createdBy: string; confirmedBy: string; proposalId: string }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO desks (tenant_id, code, name, description, template_code, status, created_by, confirmed_by, created_by_proposal)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8) RETURNING id`,
      [d.tenantId, d.code, d.name, d.description, d.templateCode, d.createdBy, d.confirmedBy, d.proposalId]);
    return r.rows[0].id;
  }
  async addPermissionsTx(tx: TxContext, tenantId: string, deskId: string, codes: string[], proposalId: string): Promise<void> {
    if (codes.length === 0) return;
    await tx.query(
      `INSERT INTO desk_permissions (tenant_id, desk_id, permission_code, added_by_proposal) SELECT $1, $2, c, $4 FROM unnest($3::text[]) c`,
      [tenantId, deskId, codes, proposalId]);
  }
  async removePermissionsTx(tx: TxContext, tenantId: string, deskId: string, codes: string[], proposalId: string): Promise<void> {
    if (codes.length === 0) return;
    await tx.query(
      `UPDATE desk_permissions SET removed_at = now(), removed_by_proposal = $4
        WHERE tenant_id=$1 AND desk_id=$2 AND permission_code = ANY($3::text[]) AND removed_at IS NULL`, [tenantId, deskId, codes, proposalId]);
  }
  async setDeskStatusTx(tx: TxContext, tenantId: string, deskId: string, status: 'active' | 'disabled', proposalId: string): Promise<void> {
    const r = status === 'disabled'
      ? await tx.query(`UPDATE desks SET status='disabled', disabled_at=now(), disabled_by_proposal=$3 WHERE tenant_id=$1 AND id=$2 AND status='active'`, [tenantId, deskId, proposalId])
      : await tx.query(`UPDATE desks SET status='active', disabled_at=NULL, disabled_by_proposal=NULL WHERE tenant_id=$1 AND id=$2 AND status='disabled'`, [tenantId, deskId]);
    if (r.rowCount !== 1) throw new Error(`desk ${deskId}: status → ${status} matched ${r.rowCount} rows`);
  }

  /* ---- members (direct, audited) ------------------------------------------------------------------------------------- */
  async addMemberTx(tx: TxContext, tenantId: string, deskId: string, userId: string, by: string): Promise<boolean> {
    const r = await tx.query(
      `INSERT INTO desk_members (tenant_id, desk_id, user_id, added_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (desk_id, user_id) WHERE removed_at IS NULL DO NOTHING`, [tenantId, deskId, userId, by]);
    return r.rowCount === 1;
  }
  async removeMemberTx(tx: TxContext, tenantId: string, deskId: string, userId: string, by: string, reason: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE desk_members SET removed_at=now(), removed_by=$4, remove_reason=$5 WHERE tenant_id=$1 AND desk_id=$2 AND user_id=$3 AND removed_at IS NULL`,
      [tenantId, deskId, userId, by, reason]);
    return r.rowCount === 1;
  }
}
