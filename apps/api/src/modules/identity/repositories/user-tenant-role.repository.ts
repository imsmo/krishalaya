// modules/identity/repositories/user-tenant-role.repository.ts
// person × tenant × role. HAS tenant_id ⇒ RLS applies (every query also binds tenant_id
// at the app layer — Law 1). Concurrency via SELECT … FOR UPDATE (no version column here).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { UserTenantRole } from '../domain/user-tenant-role.entity';
import { KycStatus } from '../domain/kyc-document.state';
import { RoleFact, payoutDestinationAllowed } from '../domain/kyc-role-scope';

const COLS = `id, user_id, tenant_id, role_id, kyc_status, is_active, role_data, approved_by, approved_at`;
interface Row { id: string; user_id: string; tenant_id: string; role_id: string; kyc_status: string; is_active: boolean; role_data: any; approved_by: string | null; approved_at: Date | null; }
function toDomain(r: Row, roleCode = ''): UserTenantRole {
  return UserTenantRole.rehydrate({ id: r.id, userId: r.user_id, tenantId: r.tenant_id, roleId: r.role_id, roleCode,
    kycStatus: r.kyc_status as KycStatus, isActive: r.is_active, roleData: r.role_data ?? {}, approvedBy: r.approved_by, approvedAt: r.approved_at });
}

@Injectable()
export class UserTenantRoleRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Does this person already hold ANY live role in this tenant? PC-56 TENANT-4d-1: a member is a PERSON, so
   *  a second role for somebody already on the roster must not consume a second seat. */
  async hasAnyRole(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM user_tenant_roles WHERE tenant_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  async insert(tx: TxContext, utr: UserTenantRole): Promise<void> {
    const p = utr.toProps();
    await tx.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active, role_data, approved_by, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [p.id, p.userId, p.tenantId, p.roleId, p.kycStatus, p.isActive, JSON.stringify(p.roleData), p.approvedBy, p.approvedAt]);
  }
  async update(tx: TxContext, utr: UserTenantRole): Promise<void> {
    const p = utr.toProps();
    await tx.query(
      `UPDATE user_tenant_roles SET kyc_status=$3, is_active=$4, role_data=$5::jsonb, approved_by=$6, approved_at=$7, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.kycStatus, p.isActive, JSON.stringify(p.roleData), p.approvedBy, p.approvedAt]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<UserTenantRole | null> {
    const r = await tx.query<Row>(`SELECT ${COLS} FROM user_tenant_roles WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async findExisting(tenantId: string, userId: string, roleId: string): Promise<UserTenantRole | null> {
    const r = await this.replica.forTenant(tenantId).query<Row>(
      `SELECT ${COLS} FROM user_tenant_roles WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NULL`, [tenantId, userId, roleId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async list(tenantId: string, opts: { userId?: string; roleCode?: string; pendingOnly: boolean }): Promise<any[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT utr.id, utr.user_id, utr.role_id, r.code AS role_code, utr.kyc_status, utr.is_active, utr.approved_at
         FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id=$1 AND utr.deleted_at IS NULL
          AND ($2::uuid IS NULL OR utr.user_id=$2)
          AND ($3::text IS NULL OR r.code=$3)
          AND ($4 = false OR utr.is_active = false)
        ORDER BY utr.created_at DESC LIMIT 200`,
      [tenantId, opts.userId ?? null, opts.roleCode ?? null, opts.pendingOnly]);
    return r.rows;
  }
  async isMember(tenantId: string, userId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT 1 FROM user_tenant_roles WHERE tenant_id=$1 AND user_id=$2 AND is_active AND deleted_at IS NULL LIMIT 1`,
      [tenantId, userId]);
    return r.rowCount! > 0;
  }
  /**
   * May this person add a payout DESTINATION? **PC-56 TENANT-9a (F-19, TENANT-1's residual): the per-role map, at source.**
   * This used to pass "as soon as kyc_status='verified' on ANY of their active roles" — so one Aadhaar OTP (F-1) let a
   * customer or a support agent register the account money is sent to. Now a role that can RECEIVE money for some mapped
   * purpose (0125 `payout_purpose_roles`) must be verified, read EFFECTIVELY (0180 `kyc_role_effective_status`: a role whose
   * every evidencing document has lapsed reads `expired`). The decision is `payoutDestinationAllowed` (domain).
   * Read-only, tenant-scoped (Law 1), off the replica like the other identity pre-tx checks.
   */
  async callerKycVerified(tenantId: string, userId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query<{ role_code: string; kyc_status: string; is_active: boolean; payee: boolean }>(
      `SELECT r.code AS role_code, kyc_role_effective_status(utr.tenant_id, utr.user_id, r.code, utr.kyc_status::text) AS kyc_status, utr.is_active,
              EXISTS (SELECT 1 FROM payout_purpose_roles ppr WHERE ppr.role_code = r.code AND ppr.deleted_at IS NULL) AS payee
         FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND utr.deleted_at IS NULL`,
      [tenantId, userId]);
    const roles = r.rows.map((x) => ({ roleCode: String(x.role_code), kycStatus: String(x.kyc_status), isActive: Boolean(x.is_active) }));
    const payees = r.rows.filter((x) => x.payee).map((x) => String(x.role_code));
    return payoutDestinationAllowed(roles, payees).allowed;
  }

  /** The person's roles in this tenant with their RECORDED KYC status (the derivation's input), locked for the write. */
  async roleFacts(tx: TxContext, tenantId: string, userId: string): Promise<RoleFact[]> {
    const r = await tx.query<{ role_code: string; kyc_status: string; is_active: boolean }>(
      `SELECT r.code AS role_code, utr.kyc_status::text AS kyc_status, utr.is_active
         FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND utr.deleted_at IS NULL
        ORDER BY r.code FOR UPDATE OF utr`,
      [tenantId, userId]);
    return r.rows.map((x) => ({ roleCode: String(x.role_code), kycStatus: String(x.kyc_status), isActive: Boolean(x.is_active) }));
  }

  /**
   * Write ONE role's KYC status (by code). **THERE IS NO "ALL ROLES" FORM ANY MORE** — the NULL-role branch of the old
   * `setKycStatus` is how one eKYC verified every role (F-1) and one upload un-verified every role (F-2).
   */
  async setRoleKycStatus(tx: TxContext, tenantId: string, userId: string, roleCode: string, status: KycStatus): Promise<number> {
    const r = await tx.query(
      `UPDATE user_tenant_roles utr SET kyc_status=$4, updated_at=now()
         FROM roles r
        WHERE r.id = utr.role_id AND utr.tenant_id=$1 AND utr.user_id=$2 AND r.code=$3 AND utr.deleted_at IS NULL`,
      [tenantId, userId, roleCode, status]);
    return r.rowCount ?? 0;
  }

  /** Does this person hold an ACTIVE `tenant_admin` role here? (W121: "the organisation's admin never certifies it".) */
  async isTenantAdmin(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND r.code='tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL LIMIT 1`,
      [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
}
