// modules/tenancy/repositories/tenant-domain.repository.ts · SQL for tenant_domains + tenant_domain_proposals (0002, reshaped by 0194).
// tenant_id in EVERY query (Law 1) + RLS (0175 split shape since 0194). kv_app has NO DELETE (F-6): removal is a soft delete, and it
// happens only inside the transaction that confirms a proposal (0194 `trg_tenant_domains_gate`). Reads on the replica; µs keyset (F-20).
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { DomainKind, TlsStatus, VerificationStatus } from '../domain/domain-rules';
import { DomainProposalStatus } from '../domain/brand-domain.state';

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface DomainRow {
  id: string; tenantId: string; domain: string; kind: DomainKind; isPrimary: boolean; tlsStatus: TlsStatus; tlsNote: string | null;
  verificationStatus: VerificationStatus; verificationToken: string | null; verifiedAt: string | null; lastCheckedAt: string | null;
  lastManualCheckAt: string | null; checkError: string | null; expiresAt: string | null; createdAt: string; cursorTs: string;
}
export interface DomainProposalRow {
  id: string; tenantId: string; kind: 'make_primary' | 'remove'; domainId: string; domain: string; successorDomainId: string | null;
  successorDomain: string | null; reason: string; proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string;
  status: DomainProposalStatus; confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null; cursorTs: string;
}

const COLS = `d.id, d.tenant_id, d.domain, d.kind, d.is_primary, d.tls_status, d.tls_note, d.verification_status, d.verification_token,
  ${iso('d.verified_at')} AS verified_at, ${iso('d.last_checked_at')} AS last_checked_at, ${iso('d.last_manual_check_at')} AS last_manual_check_at,
  d.check_error, ${iso('d.expires_at')} AS expires_at, ${iso('d.created_at')} AS created_at, ${US_SQL('d.created_at')} AS cursor_ts`;
function rowOf(r: any): DomainRow {
  return {
    id: r.id, tenantId: r.tenant_id, domain: r.domain, kind: r.kind, isPrimary: r.is_primary === true, tlsStatus: r.tls_status, tlsNote: r.tls_note ?? null,
    verificationStatus: r.verification_status, verificationToken: r.verification_token ?? null, verifiedAt: r.verified_at ?? null,
    lastCheckedAt: r.last_checked_at ?? null, lastManualCheckAt: r.last_manual_check_at ?? null, checkError: r.check_error ?? null,
    expiresAt: r.expires_at ?? null, createdAt: r.created_at, cursorTs: r.cursor_ts,
  };
}
const PROPOSAL_SELECT = `SELECT p.id, p.tenant_id, p.kind, p.domain_id, p.domain, p.successor_domain_id, s.domain AS successor_domain, p.reason,
  p.proposed_by, pu.full_name AS proposed_by_name, ${iso('p.proposed_at')} AS proposed_at, ${iso('p.expires_at')} AS expires_at, p.status,
  p.confirmed_by, cu.full_name AS confirmed_by_name, ${iso('p.confirmed_at')} AS confirmed_at, p.refused_by, ${iso('p.refused_at')} AS refused_at,
  p.refuse_reason, ${iso('p.expired_at')} AS expired_at, ${US_SQL('p.created_at')} AS cursor_ts
  FROM tenant_domain_proposals p LEFT JOIN tenant_domains s ON s.id = p.successor_domain_id
  LEFT JOIN users pu ON pu.id = p.proposed_by LEFT JOIN users cu ON cu.id = p.confirmed_by`;
function proposalOf(r: any): DomainProposalRow {
  return {
    id: r.id, tenantId: r.tenant_id, kind: r.kind, domainId: r.domain_id, domain: r.domain, successorDomainId: r.successor_domain_id ?? null,
    successorDomain: r.successor_domain ?? null, reason: r.reason, proposedBy: r.proposed_by, proposedByName: r.proposed_by_name ?? null,
    proposedAt: r.proposed_at, expiresAt: r.expires_at, status: r.status, confirmedBy: r.confirmed_by ?? null, confirmedByName: r.confirmed_by_name ?? null,
    confirmedAt: r.confirmed_at ?? null, refusedBy: r.refused_by ?? null, refusedAt: r.refused_at ?? null, refuseReason: r.refuse_reason ?? null,
    expiredAt: r.expired_at ?? null, cursorTs: r.cursor_ts,
  };
}

@Injectable()
export class TenantDomainRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ---- reads -------------------------------------------------------------------------------------------------------------- */

  async get(tenantId: string, id: string, tx?: SqlExecutor, forUpdate = false): Promise<DomainRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM tenant_domains d WHERE d.id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`, [id, tenantId]);
    return r.rows[0] ? rowOf(r.rows[0]) : null;
  }
  async byName(tenantId: string, domain: string, tx?: SqlExecutor): Promise<DomainRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM tenant_domains d WHERE d.domain = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`, [domain, tenantId]);
    return r.rows[0] ? rowOf(r.rows[0]) : null;
  }
  /** Live domains, the included row first, then newest first — µs keyset on (created_at, id) (F-20). */
  async list(tenantId: string, cursor: KeysetCursor | undefined, limit: number): Promise<DomainRow[]> {
    const params: unknown[] = [tenantId]; let where = `d.tenant_id = $1 AND d.deleted_at IS NULL`;
    if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (d.created_at, d.id) < ($2::timestamptz, $3::uuid)`; }
    params.push(limit);
    const r = await this.on(tenantId).query(`SELECT ${COLS} FROM tenant_domains d WHERE ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(rowOf);
  }
  async counts(tenantId: string): Promise<{ total: number; custom: number; verified: number }> {
    const r = await this.on(tenantId).query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE kind = 'custom')::int AS custom, count(*) FILTER (WHERE verification_status = 'verified')::int AS verified
         FROM tenant_domains WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]);
    return { total: Number(r.rows[0]?.total ?? 0), custom: Number(r.rows[0]?.custom ?? 0), verified: Number(r.rows[0]?.verified ?? 0) };
  }
  /** 0194 `domain_reserved_problem` — the ONE reserved rule (the gate trigger enforces the same function). */
  async reservedProblem(tenantId: string, domain: string, tx?: SqlExecutor): Promise<string | null> {
    const r = await this.on(tenantId, tx).query(`SELECT domain_reserved_problem($1) AS p`, [domain]);
    return r.rows[0]?.p ?? null;
  }
  async verifiedElsewhere(tenantId: string, domain: string, tx?: SqlExecutor): Promise<boolean> {
    const r = await this.on(tenantId, tx).query(`SELECT tenant_domain_verified_elsewhere($1, $2) AS v`, [domain, tenantId]);
    return r.rows[0]?.v === true;
  }
  async platform(tenantId: string, tx?: SqlExecutor): Promise<{ edge: string; suffix: string; wildcardReady: boolean; resolvers: string[] }> {
    const r = await this.on(tenantId, tx).query(
      `SELECT kv_platform_setting('platform.edge_hostname') AS edge, kv_platform_setting('platform.included_suffix') AS suffix,
              kv_platform_setting('platform.wildcard_tls_ready') AS wildcard, kv_platform_setting('platform.dns_resolvers') AS resolvers`);
    const x = r.rows[0] ?? {};
    return {
      edge: String(x.edge ?? ''), suffix: String(x.suffix ?? ''), wildcardReady: x.wildcard === true,
      resolvers: Array.isArray(x.resolvers) ? x.resolvers.map(String) : [],
    };
  }

  /* ---- writes ------------------------------------------------------------------------------------------------------------- */

  /** A custom claim: born pending, non-primary, TLS pending, 7-day window — exactly what 0194's gate admits. */
  async insertClaimTx(tx: TxContext, tenantId: string, domain: string, token: string, userId: string): Promise<string> {
    const r = await tx.query(
      `INSERT INTO tenant_domains (tenant_id, domain, kind, is_primary, tls_status, tls_note, verification_status, verification_token, expires_at, created_by, updated_by)
       VALUES ($1,$2,'custom',false,'pending',NULL,'pending',$3, now() + interval '7 days', $4, $4) RETURNING id`, [tenantId, domain, token, userId]);
    return r.rows[0].id;
  }
  async markManualCheckTx(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE tenant_domains SET last_manual_check_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }
  /** The DNS verifier's own act: the only path to `verified` (0194 requires app.domain_verifier = 'dns' and now()). */
  async markVerifiedTx(tx: TxContext, tenantId: string, id: string, tlsNote: string): Promise<void> {
    await tx.query(`SELECT set_config('app.domain_verifier', 'dns', true)`);
    await tx.query(
      `UPDATE tenant_domains SET verification_status = 'verified', verified_at = now(), last_checked_at = now(), check_error = NULL,
              tls_status = 'pending', tls_note = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [id, tenantId, tlsNote]);
    await tx.query(`SELECT set_config('app.domain_verifier', '', true)`);
  }
  async markFailedTx(tx: TxContext, tenantId: string, id: string, error: string): Promise<void> {
    await tx.query(
      `UPDATE tenant_domains SET verification_status = 'failed', last_checked_at = now(), check_error = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`, [id, tenantId, error.slice(0, 1000)]);
  }
  /** An unproven claim past its window: expired and RELEASED (soft-deleted — the name is free again). */
  async releaseExpiredTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE tenant_domains SET verification_status = 'expired', deleted_at = now(), last_checked_at = now(),
              check_error = COALESCE(check_error, 'not proven within 7 days'), updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND verification_status IN ('pending', 'failed') AND expires_at <= now()`, [id, tenantId]);
    return (r.rowCount ?? 0) === 1;
  }
  /** The included subdomain's TLS follows the platform wildcard certificate (both ways). */
  async syncIncludedTlsTx(tx: TxContext, tenantId: string, ready: boolean, note: string): Promise<number> {
    const r = await tx.query(
      `UPDATE tenant_domains SET tls_status = $2, tls_note = $3, updated_at = now()
        WHERE tenant_id = $1 AND kind = 'included' AND deleted_at IS NULL AND tls_status <> $2`,
      [tenantId, ready ? 'issued' : 'pending', ready ? null : note]);
    return r.rowCount ?? 0;
  }
  async citeProposalTx(tx: TxContext, id: string): Promise<void> {
    await tx.query(`SELECT set_config('app.domain_proposal_id', $1, true)`, [id]);
  }
  async demotePrimaryTx(tx: TxContext, tenantId: string): Promise<string | null> {
    const r = await tx.query(`UPDATE tenant_domains SET is_primary = false, updated_at = now() WHERE tenant_id = $1 AND is_primary AND deleted_at IS NULL RETURNING domain`, [tenantId]);
    return r.rows[0]?.domain ?? null;
  }
  async promoteTx(tx: TxContext, tenantId: string, id: string, userId: string): Promise<void> {
    await tx.query(`UPDATE tenant_domains SET is_primary = true, updated_at = now(), updated_by = $3 WHERE id = $1 AND tenant_id = $2`, [id, tenantId, userId]);
  }
  async softRemoveTx(tx: TxContext, tenantId: string, id: string, userId: string, reason: string): Promise<void> {
    await tx.query(
      `UPDATE tenant_domains SET is_primary = false, deleted_at = now(), deleted_by = $3, delete_reason = $4, updated_at = now(), updated_by = $3
        WHERE id = $1 AND tenant_id = $2`, [id, tenantId, userId, reason]);
  }

  /* ---- proposals ---------------------------------------------------------------------------------------------------------- */

  async insertProposalTx(tx: TxContext, p: { tenantId: string; kind: 'make_primary' | 'remove'; domainId: string; domain: string; successorDomainId: string | null; reason: string; proposedBy: string }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO tenant_domain_proposals (tenant_id, kind, domain_id, domain, successor_domain_id, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now() + interval '7 days') RETURNING id`,
      [p.tenantId, p.kind, p.domainId, p.domain, p.successorDomainId, p.reason, p.proposedBy]);
    return r.rows[0].id;
  }
  async proposal(tenantId: string, id: string, tx?: SqlExecutor, forUpdate = false): Promise<DomainProposalRow | null> {
    const r = await this.on(tenantId, tx).query(`${PROPOSAL_SELECT} WHERE p.tenant_id = $1 AND p.id = $2${forUpdate ? ' FOR UPDATE OF p' : ''}`, [tenantId, id]);
    return r.rows[0] ? proposalOf(r.rows[0]) : null;
  }
  async liveProposals(tenantId: string): Promise<DomainProposalRow[]> {
    const r = await this.on(tenantId).query(`${PROPOSAL_SELECT} WHERE p.tenant_id = $1 AND p.status = 'proposed' ORDER BY p.created_at DESC LIMIT 50`, [tenantId]);
    return r.rows.map(proposalOf);
  }
  async listProposals(tenantId: string, cursor: KeysetCursor | undefined, limit: number): Promise<DomainProposalRow[]> {
    const params: unknown[] = [tenantId]; let where = 'p.tenant_id = $1';
    if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (p.created_at, p.id) < ($2::timestamptz, $3::uuid)`; }
    params.push(limit);
    const r = await this.on(tenantId).query(`${PROPOSAL_SELECT} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(proposalOf);
  }
  async confirmTx(tx: TxContext, tenantId: string, id: string, checker: string): Promise<void> {
    await tx.query(`UPDATE tenant_domain_proposals SET status='confirmed', confirmed_by=$3, confirmed_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, checker]);
  }
  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE tenant_domain_proposals SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, reason]);
  }
  async expireProposalTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`UPDATE tenant_domain_proposals SET status='expired', expired_at=now() WHERE id=$1 AND tenant_id=$2 AND status='proposed' AND expires_at <= now()`, [id, tenantId]);
    return (r.rowCount ?? 0) === 1;
  }
  async dueProposalsTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query(`SELECT id FROM tenant_domain_proposals WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now() ORDER BY expires_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => x.id);
  }

  /* ---- the verifier job ---------------------------------------------------------------------------------------------------- */

  /** Which tenants have claims to check or included rows to sync — read by the runner's pool (kv_relay: SELECT only). */
  async tenantsToVisit(pool: Pool): Promise<string[]> {
    const r = await pool.query(
      `SELECT DISTINCT tenant_id AS id FROM tenant_domains WHERE deleted_at IS NULL AND (verification_status IN ('pending', 'failed') OR kind = 'included') ORDER BY 1`);
    return r.rows.map((x: { id: string }) => x.id);
  }
  async dueClaimsTx(tx: TxContext, tenantId: string, everyMs: number, limit: number): Promise<DomainRow[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM tenant_domains d
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.kind = 'custom' AND d.verification_status IN ('pending', 'failed')
          AND (d.last_checked_at IS NULL OR d.last_checked_at <= now() - ($2::int * interval '1 millisecond') OR d.expires_at <= now())
        ORDER BY d.last_checked_at NULLS FIRST, d.id LIMIT $3`, [tenantId, everyMs, limit]);
    return r.rows.map(rowOf);
  }
}
