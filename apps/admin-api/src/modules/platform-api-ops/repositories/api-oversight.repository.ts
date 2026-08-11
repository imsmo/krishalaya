// modules/platform-api-ops/repositories/api-oversight.repository.ts · W106 / W007 (PC-56 ADMIN-11c).
//
// kv_admin, cross-tenant by role (Law 11). **NO QUERY HERE SELECTS `key_hash` OR `secret_hash`, and that is a rule rather
// than an oversight**: W106's subtitle is "secrets are hashes — nobody, including super_admin, can read a key back",
// and the way that stays true is that the god-mode read model never names the column. A hash is not a secret, but a
// hash on a screen is a hash in a screenshot, and offline cracking of a 12-character prefix plus a hash is a real
// exercise for anything but a strong random secret.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { CircuitRow, DeliveryStats, InboundRow, KeyRow } from '../domain/api-oversight';

@Injectable()
export class ApiOversightRepository {
  constructor(private readonly pool: AdminPool) {}

  /**
   * Both key registries in one list.
   *
   * **A UNION, NOT A CHOICE.** `api_keys` (0002, tenant-owned, no issuer anywhere) and `partner_api_keys` (0090, live and
   * enforced) are different registries with different owners, and an oversight screen that showed one would be blind to
   * the other. The `registry` column is what stops a reader adding them up.
   */
  async listKeys(q: { registry?: 'tenant' | 'partner'; revoked?: boolean; cursor?: string; limit: number }): Promise<KeyRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const revokedFilter = (col: string) => (q.revoked === undefined ? '' : q.revoked ? ` AND ${col} IS NOT NULL` : ` AND ${col} IS NULL`);

    const tenantSql = `
      SELECT 'tenant'::text AS registry, k.id::text, k.tenant_id::text AS owner_id, t.legal_name AS owner_name,
             k.name, k.key_prefix, k.scopes, k.rate_per_hour AS rate, k.last_used_at, k.revoked_at,
             k.revoked_reason, k.created_at
        FROM api_keys k LEFT JOIN tenants t ON t.id = k.tenant_id
       WHERE k.deleted_at IS NULL${revokedFilter('k.revoked_at')}`;
    const partnerSql = `
      SELECT 'partner'::text AS registry, k.id::text, k.partner_id::text AS owner_id, fp.legal_name AS owner_name,
             k.name, k.key_prefix, k.scopes, k.rate_limit_per_hour AS rate, k.last_used_at, k.revoked_at,
             NULL::varchar AS revoked_reason, k.created_at
        FROM partner_api_keys k LEFT JOIN financial_partners fp ON fp.id = k.partner_id
       WHERE k.deleted_at IS NULL${revokedFilter('k.revoked_at')}`;

    const parts: string[] = [];
    if (q.registry !== 'partner') parts.push(tenantSql);
    if (q.registry !== 'tenant') parts.push(partnerSql);
    const cursorClause = q.cursor ? ` WHERE created_at < ${p(q.cursor)}` : '';
    const r = await this.pool.query(
      `SELECT * FROM (${parts.join(' UNION ALL ')}) k${cursorClause}
        ORDER BY created_at DESC, id DESC LIMIT ${p(q.limit)}`, params);
    return r.rows.map((x): KeyRow => ({
      id: String(x.id), registry: x.registry === 'partner' ? 'partner' : 'tenant',
      ownerId: String(x.owner_id), ownerName: (x.owner_name as string | null) ?? null,
      name: String(x.name), keyPrefix: String(x.key_prefix),
      scopes: Array.isArray(x.scopes) ? x.scopes.map(String) : [],
      ratePerHour: Number(x.rate ?? 0),
      lastUsedAt: x.last_used_at ? new Date(String(x.last_used_at)).toISOString() : null,
      revokedAt: x.revoked_at ? new Date(String(x.revoked_at)).toISOString() : null,
      revokedReason: (x.revoked_reason as string | null) ?? null,
      createdAt: new Date(String(x.created_at)).toISOString(),
    }));
  }

  async keyById(client: PoolClient, registry: 'tenant' | 'partner', id: string): Promise<{ id: string; ownerId: string; keyPrefix: string; revokedAt: string | null } | null> {
    const sql = registry === 'tenant'
      ? `SELECT id::text, tenant_id::text AS owner_id, key_prefix, revoked_at FROM api_keys WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`
      : `SELECT id::text, partner_id::text AS owner_id, key_prefix, revoked_at FROM partner_api_keys WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`;
    const r = await client.query(sql, [id]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      id: String(x.id), ownerId: String(x.owner_id), keyPrefix: String(x.key_prefix),
      revokedAt: x.revoked_at ? new Date(String(x.revoked_at)).toISOString() : null,
    };
  }

  /** Revoke. **THE REASON IS WRITTEN IN THE SAME STATEMENT AS THE TIMESTAMP**, so 0123's CHECK cannot be satisfied by a
   *  revocation nobody explained — a credential switched off without a reason is an outage whose cause is unlookupable. */
  async revokeKey(client: PoolClient, registry: 'tenant' | 'partner', id: string, adminId: string, reason: string): Promise<void> {
    if (registry === 'tenant') {
      await client.query(
        `UPDATE api_keys SET revoked_at = now(), revoked_reason = $2, revoked_by_admin_id = $3, updated_at = now()
          WHERE id = $1 AND revoked_at IS NULL`, [id, reason.slice(0, 300), adminId]);
      return;
    }
    // `partner_api_keys` has no reason column (0090) and this wave does not add one: the partner realm's own console
    // owns that table's shape, and widening it from here would be this plane reaching into another's schema. The reason
    // lives in the audit row, which is where a reviewer of a platform act looks first.
    await client.query(
      `UPDATE partner_api_keys SET revoked_at = now(), is_active = false, updated_at = now()
        WHERE id = $1 AND revoked_at IS NULL`, [id]);
  }

  async keyCensus(): Promise<{ tenantKeys: number; tenantTenants: number; partnerKeys: number; partnerOwners: number }> {
    const r = await this.pool.query(`
      SELECT (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL AND deleted_at IS NULL)::int AS tenant_keys,
             (SELECT COUNT(DISTINCT tenant_id) FROM api_keys WHERE revoked_at IS NULL AND deleted_at IS NULL)::int AS tenant_tenants,
             (SELECT COUNT(*) FROM partner_api_keys WHERE revoked_at IS NULL AND deleted_at IS NULL)::int AS partner_keys,
             (SELECT COUNT(DISTINCT partner_id) FROM partner_api_keys WHERE revoked_at IS NULL AND deleted_at IS NULL)::int AS partner_owners`);
    const x = r.rows[0];
    return {
      tenantKeys: Number(x.tenant_keys), tenantTenants: Number(x.tenant_tenants),
      partnerKeys: Number(x.partner_keys), partnerOwners: Number(x.partner_owners),
    };
  }

  /** Outbound delivery health — the half of this plane that was already real (endpoints, deliveries, the worker). */
  async deliveryStats(): Promise<DeliveryStats> {
    const r = await this.pool.query(`
      SELECT (SELECT COUNT(*) FROM webhook_endpoints WHERE deleted_at IS NULL)::int AS endpoints,
             (SELECT COUNT(*) FROM webhook_endpoints WHERE is_active AND deleted_at IS NULL)::int AS active_endpoints,
             -- Partition pruned by created_at, which is the partition key (Law 8).
             (SELECT COUNT(*) FROM webhook_deliveries WHERE created_at > now() - interval '24 hours')::int AS attempted,
             (SELECT COUNT(*) FROM webhook_deliveries WHERE created_at > now() - interval '24 hours' AND succeeded)::int AS succeeded,
             (SELECT COUNT(*) FROM webhook_deliveries WHERE NOT succeeded AND next_retry_at IS NOT NULL)::int AS pending_retry,
             -- **THE NUMBER THAT MATTERS AND THAT NOTHING ELSE ON THIS PLATFORM WILL MENTION AGAIN.** The worker gives
             -- up after 8 attempts by setting next_retry_at to NULL; from that moment the tenant will never receive the
             -- event and no other surface says so.
             (SELECT COUNT(*) FROM webhook_deliveries
               WHERE created_at > now() - interval '24 hours' AND NOT succeeded AND next_retry_at IS NULL)::int AS exhausted`);
    const x = r.rows[0];
    return {
      endpoints: Number(x.endpoints), activeEndpoints: Number(x.active_endpoints),
      attempted24h: Number(x.attempted), succeeded24h: Number(x.succeeded),
      pendingRetry: Number(x.pending_retry), exhausted24h: Number(x.exhausted),
    };
  }

  /** The inbound log W106 draws and nothing could fill until 0123. */
  async listInbound(q: { providerCode?: string; failuresOnly?: boolean; limit: number }): Promise<InboundRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `created_at > now() - interval '7 days'`;
    if (q.providerCode) where += ` AND provider_code = ${p(q.providerCode)}`;
    if (q.failuresOnly) where += ` AND signature_ok = false`;
    const r = await this.pool.query(
      `SELECT id::text, provider_code, event_type, signature_ok, signature_reason, processing_status,
              truncated, raw_bytes, created_at
         FROM inbound_webhooks WHERE ${where}
        ORDER BY created_at DESC, id DESC LIMIT ${p(q.limit)}`, params);
    return r.rows.map((x): InboundRow => ({
      id: String(x.id), providerCode: String(x.provider_code),
      eventType: (x.event_type as string | null) ?? null,
      signatureOk: x.signature_ok === null || x.signature_ok === undefined ? null : Boolean(x.signature_ok),
      signatureReason: (x.signature_reason as string | null) ?? null,
      processingStatus: String(x.processing_status),
      truncated: Boolean(x.truncated),
      rawBytes: x.raw_bytes === null || x.raw_bytes === undefined ? null : Number(x.raw_bytes),
      createdAt: new Date(String(x.created_at)).toISOString(),
    }));
  }

  /** W106's "inbound signature failures 24h", broken down the way its own caption reads ("all from one stale Gupshup
   *  secret") — which needs the REASON, not just a count. */
  async inboundFailureCensus(): Promise<{ total24h: number; byReason: { reason: string; provider: string; n: number }[]; undecided: number }> {
    const [totals, breakdown] = await Promise.all([
      this.pool.query(`
        SELECT COUNT(*) FILTER (WHERE signature_ok = false)::int AS failures,
               -- A receipt recorded and never settled: the process died mid-handling. A finding, not a neutral state.
               COUNT(*) FILTER (WHERE signature_ok IS NULL)::int AS undecided
          FROM inbound_webhooks WHERE created_at > now() - interval '24 hours'`),
      this.pool.query(`
        SELECT COALESCE(signature_reason, 'unrecorded') AS reason, provider_code, COUNT(*)::int AS n
          FROM inbound_webhooks
         WHERE created_at > now() - interval '24 hours' AND signature_ok = false
         GROUP BY 1, 2 ORDER BY n DESC LIMIT 20`),
    ]);
    return {
      total24h: Number(totals.rows[0].failures),
      undecided: Number(totals.rows[0].undecided),
      byReason: breakdown.rows.map((x) => ({ reason: String(x.reason), provider: String(x.provider_code), n: Number(x.n) })),
    };
  }

  /**
   * W007's Circuit column: the latest transition PER INSTANCE per dependency.
   *
   * **THE `DISTINCT ON` IS THE WHOLE QUERY.** A breaker is per-process, so the fleet's state is a set of per-pod
   * states — aggregating them into one row would turn "open on one pod of eight" into either "open" or "closed",
   * both of which are wrong. The 24-hour bound is deliberate too: a pod that reported three days ago and has since
   * been replaced is not a pod whose breaker state means anything now.
   */
  async circuits(): Promise<CircuitRow[]> {
    const [deps, events] = await Promise.all([
      this.pool.query(`
        SELECT d.dep, d.provider_code, d.display_name, d.category, d.fallback_strategy, d.is_money
          FROM provider_dependencies d WHERE d.deleted_at IS NULL ORDER BY d.category, d.dep`),
      this.pool.query(`
        SELECT DISTINCT ON (dep, instance_id)
               dep, instance_id, to_state, consecutive_failures, occurred_at
          FROM provider_circuit_events
         WHERE occurred_at > now() - interval '24 hours'
         ORDER BY dep, instance_id, occurred_at DESC`),
    ]);
    const byDep = new Map<string, CircuitRow['instances']>();
    for (const e of events.rows) {
      const list = byDep.get(String(e.dep)) ?? [];
      list.push({
        instanceId: String(e.instance_id), state: String(e.to_state),
        consecutiveFailures: e.consecutive_failures === null ? null : Number(e.consecutive_failures),
        occurredAt: new Date(String(e.occurred_at)).toISOString(),
      });
      byDep.set(String(e.dep), list);
    }
    return deps.rows.map((d): CircuitRow => ({
      dep: String(d.dep),
      providerCode: (d.provider_code as string | null) ?? null,
      displayName: (d.display_name as string | null) ?? null,
      category: (d.category as string | null) ?? null,
      fallbackStrategy: (d.fallback_strategy as string | null) ?? null,
      isMoney: Boolean(d.is_money),
      instances: byDep.get(String(d.dep)) ?? [],
    }));
  }

  /** The transition history one dependency shows: W007's "open after 12 consecutive 5xx since 13:40 IST". */
  async circuitHistory(dep: string, limit: number): Promise<{ instanceId: string; fromState: string; toState: string; consecutiveFailures: number | null; occurredAt: string }[]> {
    const r = await this.pool.query(
      `SELECT instance_id, from_state, to_state, consecutive_failures, occurred_at
         FROM provider_circuit_events
        WHERE dep = $1 AND occurred_at > now() - interval '30 days'
        ORDER BY occurred_at DESC, id DESC LIMIT $2`, [dep, limit]);
    return r.rows.map((x) => ({
      instanceId: String(x.instance_id), fromState: String(x.from_state), toState: String(x.to_state),
      consecutiveFailures: x.consecutive_failures === null ? null : Number(x.consecutive_failures),
      occurredAt: new Date(String(x.occurred_at)).toISOString(),
    }));
  }
}
