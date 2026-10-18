// apps/admin-api/src/modules/partner-ops/repositories/partner-ops.repository.ts · PC-56 PARTNER-1a.
//
// **WHAT kv_admin MAY READ OF THE PARTNER REALM IS FIXED BY 0226, COLUMN BY COLUMN**, and every query here stays inside it:
//   partner_invites      id, partner_id, role_id, invited_by, invited_by_admin_id, status, expires_at, accepted_at, created_at
//   partner_memberships  id, partner_id, role_id, is_active, created_at, deleted_at
// Never a phone, never a token hash, never a user id — the registry shows COUNTS and the one pending platform invite, not
// who. A column outside those lists would fail with 42501 at runtime, so the subqueries name columns rather than `*`.
// The partner's display name is `default_name` (0011); there is no `legal_name` column on financial_partners.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { maskRegulatorRef, slaDecisionHours } from '../domain/partner-ops.rules';

export interface PartnerRegistryRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  regulatorRefMasked: string | null;
  active: boolean;
  consoleMembers: number;
  activeAdmins: number;
  pendingAdminInvite: { id: string; expiresAt: string } | null;
  slaDecisionHours: number | null;
}

const SELECT_REGISTRY = `
  SELECT fp.id, fp.code, fp.default_name, fp.partner_kind, fp.regulator_ref, fp.sla,
         (fp.is_active AND fp.deleted_at IS NULL) AS active,
         (SELECT count(*)::int FROM partner_memberships m
           WHERE m.partner_id = fp.id AND m.is_active AND m.deleted_at IS NULL) AS console_members,
         (SELECT count(*)::int FROM partner_memberships m JOIN roles r ON r.id = m.role_id
           WHERE m.partner_id = fp.id AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin') AS active_admins,
         pi.id AS pending_invite_id, pi.expires_at AS pending_invite_expires_at
    FROM financial_partners fp
    LEFT JOIN LATERAL (
      SELECT i.id, i.expires_at FROM partner_invites i
       WHERE i.partner_id = fp.id AND i.invited_by_admin_id IS NOT NULL AND i.status = 'pending' AND i.expires_at > now()
       ORDER BY i.created_at DESC
       LIMIT 1
    ) pi ON true`;

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Raw row → the registry shape. Exported for the unit spec: the masks and the SLA read are the parts worth pinning. */
export function toRegistryRow(r: Record<string, unknown>): PartnerRegistryRow {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.default_name),
    kind: String(r.partner_kind),
    regulatorRefMasked: maskRegulatorRef(r.regulator_ref as string | null),
    active: Boolean(r.active),
    consoleMembers: Number(r.console_members ?? 0),
    activeAdmins: Number(r.active_admins ?? 0),
    pendingAdminInvite: r.pending_invite_id
      ? { id: String(r.pending_invite_id), expiresAt: iso(r.pending_invite_expires_at) }
      : null,
    slaDecisionHours: slaDecisionHours(r.sla),
  };
}

@Injectable()
export class PartnerOpsRepository {
  constructor(private readonly pool: AdminPool) {}

  async list(): Promise<PartnerRegistryRow[]> {
    const r = await this.pool.query(`${SELECT_REGISTRY} ORDER BY fp.default_name, fp.id`);
    return r.rows.map(toRegistryRow);
  }

  async get(id: string): Promise<PartnerRegistryRow | null> {
    const r = await this.pool.query(`${SELECT_REGISTRY} WHERE fp.id = $1`, [id]);
    return r.rows[0] ? toRegistryRow(r.rows[0]) : null;
  }

  // ─────────────────────────────── SLA (in the caller's transaction)
  async lockForSla(c: PoolClient, id: string): Promise<{ id: string; sla: unknown } | null> {
    const r = await c.query('SELECT id, sla FROM financial_partners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    return r.rows[0] ? { id: String(r.rows[0].id), sla: r.rows[0].sla } : null;
  }

  async writeSla(c: PoolClient, id: string, sla: Record<string, unknown>): Promise<void> {
    await c.query('UPDATE financial_partners SET sla = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(sla)]);
  }

  // ─────────────────────────────── first-administrator invite (in the caller's transaction)
  async lockLivePartner(c: PoolClient, id: string): Promise<boolean> {
    const r = await c.query(
      'SELECT id FROM financial_partners WHERE id = $1 AND is_active AND deleted_at IS NULL FOR UPDATE', [id]);
    return r.rows.length > 0;
  }

  async countActiveAdmins(c: PoolClient, partnerId: string): Promise<number> {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM partner_memberships m JOIN roles r ON r.id = m.role_id
        WHERE m.partner_id = $1 AND m.is_active AND m.deleted_at IS NULL AND r.code = 'partner_admin'`, [partnerId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async livePlatformInvite(c: PoolClient, partnerId: string): Promise<{ id: string; expiresAt: string } | null> {
    const r = await c.query(
      `SELECT id, expires_at FROM partner_invites
        WHERE partner_id = $1 AND invited_by_admin_id IS NOT NULL AND status = 'pending' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`, [partnerId]);
    return r.rows[0] ? { id: String(r.rows[0].id), expiresAt: iso(r.rows[0].expires_at) } : null;
  }

  async partnerAdminRoleId(c: PoolClient): Promise<string | null> {
    const r = await c.query(`SELECT id FROM roles WHERE code = 'partner_admin' AND is_active`);
    return r.rows[0] ? String(r.rows[0].id) : null;
  }

  /** `expires_at` is set by the 0226 trigger (7 days); `invited_by` and `token_sealed` are not columns kv_admin may
   *  write, so they are not named. */
  async insertPlatformInvite(c: PoolClient, v: {
    partnerId: string; phone: string; roleId: string; adminId: string; languageCode: string; tokenHash: string;
  }): Promise<{ id: string; expiresAt: string }> {
    const r = await c.query(
      `INSERT INTO partner_invites (partner_id, phone, role_id, invited_by_admin_id, language_code, token_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [v.partnerId, v.phone, v.roleId, v.adminId, v.languageCode, v.tokenHash]);
    return { id: String(r.rows[0].id), expiresAt: iso(r.rows[0].expires_at) };
  }

  /** The act, never the secret: the payload carries ids only. */
  async insertInviteOutbox(c: PoolClient, inviteId: string, partnerId: string): Promise<void> {
    await c.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES (NULL, 'partner_invite', $1, 'partner.member_invited', $2::jsonb)`,
      [inviteId, JSON.stringify({ v: 1, inviteId, partnerId, by: 'platform' })]);
  }
}
