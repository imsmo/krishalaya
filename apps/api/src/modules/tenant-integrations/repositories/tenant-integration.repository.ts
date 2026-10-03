// modules/tenant-integrations/repositories/tenant-integration.repository.ts · SQL for tenant_integrations, integration_proposals,
// integration_verify_checks (0002 / 0193) + the GLOBAL integration_providers catalogue. tenant_id in EVERY tenant query (Law 1) + RLS.
// Reads on the replica; writes through the tx. `secret_ref` is selected only to compute the masked ref and to hand the verification job
// its vault reference — it never leaves this module in a response shape. The sealed candidate credential is read only by the confirm
// path (to verify it, then vault it) and is wiped when its proposal closes.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { CredentialField, credentialFieldsOf } from '../domain/provider-rules';
import { ConnectionStatus, ProposalKind, ProposalStatus } from '../domain/integration-proposal.state';

export interface ProviderRow {
  code: string; defaultName: string; category: string; isActive: boolean; tenantOwnable: boolean;
  verifyMethod: string | null; verifyUrl: string | null; credentialFields: CredentialField[];
}
export interface ConnectionRow {
  id: string; providerCode: string; providerName: string | null; category: string | null; secretRef: string; config: Record<string, unknown>;
  isActive: boolean; status: ConnectionStatus; verifiedAt: string | null; verifyResult: Record<string, unknown> | null; lastCheckedAt: string | null;
  credentialHint: string | null; disconnectedAt: string | null; disconnectReason: string | null; createdAt: string | null;
  checks24h: number; ok24h: number; lastOkAt: string | null; lastCheckAt: string | null;
}
export interface ProposalRow {
  id: string; providerCode: string; providerName: string | null; kind: ProposalKind; credentialHint: string | null; config: Record<string, unknown>;
  shadowResult: Record<string, unknown> | null; reason: string; proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string;
  status: ProposalStatus; confirmedBy: string | null; confirmedAt: string | null; outcome: Record<string, unknown> | null; closedAt: string | null;
  refusedBy: string | null; refuseReason: string | null; cursorTs: string;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const toProvider = (x: any): ProviderRow => ({
  code: x.code, defaultName: x.default_name, category: x.category, isActive: Boolean(x.is_active), tenantOwnable: Boolean(x.tenant_ownable),
  verifyMethod: x.verify_method ?? null, verifyUrl: x.verify_url ?? null, credentialFields: credentialFieldsOf(x.credential_fields),
});
const PROPOSAL_SQL = `SELECT p.id, p.provider_code, ip.default_name AS provider_name, p.kind, p.credential_hint, p.config, p.shadow_result, p.reason,
       p.proposed_by, u.full_name AS proposed_by_name, p.proposed_at, p.expires_at, p.status, p.confirmed_by, p.confirmed_at, p.outcome, p.closed_at,
       p.refused_by, p.refuse_reason, ${US_SQL('p.created_at')} AS cursor_ts
  FROM integration_proposals p JOIN integration_providers ip ON ip.code = p.provider_code LEFT JOIN users u ON u.id = p.proposed_by`;
const toProposal = (x: any): ProposalRow => ({
  id: String(x.id), providerCode: x.provider_code, providerName: x.provider_name ?? null, kind: x.kind, credentialHint: x.credential_hint ?? null,
  config: x.config ?? {}, shadowResult: x.shadow_result ?? null, reason: x.reason, proposedBy: String(x.proposed_by), proposedByName: x.proposed_by_name ?? null,
  proposedAt: iso(x.proposed_at)!, expiresAt: iso(x.expires_at)!, status: x.status, confirmedBy: x.confirmed_by ?? null, confirmedAt: iso(x.confirmed_at),
  outcome: x.outcome ?? null, closedAt: iso(x.closed_at), refusedBy: x.refused_by ?? null, refuseReason: x.refuse_reason ?? null, cursorTs: String(x.cursor_ts),
});

@Injectable()
export class TenantIntegrationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The GLOBAL provider catalogue (active), each with whether a tenant may own it. */
  async listProviders(tenantId: string, limit = 200): Promise<ProviderRow[]> {
    const r = await this.replica.forTenant(tenantId).query<any>(
      `SELECT code, default_name, category, is_active, tenant_ownable, verify_method, verify_url, credential_fields
         FROM integration_providers WHERE is_active = true AND deleted_at IS NULL ORDER BY tenant_ownable DESC, category, code LIMIT $1`, [limit]);
    return r.rows.map(toProvider);
  }
  async providerTx(tx: TxContext, code: string): Promise<ProviderRow | null> {
    const r = await tx.query<any>(`SELECT code, default_name, category, is_active, tenant_ownable, verify_method, verify_url, credential_fields
                                     FROM integration_providers WHERE code = $1 AND deleted_at IS NULL`, [code]);
    return r.rows[0] ? toProvider(r.rows[0]) : null;
  }

  private connectionSql(where: string) {
    return `SELECT ti.id, ti.provider_code, p.default_name AS provider_name, p.category, ti.secret_ref, ti.config, ti.is_active, ti.status,
                   ti.verified_at, ti.verify_result, ti.last_checked_at, ti.credential_hint, ti.disconnected_at, ti.disconnect_reason, ti.created_at,
                   COALESCE(h.checks, 0)::int AS checks_24h, COALESCE(h.ok, 0)::int AS ok_24h, h.last_ok, h.last_check
              FROM tenant_integrations ti
              JOIN integration_providers p ON p.code = ti.provider_code
              LEFT JOIN LATERAL (
                SELECT COUNT(*) AS checks, COUNT(*) FILTER (WHERE c.ok) AS ok,
                       (SELECT max(c2.checked_at) FROM integration_verify_checks c2 WHERE c2.tenant_id = ti.tenant_id AND c2.integration_id = ti.id AND c2.ok) AS last_ok,
                       max(c.checked_at) AS last_check
                  FROM integration_verify_checks c
                 WHERE c.tenant_id = ti.tenant_id AND c.integration_id = ti.id AND c.checked_at > now() - interval '24 hours') h ON true
             WHERE ${where}`;
  }
  private toConnection(x: any): ConnectionRow {
    return {
      id: String(x.id), providerCode: x.provider_code, providerName: x.provider_name ?? null, category: x.category ?? null, secretRef: x.secret_ref,
      config: x.config ?? {}, isActive: Boolean(x.is_active), status: x.status, verifiedAt: iso(x.verified_at), verifyResult: x.verify_result ?? null,
      lastCheckedAt: iso(x.last_checked_at), credentialHint: x.credential_hint ?? null, disconnectedAt: iso(x.disconnected_at),
      disconnectReason: x.disconnect_reason ?? null, createdAt: iso(x.created_at), checks24h: Number(x.checks_24h), ok24h: Number(x.ok_24h),
      lastOkAt: iso(x.last_ok), lastCheckAt: iso(x.last_check),
    };
  }
  async listForTenant(tenantId: string, limit = 200): Promise<ConnectionRow[]> {
    const r = await this.replica.forTenant(tenantId).query<any>(`${this.connectionSql('ti.tenant_id = $1 AND ti.deleted_at IS NULL')} ORDER BY ti.provider_code LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => this.toConnection(x));
  }
  async connectionTx(tx: TxContext, tenantId: string, providerCode: string, lock = false): Promise<ConnectionRow | null> {
    const r = await tx.query<any>(`${this.connectionSql('ti.tenant_id = $1 AND ti.provider_code = $2 AND ti.deleted_at IS NULL')}${lock ? ' FOR UPDATE OF ti' : ''}`, [tenantId, providerCode]);
    return r.rows[0] ? this.toConnection(r.rows[0]) : null;
  }
  async adminCountTx(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query<any>(
      `SELECT COUNT(DISTINCT utr.user_id)::int AS n FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND ro.code = 'tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL AND kv_is_tenant_admin($1, utr.user_id)`, [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  // ---- the connection writes (only inside a confirmed proposal's transaction — the 0193 gate) ----
  async citeProposalTx(tx: TxContext, proposalId: string): Promise<void> {
    await tx.query(`SELECT set_config('app.integration_proposal_id', $1, true)`, [proposalId]);
  }
  async applyCredentialTx(tx: TxContext, c: { tenantId: string; providerCode: string; secretRef: string; config: Record<string, unknown>; hint: string; verifyResult: Record<string, unknown>; userId: string }): Promise<string> {
    const r = await tx.query<any>(
      `INSERT INTO tenant_integrations (tenant_id, provider_code, secret_ref, config, is_active, status, verified_at, verify_result, last_checked_at, credential_hint,
                                        disconnected_at, disconnected_by, disconnect_reason, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, true, 'verified', now(), $5::jsonb, now(), $6, NULL, NULL, NULL, $7, now(), now())
       ON CONFLICT (tenant_id, provider_code) DO UPDATE SET secret_ref = EXCLUDED.secret_ref, config = EXCLUDED.config, is_active = true, status = 'verified',
              verified_at = now(), verify_result = EXCLUDED.verify_result, last_checked_at = now(), credential_hint = EXCLUDED.credential_hint,
              disconnected_at = NULL, disconnected_by = NULL, disconnect_reason = NULL, updated_by = $7, updated_at = now()
       RETURNING id`, [c.tenantId, c.providerCode, c.secretRef, JSON.stringify(c.config), JSON.stringify(c.verifyResult), c.hint, c.userId]);
    return String(r.rows[0].id);
  }
  /** Rotation: the live row takes the new (already verified, already vaulted) credential. An UPDATE, so the gate sees a rotate. */
  async rotateCredentialTx(tx: TxContext, c: { tenantId: string; providerCode: string; secretRef: string; config: Record<string, unknown>; hint: string; verifyResult: Record<string, unknown>; userId: string }): Promise<string | null> {
    const r = await tx.query<any>(
      `UPDATE tenant_integrations SET secret_ref = $3, config = $4::jsonb, status = 'verified', verified_at = now(), verify_result = $5::jsonb,
              last_checked_at = now(), credential_hint = $6, updated_by = $7, updated_at = now()
        WHERE tenant_id = $1 AND provider_code = $2 AND is_active = true RETURNING id`,
      [c.tenantId, c.providerCode, c.secretRef, JSON.stringify(c.config), JSON.stringify(c.verifyResult), c.hint, c.userId]);
    return r.rows[0] ? String(r.rows[0].id) : null;
  }
  async disconnectTx(tx: TxContext, tenantId: string, providerCode: string, by: string, reason: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE tenant_integrations SET is_active = false, status = 'disconnected', disconnected_at = now(), disconnected_by = $3, disconnect_reason = $4,
              updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND provider_code = $2 AND is_active = true`, [tenantId, providerCode, by, reason]);
    return (r.rowCount ?? 0) === 1;
  }
  /** A verification result (daily job) — the one connection write that needs no proposal (the gate admits it). */
  async recordCheckTx(tx: TxContext, c: { tenantId: string; integrationId: string; providerCode: string; kind: 'apply' | 'daily'; ok: boolean; errorClass: string | null; detail: string; durationMs: number; result?: Record<string, unknown> }): Promise<void> {
    await tx.query(
      `INSERT INTO integration_verify_checks (tenant_id, integration_id, provider_code, kind, ok, error_class, detail, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [c.tenantId, c.integrationId, c.providerCode, c.kind, c.ok, c.errorClass, c.detail.slice(0, 200), c.durationMs]);
    if (c.kind === 'daily') {
      await tx.query(
        `UPDATE tenant_integrations SET status = $3, last_checked_at = now(), verify_result = $4::jsonb,
                verified_at = CASE WHEN $5 THEN now() ELSE verified_at END, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
        [c.tenantId, c.integrationId, c.ok ? 'verified' : 'verify_failed', JSON.stringify(c.result ?? {}), c.ok]);
    }
  }
  async dueForCheckTx(tx: TxContext, tenantId: string, limit: number): Promise<{ id: string; providerCode: string; secretRef: string }[]> {
    const r = await tx.query<any>(
      `SELECT id, provider_code, secret_ref FROM tenant_integrations
        WHERE tenant_id = $1 AND is_active = true AND deleted_at IS NULL AND (last_checked_at IS NULL OR last_checked_at <= now() - interval '24 hours')
        ORDER BY last_checked_at NULLS FIRST, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => ({ id: String(x.id), providerCode: x.provider_code, secretRef: x.secret_ref }));
  }

  // ---- proposals ----
  async insertProposalTx(tx: TxContext, p: { id: string; tenantId: string; providerCode: string; kind: ProposalKind; sealed: string | null; hint: string | null; config: Record<string, unknown>; shadow: Record<string, unknown> | null; reason: string; proposedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO integration_proposals (id, tenant_id, provider_code, kind, credential_sealed, credential_hint, config, shadow_result, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, now(), now() + interval '7 days')`,
      [p.id, p.tenantId, p.providerCode, p.kind, p.sealed, p.hint, JSON.stringify(p.config), p.shadow ? JSON.stringify(p.shadow) : null, p.reason, p.proposedBy]);
  }
  async proposalTx(tx: TxContext, tenantId: string, id: string, lock = false): Promise<(ProposalRow & { sealed: string | null }) | null> {
    const r = await tx.query<any>(`${PROPOSAL_SQL.replace('SELECT p.id,', 'SELECT p.credential_sealed, p.id,')} WHERE p.tenant_id = $1 AND p.id = $2${lock ? ' FOR UPDATE OF p' : ''}`, [tenantId, id]);
    const x = r.rows[0];
    return x ? { ...toProposal(x), sealed: x.credential_sealed ?? null } : null;
  }
  async proposals(tenantId: string, opts: { status?: string; providerCode?: string; cursor?: KeysetCursor; limit: number }): Promise<ProposalRow[]> {
    const params: unknown[] = [tenantId];
    let where = 'p.tenant_id = $1';
    if (opts.status === 'open') where += ` AND p.status IN ('proposed', 'confirmed')`;
    else if (opts.status) { params.push(opts.status); where += ` AND p.status = $${params.length}`; }
    if (opts.providerCode) { params.push(opts.providerCode); where += ` AND p.provider_code = $${params.length}`; }
    if (opts.cursor) { params.push(opts.cursor.ts, opts.cursor.id); where += ` AND (p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`; }
    params.push(opts.limit);
    const r = await this.replica.forTenant(tenantId).query<any>(`${PROPOSAL_SQL} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(toProposal);
  }
  async confirmTx(tx: TxContext, tenantId: string, id: string, by: string): Promise<boolean> {
    const r = await tx.query(`UPDATE integration_proposals SET status = 'confirmed', confirmed_by = $3, confirmed_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'proposed'`, [tenantId, id, by]);
    return (r.rowCount ?? 0) === 1;
  }
  async closeTx(tx: TxContext, tenantId: string, id: string, status: 'applied' | 'verify_failed', outcome: Record<string, unknown>): Promise<boolean> {
    const r = await tx.query(
      `UPDATE integration_proposals SET status = $3, outcome = $4::jsonb, closed_at = now(), credential_sealed = NULL WHERE tenant_id = $1 AND id = $2 AND status = 'confirmed'`,
      [tenantId, id, status, JSON.stringify(outcome)]);
    return (r.rowCount ?? 0) === 1;
  }
  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE integration_proposals SET status = 'refused', refused_by = $3, refuse_reason = $4, closed_at = now(), credential_sealed = NULL
        WHERE tenant_id = $1 AND id = $2 AND status = 'proposed'`, [tenantId, id, by, reason]);
    return (r.rowCount ?? 0) === 1;
  }
  async expireTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE integration_proposals SET status = 'expired', closed_at = now(), credential_sealed = NULL
        WHERE tenant_id = $1 AND id = $2 AND status = 'proposed' AND expires_at <= now()`, [tenantId, id]);
    return (r.rowCount ?? 0) === 1;
  }
  async dueToCloseTx(tx: TxContext, tenantId: string, stuckMinutes: number, limit: number): Promise<{ id: string; status: ProposalStatus }[]> {
    const r = await tx.query<any>(
      `SELECT id, status FROM integration_proposals
        WHERE tenant_id = $1 AND ((status = 'proposed' AND expires_at <= now()) OR (status = 'confirmed' AND confirmed_at <= now() - make_interval(mins => $2)))
        ORDER BY created_at LIMIT $3`, [tenantId, stuckMinutes, limit]);
    return r.rows.map((x: any) => ({ id: String(x.id), status: x.status }));
  }
}
