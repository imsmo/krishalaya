// shared/sql/member-suspension.sql.ts · THE ONE PLACE THE SUSPENSION RULE IS WRITTEN (PC-56 TENANT-1b-2).
//
// W154 promises that suspending a member "pauses listings". That promise touches SIX separate read paths — the public
// search feed, the gallery, the links model, the seller profile, the mandi band, and the offers service — plus the
// listing write path. Six copies of one predicate is six chances for the seventh site to be written without it, and a
// suspension that works on five paths out of six is worse than none: staff would learn that suspension *sometimes* works
// and stop trusting the control.
//
// **SO THE PREDICATE IS A SINGLE EXPORTED STRING, AND A TEST ENUMERATES THE FILES THAT MUST CONTAIN IT.** The test is the
// part that matters: it fails when somebody adds a seventh public listing read without the clause, which is the failure
// mode a code review will not catch a year from now.
//
// **AND IT IS SQL RATHER THAN A TYPESCRIPT PREDICATE.** Two of the six sites compute visibility in TypeScript from a
// fetched row and four filter in SQL; expressing the rule twice, once per form, would be the same drift in a different
// costume. So the TypeScript sites SELECT the answer instead of recomputing it.

/**
 * The bare predicate: is this (tenant, user) pair under a live suspension?
 *
 * Used by `RoleCacheService` (which lives in `core/` and cannot import a module's repository) and by the auth paths, so
 * that the front door, the RBAC resolver and the marketplace all read the SAME four conditions. Two of those callers are
 * on the hot path, which is why the partial-index predicates are spelled out rather than left implicit.
 */
export function memberSuspendedSql(tenantParam: string, userParam: string): string {
  return `EXISTS (
    SELECT 1 FROM tenant_member_suspensions kvs
     WHERE kvs.tenant_id = ${tenantParam}
       AND kvs.user_id = ${userParam}
       AND kvs.lifted_at IS NULL
       AND kvs.deleted_at IS NULL)`;
}

/**
 * A NOT EXISTS clause that excludes a seller currently suspended in this tenant.
 *
 * @param listingAlias the table or alias carrying `tenant_id` and `seller_user_id` (e.g. `listings`, `l`)
 *
 * **PERFORMANCE, BECAUSE THIS LANDS ON THE PUBLIC FEED.** `idx_tms_live_lookup` is a PARTIAL index over
 * `(tenant_id, user_id) WHERE lifted_at IS NULL AND deleted_at IS NULL`, so it contains only OPEN suspensions — a handful
 * of rows per tenant, not the history. Postgres runs this as an anti-join against a tiny index, which is why the rule can
 * sit on a path that serves a farmer's price search. The `lifted_at IS NULL AND deleted_at IS NULL` predicates are
 * repeated here verbatim so the planner can match the partial index; dropping them would still be CORRECT and would
 * quietly stop using the index (TENANT-1b-2-Q2: measure it on a real feed before Y3 traffic).
 */
export function sellerNotSuspendedSql(listingAlias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM tenant_member_suspensions kvs
     WHERE kvs.tenant_id = ${listingAlias}.tenant_id
       AND kvs.user_id = ${listingAlias}.seller_user_id
       AND kvs.lifted_at IS NULL
       AND kvs.deleted_at IS NULL)`;
}

/**
 * The same question as a scalar, for the two sites that already fetch the listing row and decide visibility in
 * TypeScript. They SELECT this rather than re-expressing the rule.
 *
 * @param tenantParam the bound parameter or column holding the tenant id
 * @param sellerColumn the column holding the seller's user id
 */
export function sellerSuspendedExpr(tenantParam: string, sellerColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM tenant_member_suspensions kvs
     WHERE kvs.tenant_id = ${tenantParam}
       AND kvs.user_id = ${sellerColumn}
       AND kvs.lifted_at IS NULL
       AND kvs.deleted_at IS NULL)`;
}

/**
 * Is a listing publicly visible?
 *
 * **THE ONE PLACE THIS THREE-PART RULE IS EXPRESSED**, because it was previously written out at three sites and a
 * suspension makes it four parts. Status, visibility, and now the seller's standing in this tenant.
 *
 * An OWNER (or a moderator) still sees their own listing: a suspended member must be able to look at their own catalogue
 * while they sort the suspension out, and hiding it from them as well would make the platform look broken rather than
 * strict. What they cannot do is be seen by buyers, or publish anything new.
 */
export function isPubliclyVisible(l: { status: string; visibility: string; sellerSuspended: boolean }): boolean {
  if (l.sellerSuspended) return false;
  return l.status === 'published' && (l.visibility === 'public' || l.visibility === 'cross_tenant');
}
