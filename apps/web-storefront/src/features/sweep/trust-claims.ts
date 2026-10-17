// apps/web-storefront/src/features/sweep/trust-claims.ts · PC-56 STORE-SWEEP-a · C1 (founder D2, trust) — TRUST & YOUR DATA SAYS WHAT THE CODE DOES.
// PURE. Every claim the page prints is here: TRUE with the MECHANISM that makes it true (a second sentence, printed beside it), or REFUSED by
// name (features/sweep/refusals.ts — UNPROVABLE from code). The page never claims what a lawyer or a contract must establish. The render test
// derives the page from this list.

/** The zero-sum monitor's cadence (minutes) — apps/worker/src/jobs/recon-zero-sum.job.ts `intervalSec: 300`. Drift-checked (sweep-facts.spec). */
export const ZERO_SUM_EVERY_MINUTES = 5;
/** The public counts' cadence (minutes) — apps/api/src/core/tenancy-context/storefront-public-stats.job.ts `STOREFRONT_PUBLIC_STATS_MS = 15 * 60_000`.
 *  Drift-checked (sweep-facts.spec). About prints it beside the "as of" line (W308's "refreshed daily" is a DELTA). */
export const STATS_EVERY_MINUTES = 15;

export type TrustGroup = 'money' | 'data' | 'security';
export type TrustClaim =
  | { id: string; group: TrustGroup; verdict: 'true'; key: string; mechanismKey: string; evidence: string }
  | { id: string; group: TrustGroup; verdict: 'refused'; refusal: string };

export const TRUST_CLAIMS: readonly TrustClaim[] = Object.freeze([
  // ── your money ──
  { id: 'escrow_ledger', group: 'money', verdict: 'true', key: 'sweep.trust.claim.escrow_ledger', mechanismKey: 'sweep.trust.how.escrow_ledger',
    evidence: 'payments: an online capture posts into the platform escrow account; the wallet refuses an unbalanced transaction (resolution-money.service.ts); recon-zero-sum.job.ts every 5 min' },
  { id: 'release_mechanical', group: 'money', verdict: 'true', key: 'sweep.trust.claim.release_mechanical', mechanismKey: 'sweep.trust.how.release_mechanical',
    evidence: '"I received it" (3a) or auto-complete-quality-window.job.ts → orders.order_completed → OrderSettlementService.settle (one key)' },
  { id: 'cod_nothing_held', group: 'money', verdict: 'true', key: 'sweep.trust.claim.cod_nothing_held', mechanismKey: 'sweep.trust.how.cod_nothing_held',
    evidence: '`online_payments` OFF (the seed): no Pay step; dispute-money-state.ts "COD … nothing in escrow to freeze"' },
  { id: 'regulated_partner', group: 'money', verdict: 'refused', refusal: 'regulated_partner' },
  { id: 'independent_audit', group: 'money', verdict: 'refused', refusal: 'independent_audit' },
  // ── your personal data ──
  { id: 'masked_phone', group: 'data', verdict: 'true', key: 'sweep.trust.claim.masked_phone', mechanismKey: 'sweep.trust.how.masked_phone',
    evidence: 'STORE-4a features/store4a/account.ts `maskedPhone` (five of ten digits hidden)' },
  { id: 'download_delete', group: 'data', verdict: 'true', key: 'sweep.trust.claim.download_delete', mechanismKey: 'sweep.trust.how.download_delete',
    evidence: 'STORE-4a /account/data and /account/delete under both chromes; invoices kept by law' },
  { id: 'proxied_calls', group: 'data', verdict: 'refused', refusal: 'proxied_calls' },
  { id: 'consent_documents', group: 'data', verdict: 'refused', refusal: 'consent_documents' },
  { id: 'sell_data', group: 'data', verdict: 'refused', refusal: 'sell_data' },
  // ── security practices ──
  { id: 'tenant_isolation', group: 'security', verdict: 'true', key: 'sweep.trust.claim.tenant_isolation', mechanismKey: 'sweep.trust.how.tenant_isolation',
    evidence: 'Postgres row-level security on every tenant table (verify-rls-coverage: 1,956 policies, tenants wall closed)' },
  { id: 'audit_append_only', group: 'security', verdict: 'true', key: 'sweep.trust.claim.audit_append_only', mechanismKey: 'sweep.trust.how.audit_append_only',
    evidence: '0181:84 REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM kv_app' },
  { id: 'hardware_key', group: 'security', verdict: 'true', key: 'sweep.trust.claim.hardware_key', mechanismKey: 'sweep.trust.how.hardware_key',
    evidence: 'admin-api admin-config.ts ADMIN_REQUIRE_HARDWARE_KEY defaults ON in production and is refused OFF there; hardware-key.guard.ts' },
  { id: 'encryption', group: 'security', verdict: 'refused', refusal: 'encryption' },
  { id: 'cert_audits', group: 'security', verdict: 'refused', refusal: 'cert_audits' },
  { id: 'disclosure_programme', group: 'security', verdict: 'refused', refusal: 'disclosure_programme' },
] as TrustClaim[]);

export const TRUST_GROUPS: readonly TrustGroup[] = Object.freeze(['money', 'data', 'security'] as TrustGroup[]);
export function claimsOf(group: TrustGroup): TrustClaim[] { return TRUST_CLAIMS.filter((c) => c.group === group); }
export function trueClaims(): Array<Extract<TrustClaim, { verdict: 'true' }>> {
  return TRUST_CLAIMS.filter((c): c is Extract<TrustClaim, { verdict: 'true' }> => c.verdict === 'true');
}
export function refusedClaims(): string[] {
  return TRUST_CLAIMS.flatMap((c) => (c.verdict === 'refused' ? [c.refusal] : []));
}
