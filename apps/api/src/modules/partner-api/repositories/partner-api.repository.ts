// modules/partner-api/repositories/partner-api.repository.ts · PC-55 A10. SQL for the partner realm.
//
// TWO DIFFERENT CONNECTION POSTURES LIVE IN THIS FILE, on purpose:
//
//  1. CONTROL PLANE (key lookup, last_used_at stamp) runs as the ordinary app role on shard 0.
//     `partner_api_keys` is a global control-plane table with no tenant_id — the same posture as `feature_flags`,
//     which FlagsService also reads on replica(0). Migration 0090 revoked INSERT/DELETE from kv_app and granted
//     UPDATE on the single column `last_used_at`, so the strongest thing this process can do to a credential is
//     note that it was used. Minting/revoking is a human-run script (db/scripts/mint-partner-key.js).
//
//  2. BOOK READS run inside `withPartnerSession()`: a READ ONLY transaction that assumes the least-privilege role
//     `kv_partner` (SET LOCAL, so it evaporates at COMMIT/ROLLBACK) and sets `app.partner_id` LOCAL. The RLS
//     policies from 0090 then make every row this transaction can even SEE belong to that one partner — across all
//     tenants, which is exactly the axis a bank's book runs on and exactly the axis tenant RLS cannot express.
//     The partner_id predicates repeated in the WHERE clauses below are DEFENCE IN DEPTH (and index help), not the
//     protection: delete them and the queries still cannot leak, which is the property worth having.
//
//  CROSS-SHARD (Rule Zero: nothing here caps scale): a partner's book spans tenants, and tenants span shards, so
//  book reads SCATTER over every configured shard and merge. At SHARD_COUNT=1 that is byte-identical to a single
//  query. Ordering is by uuid v7 id DESC — v7 is time-ordered, so a merged sort is a true recency sort and the
//  `cursorId` pagination stays correct across shards without OFFSET (which would re-scan on every page).
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { AppConfig } from '../../../core/config/app-config';
import { TxContext } from '../../../core/database/unit-of-work';
import { PartnerOwnershipKind } from '../domain/partner-webhook.rules';

export interface PartnerKeyRow {
  id: string; partnerId: string; name: string; keyHash: string;
  scopes: string[]; rateLimitPerHour: number; isActive: boolean; revokedAt: string | null; lastUsedAt: string | null;
}

@Injectable()
export class PartnerApiRepository {
  constructor(private readonly pools: PgPoolProvider, private readonly config: AppConfig) {}

  private get shardCount(): number { return Math.max(1, this.config.shardCount); }

  // ---------------- control plane ----------------

  /** ONE indexed read on the unique key_prefix. Returns the row even when inactive/revoked — the GUARD decides
   *  usability (partner-key.rules.isUsable) so that decision is pure and unit-tested, not buried in SQL. */
  async findKeyByPrefix(prefix: string): Promise<PartnerKeyRow | null> {
    const r = await this.pools.replica(0).query(
      `SELECT id, partner_id, name, key_hash, scopes, rate_limit_per_hour, is_active, revoked_at, last_used_at
         FROM partner_api_keys WHERE key_prefix = $1 AND deleted_at IS NULL`, [prefix]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      id: x.id, partnerId: x.partner_id, name: x.name, keyHash: x.key_hash,
      scopes: Array.isArray(x.scopes) ? x.scopes : [],
      rateLimitPerHour: Number(x.rate_limit_per_hour), isActive: x.is_active === true,
      revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null,
      lastUsedAt: x.last_used_at ? new Date(x.last_used_at).toISOString() : null,
    };
  }

  /** Throttled by the caller (once per minute per key). Best-effort: a failed stamp must never fail a partner's
   *  read — it is an observability nicety, not part of the answer. */
  async touchLastUsed(keyId: string): Promise<void> {
    await this.pools.writer(0).query(
      `UPDATE partner_api_keys SET last_used_at = now(), updated_at = now() WHERE id = $1`, [keyId]).catch(() => undefined);
  }

  // ---------------- book reads (partner axis) ----------------

  private async withPartnerSession<T>(shardId: number, partnerId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pools.replica(shardId).connect();
    try {
      await client.query('BEGIN READ ONLY');
      // Order matters only in that both must be in force before any user SQL runs. SET LOCAL ROLE is undone by the
      // COMMIT/ROLLBACK below, so a pooled connection is never handed back still wearing partner privileges.
      await client.query('SET LOCAL ROLE kv_partner');
      await client.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      await client.query('RESET ROLE').catch(() => undefined); // belt-and-braces before the pool reuses it
      client.release();
    }
  }

  private async scatter<T>(partnerId: string, run: (c: PoolClient) => Promise<T[]>): Promise<T[]> {
    const shards = Array.from({ length: this.shardCount }, (_, i) => i);
    const perShard = await Promise.all(shards.map((s) => this.withPartnerSession(s, partnerId, run)));
    return perShard.flat();
  }

  /** The lending servicing book. Money as bigint minor STRINGS (Law 2) — never a JS number. */
  async loans(partnerId: string, q: { status?: string; cursorId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const rows = await this.scatter(partnerId, async (c) => {
      const r = await c.query(
        `SELECT id, tenant_id, borrower_user_id, principal_minor::text, interest_apr_bps, disbursed_at, maturity_date,
                status::text AS status, outstanding_minor::text, next_due_date
           FROM loans
          WHERE partner_id = current_partner_id()
            AND deleted_at IS NULL
            AND ($1::text IS NULL OR status = $1::loan_status)
            AND ($2::uuid IS NULL OR id < $2::uuid)
          ORDER BY id DESC LIMIT $3`,
        [q.status ?? null, q.cursorId ?? null, q.limit]);
      return r.rows;
    });
    return rows
      .sort((a: any, b: any) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, q.limit)
      .map((x: any) => ({
        id: x.id, tenantId: x.tenant_id, borrowerUserId: x.borrower_user_id,
        principalMinor: x.principal_minor, interestAprBps: Number(x.interest_apr_bps),
        disbursedAt: x.disbursed_at ? String(x.disbursed_at).slice(0, 10) : null,
        maturityDate: x.maturity_date ? String(x.maturity_date).slice(0, 10) : null,
        status: x.status, outstandingMinor: x.outstanding_minor,
        nextDueDate: x.next_due_date ? String(x.next_due_date).slice(0, 10) : null,
      }));
  }

  /** Repayment schedule + what has actually been paid, for ONE loan of this partner's book. The EXISTS is evaluated
   *  under the loans policy too, so two independent checks must agree (0090). */
  async loanRepayments(partnerId: string, loanId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.scatter(partnerId, async (c) => {
      const r = await c.query(
        `SELECT r.id, r.loan_id, r.due_date, r.amount_due_minor::text, r.amount_paid_minor::text, r.paid_at, r.channel
           FROM loan_repayments r
          WHERE r.loan_id = $1
            AND EXISTS (SELECT 1 FROM loans l WHERE l.id = $1 AND l.partner_id = current_partner_id())
          ORDER BY r.due_date LIMIT $2`, [loanId, limit]);
      return r.rows;
    });
    return rows.slice(0, limit).map((x: any) => ({
      id: x.id, loanId: x.loan_id, dueDate: String(x.due_date).slice(0, 10),
      amountDueMinor: x.amount_due_minor, amountPaidMinor: x.amount_paid_minor,
      paidAt: x.paid_at ? new Date(x.paid_at).toISOString() : null, channel: x.channel ?? null,
    }));
  }

  /** The insurer book. Ownership is proven by the SECURITY DEFINER oracle, so no insurer ever gains a route to
   *  another insurer's `insurance_products.premium_calc` (their pricing model) — see 0090's header. */
  async policies(partnerId: string, q: { status?: string; cursorId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const rows = await this.scatter(partnerId, async (c) => {
      const r = await c.query(
        `SELECT id, tenant_id, holder_user_id, product_id, policy_no, subject_type, subject_id,
                status::text AS status, sum_insured_minor::text, premium_minor::text, valid_from, valid_until
           FROM insurance_policies
          WHERE partner_owns_insurance_policy(product_id)
            AND deleted_at IS NULL
            AND ($1::text IS NULL OR status = $1::policy_status)
            AND ($2::uuid IS NULL OR id < $2::uuid)
          ORDER BY id DESC LIMIT $3`,
        [q.status ?? null, q.cursorId ?? null, q.limit]);
      return r.rows;
    });
    return rows
      .sort((a: any, b: any) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, q.limit)
      .map((x: any) => ({
        id: x.id, tenantId: x.tenant_id, holderUserId: x.holder_user_id, productId: x.product_id,
        policyNo: x.policy_no ?? null, subjectType: x.subject_type, subjectId: x.subject_id ?? null,
        status: x.status, sumInsuredMinor: x.sum_insured_minor, premiumMinor: x.premium_minor,
        validFrom: String(x.valid_from).slice(0, 10), validUntil: String(x.valid_until).slice(0, 10),
      }));
  }

  // ---------------- webhook fanout (relay tier, inside the producing event's tx) ----------------

  /** WHO OWNS THIS EVENT — answered from the aggregate's own row, never from the payload (see
   *  domain/partner-webhook.rules.ts). Runs on the relay connection, which is BYPASSRLS by design (0018): resolving
   *  ownership is precisely the question RLS cannot be asked, because the answer decides the tenancy of the read. */
  async resolveOwnerPartner(tx: TxContext, kind: PartnerOwnershipKind, aggregateId: string): Promise<string | null> {
    const sql = kind === 'loan'
      ? `SELECT partner_id FROM loans WHERE id = $1`
      : kind === 'insurance_policy'
        ? `SELECT pr.partner_id FROM insurance_policies po JOIN insurance_products pr ON pr.id = po.product_id WHERE po.id = $1`
        : `SELECT pr.partner_id FROM insurance_claims c
             JOIN insurance_policies po ON po.id = c.policy_id
             JOIN insurance_products pr ON pr.id = po.product_id WHERE c.id = $1`;
    const r = await tx.query(sql, [aggregateId]);
    return r.rows[0]?.partner_id ?? null;
  }

  /** Live endpoints of ONE partner (the fanout only ever asks about the resolved owner, so this is never a scan). */
  async activeEndpointsForPartner(tx: TxContext, partnerId: string): Promise<Array<{ id: string; partnerId: string; eventTypes: string[]; isActive: boolean }>> {
    const r = await tx.query(
      `SELECT id, partner_id, event_types, is_active FROM partner_webhook_endpoints
        WHERE partner_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 100`, [partnerId]);
    return r.rows.map((x: any) => ({
      id: x.id, partnerId: x.partner_id, eventTypes: Array.isArray(x.event_types) ? x.event_types : [], isActive: x.is_active === true,
    }));
  }
}
