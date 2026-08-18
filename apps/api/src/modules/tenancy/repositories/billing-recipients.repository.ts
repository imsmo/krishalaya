// modules/tenancy/repositories/billing-recipients.repository.ts · PC-56 TENANT-4d-5.
// The two reads a billing NOTICE needs before it can be honest: who to tell, and how to write the amount.
//
// Every method takes a `TxContext` rather than the read replica, and that is a correctness requirement, not a
// style choice: a notice's recipients are resolved in the SAME transaction that writes the outbox row, so the
// recipient list cannot be stale relative to the event and a replica lag cannot make a bill's only warning
// vanish. It also lets the two cross-tenant cadence jobs (trial expiry, usage alerts) use the identical query
// on their own kv_relay client — one query, both roles, proven against both in 0149's live probes.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { BILLING_RECIPIENT_PERMISSION, MAX_BILLING_RECIPIENTS } from '../domain/billing-notice';

@Injectable()
export class BillingRecipientsRepository {
  /**
   * Everybody in this tenant who effectively holds `tenant.settings`.
   *
   * **THIS IS THE INVERSE OF `RoleCacheService.resolveFromDb`, AND IT IS DELIBERATELY THE SAME FOUR CLAUSES.**
   * That service is the platform's single authority on what a person may do inside a tenant: role permissions,
   * UNION per-staff grants, MINUS per-staff denies, and — since TENANT-1b-2 — nothing at all for a member this
   * tenant has suspended. Asking the same question in the other direction ("given a permission, who holds it")
   * with three of those four clauses would produce a recipient set that disagrees with the guard on the very
   * screen the notice sends them to: a suspended member would be SMSed about an invoice they cannot open, and
   * somebody whose billing access was explicitly DENIED by an override would still be told what the platform
   * bills their organisation. Both are trust costs, and the second is a disclosure.
   *
   * `memberSuspendedSql` is imported rather than re-typed for exactly the reason its own header gives: six
   * copies of one predicate is six chances for the seventh site to be written without it. This is the seventh
   * site.
   *
   * ORDERED BY user id so a relay re-delivery resolves the same list in the same order (the notification id is
   * derived per (dedupeKey, user, channel), so a stable list is what makes a retry idempotent rather than a
   * second message). Bounded at the domain ceiling + 1, so the caller can tell "exactly at the limit" from
   * "truncated" without an unbounded read.
   */
  async holdersOfBillingPermission(tx: TxContext, tenantId: string): Promise<string[]> {
    const r = await tx.query<{ user_id: string }>(
      `WITH active AS (
         SELECT utr.id AS utr_id, utr.role_id, utr.user_id
           FROM user_tenant_roles utr
          WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL
       ),
       granted AS (
         SELECT a.user_id, a.utr_id
           FROM active a JOIN role_permissions rp ON rp.role_id = a.role_id
          WHERE rp.permission_code = $2
         UNION
         SELECT a.user_id, a.utr_id
           FROM active a JOIN staff_permission_overrides spo ON spo.user_tenant_role_id = a.utr_id
          WHERE spo.permission_code = $2 AND spo.is_granted
       ),
       effective AS (
         SELECT g.user_id FROM granted g
          WHERE NOT EXISTS (
            SELECT 1 FROM staff_permission_overrides d
             WHERE d.user_tenant_role_id = g.utr_id AND d.permission_code = $2 AND NOT d.is_granted)
       )
       SELECT DISTINCT e.user_id
         FROM effective e
        WHERE NOT ${memberSuspendedSql('$1', 'e.user_id')}
        ORDER BY e.user_id
        LIMIT $3`,
      [tenantId, BILLING_RECIPIENT_PERMISSION, MAX_BILLING_RECIPIENTS + 1]);
    return r.rows.map((x) => x.user_id);
  }

  /**
   * That currency's own minor-unit exponent, for the exact-integer money formatting a notice needs.
   *
   * Returns null when the platform holds no row for the code — which 0149 makes impossible going forward by
   * adding the foreign key `saas_invoices.currency_code → currencies(code)` that 0002 omitted (0035's
   * `billing_adjustments` has it; the invoice table never did). Until every deployment has run 0149 the null is
   * reachable, and the caller REFUSES TO SEND rather than guessing 2: a notice that tells an FPO the wrong
   * amount is worse than a notice that never arrives, and the metric says which happened.
   */
  async minorUnits(tx: TxContext, currencyCode: string): Promise<number | null> {
    const r = await tx.query<{ minor_units: number }>(
      `SELECT minor_units FROM currencies WHERE code = $1`, [currencyCode.toUpperCase()]);
    const v = r.rows[0]?.minor_units;
    return typeof v === 'number' ? v : null;
  }
}
