// apps/admin-api/src/modules/schemes-oversight/domain/dbt-safety.ts · the forbidden-column law for the DBT monitor
// (W076). Pure, no I/O.
//
// W076 states the rule in five words: "bank fields never shown here at all." Not masked, not permission-gated —
// ABSENT. And the rule has something to bite on: `dbt_bounces.bank_ref` (0083) exists, holds a return UTR, and is
// selected by the tenant-side read via `SELECT *`.
//
// SO WHY A RUNTIME CHECK RATHER THAN "JUST DON'T SELECT IT"?
// Because "just don't select it" is a fact about today's SQL, and the failure mode is silent. The realistic sequence
// is: somebody adds a column to `dbt_bounces`, somebody else writes `SELECT *` in a hurry because the tenant-side
// repository does exactly that two files away, and a bank reference reaches a screen the canon forbids it from. No
// test fails, because no test asserts the absence of a field nobody thought about. `assertNoBankFields` turns that
// into a loud 500 on the first request in development instead of a quiet disclosure in production.
//
// This is the same reasoning as `Golden Law 9`'s named forbidden set for attributes and the export planes' explicit
// column lists: where the rule is "this must never appear", the enforcement has to be a check on the way OUT, not a
// convention on the way in.

/** Field names that must never appear in anything this plane returns. Matched case-insensitively and on both the
 *  snake_case column and the camelCase mapped key, because a row can arrive in either shape depending on whether it
 *  came through a mapper. */
export const FORBIDDEN_DBT_FIELDS = [
  'bank_ref', 'bankRef',
  // Not currently columns anywhere — listed because they are the fields somebody WILL add next, and a law that only
  // covers the violation you have already had is a law one migration behind.
  'account_number', 'accountNumber', 'bank_account', 'bankAccount',
  'ifsc', 'ifsc_code', 'ifscCode', 'iban',
  'aadhaar', 'aadhaar_number', 'aadhaarNumber', 'aadhaar_vault_ref', 'aadhaarVaultRef',
  'upi_id', 'upiId', 'vpa',
] as const;

const FORBIDDEN_LOWER = new Set(FORBIDDEN_DBT_FIELDS.map((f) => f.toLowerCase()));

export class BankFieldLeakError extends Error {
  constructor(public readonly field: string, public readonly where: string) {
    super(
      `'${field}' must never appear on the DBT oversight surface (${where}). W076: bank fields are not shown here at `
      + 'all — not masked, not permission-gated, absent. If this field is genuinely needed, it needs a different '
      + 'surface with its own permission and its own audit, not a column on this one.',
    );
    this.name = 'BankFieldLeakError';
  }
}

/** Throw if any row carries a forbidden field. Walks nested objects and arrays, because a bank reference nested one
 *  level down inside a `payload` blob is exactly as disclosed as one at the top. */
export function assertNoBankFields(rows: unknown, where: string): void {
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;                  // a cyclic row would otherwise hang the request
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_LOWER.has(k.toLowerCase())) throw new BankFieldLeakError(k, where);
      walk(val);
    }
  };
  walk(rows);
}

/** Explicit column list for the DBT exports. Not `SELECT *`, and every entry justified by being something an operator
 *  chases: the credit, the scheme, the PFMS reference, the notification state. `pfms_ref` IS included and is NOT a
 *  bank field — it is the government's own transaction handle, the string you quote to PFMS to ask what happened, and
 *  it identifies a disbursement rather than an account. */
export const DBT_EXPORT_COLUMNS: Array<[string, string]> = [
  ['scheme_code', 'scheme_code'],
  ['credited_on', 'credited_on'],
  ['instalment_no', 'instalment_no'],
  ['amount_minor_units', 'amount_minor'],
  ['pfms_ref', 'pfms_ref'],
  ['application_ref', 'govt_app_ref'],
  ['tenant', 'tenant_name'],
  // MASKED in the export exactly as on screen. An export is the likeliest artefact to outlive the permission that
  // produced it, so it gets the stricter treatment, not the looser one.
  ['farmer_masked', 'farmer_masked'],
];

/** The bounce report. `resolution` and `reason_code` are the actionable fields; `bank_ref` is absent and the absence is
 *  asserted by a spec, not just left out here. */
export const DBT_BOUNCE_EXPORT_COLUMNS: Array<[string, string]> = [
  ['scheme_code', 'scheme_code'],
  ['bounced_on', 'bounced_on'],
  ['reason_code', 'reason_code'],
  ['amount_minor_units', 'amount_minor'],
  ['resolution', 'resolution'],
  ['resolved_at', 'resolved_at'],
  ['farmer_masked', 'farmer_masked'],
];

/* ------------------------------------------------------------------------------------------------------------ */
/* THE DOCTRINE THIS SURFACE EXISTS UNDER                                                                       */
/* ------------------------------------------------------------------------------------------------------------ */
/** W076's lead line: "We OBSERVE and notify; the money moves government → farmer bank directly, never through our
 *  ledger."
 *
 *  Written down as a constant because it is a constraint on future code and not a caption. Nothing in this module may
 *  post a wallet entry, and a DBT credit is not revenue, not GMV, and not a platform transaction: it is an
 *  OBSERVATION of a government payment we had no part in moving. The one thing that could go badly wrong here is
 *  somebody reconciling these amounts against the wallet and finding, correctly, that they do not balance — and then
 *  "fixing" it by writing a ledger entry.
 */
export const DBT_IS_OBSERVED_NOT_MOVED = {
  writesLedger: false as const,
  reason: 'government → farmer bank directly; the platform observes the credit and never holds or moves the money',
} as const;

/** W076's "Celebration SMS sent 14,020 · on credit observation" tile, named as unbuildable and WHY.
 *
 *  Three separate things are missing and they fail differently, which is why this is a structured value rather than a
 *  boolean:
 *    • NO NOTIFY PATH. `DbtTransferService.record` writes an outbox event and an audit row and calls no notification
 *      service. Nothing has ever told a farmer their money arrived.
 *    • NOWHERE TO COUNT IT. `dbt_transfers` is append-only and partitioned, and kv_app holds INSERT only (0078), so
 *      there is no column to stamp and a per-transfer notification record would need a side table on the
 *      `dbt_bounces` pattern.
 *    • NO DELIVERY. SMS needs DLT registration the platform does not have; there is no voice/IVR provider at all.
 *  Rendering `0` would say we tried 14,204 times and failed. Rendering nothing would say we chose not to show it.
 *  Neither is true, so the tile says it is not built.
 */
export const CELEBRATION_NOTIFY_GAP = {
  available: false as const,
  reason: 'not_built' as const,
  missing: ['notify_on_credit_path', 'notification_record_table', 'dlt_registration', 'voice_provider'] as const,
};
