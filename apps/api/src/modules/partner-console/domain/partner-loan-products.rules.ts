// modules/partner-console/domain/partner-loan-products.rules.ts · PC-56 PARTNER-2c · THE LENDER'S SHELF — the PURE pieces (no I/O).
//
// Founder Q7 (2026-10-18): loan products are authored by the PLATFORM (seed / the admin realm after a signed agreement); the console READS its
// own shelf. 0229's `partner_loan_product_terms()` answers THIS partner's rows only and never `created_by` / `updated_by` (a person); the
// projection below is the second wall: it BUILDS each output field by field from an allow-list, so a person field that ever reached a row (a
// definer widened by mistake — mutant M3) still cannot reach a response.
//   • the APR and the subvention are the lender's OWN stored integers in basis points; the net is their raw INTEGER difference
//     (`interest_apr_bps − subvention_bps`) — the page says "net of subsidy"; never a float percentage anywhere;
//   • amounts are bigint minor-unit STRINGS with the product's own `currency_code` (Law 2);
//   • the kind is the platform registry's code, or null ("kind not registered" — 0229 resolves a `loan_kind` platform value only);
//   • the required documents: the count of stored ids and the codes of those that resolve to a platform `doc_type` value;
//   • the origination fee is DATA ("recorded on the product … the platform's fee leg is not live; nothing is charged today" —
//     fintech.module.ts:17 lists the origination-fee revenue leg as deferred);
//   • `applications30d` is a COUNT of this lender's CONSENTED applications on the product created in the last 30 days (0225's axis) — never
//     an applicant, never a member count.
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const minor = (v: unknown): string => {
  const s = String(v ?? '0');
  return /^-?\d+$/.test(s) ? BigInt(s).toString() : '0';
};
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? ''));
  return Number.isInteger(n) ? n : 0;
};
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : int(v));

/** Property names that never leave the shelf read (the person who wrote the row; an applicant; a member). */
export const LOAN_PRODUCT_PERSON_FIELDS = Object.freeze([
  'createdBy', 'created_by', 'updatedBy', 'updated_by', 'applicantUserId', 'applicant_user_id', 'holder', 'name', 'phone', 'partnerId', 'partner_id',
] as const);

/** The window of the per-product applications count, as the SQL computes it (documented once for the report and the spec). */
export const SHELF_WINDOW_DAYS = 30;

/** The integer net of the lender's own stored APR and subvention, in basis points — the raw difference (may be ≤ 0 if the data says so). */
export function netAprBps(interestAprBps: number, subventionBps: number): number {
  return int(interestAprBps) - int(subventionBps);
}

export interface PartnerLoanProductView {
  id: string;
  /** The product's own name (`loan_products.default_name`) — the field is `defaultName`, never `name`. */
  defaultName: string;
  kind: { id: string | null; code: string | null };
  currencyCode: string;
  minAmountMinor: string;
  maxAmountMinor: string;
  interestAprBps: number;
  subventionBps: number;
  /** interestAprBps − subventionBps, an integer (the page prints it as "net of subsidy"). */
  netAprBps: number;
  tenureMonthsMin: number | null;
  tenureMonthsMax: number | null;
  ltvBps: number | null;
  collateralKind: string | null;
  /** Recorded on the product; the platform's fee leg is not live — nothing is charged today. */
  originationFeeMinor: string;
  originationFeeBps: number;
  /** The lender's own stored rules, as stored (nothing is evaluated here). */
  eligibilityRules: unknown;
  requiredDocuments: { count: number; codes: string[] };
  repaymentStyle: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  /** This lender's CONSENTED applications on the product created in the last 30 days (a count). */
  applications30d: number;
}

/** One 0229 row (snake or camel) + its 30-day count → the view. Field by field from the allow-list; nothing else passes. */
export function projectLoanProduct(row: Record<string, unknown>, applications30d: number): PartnerLoanProductView {
  const apr = int(row.interest_apr_bps ?? row.interestAprBps);
  const sub = int(row.subvention_bps ?? row.subventionBps);
  const ids = row.required_doc_type_ids ?? row.requiredDocTypeIds;
  const codes = row.required_doc_codes ?? row.requiredDocCodes;
  return {
    id: String(row.id),
    defaultName: String(row.default_name ?? row.defaultName ?? ''),
    kind: { id: str(row.product_kind_id ?? row.productKindId), code: str(row.kind_code ?? row.kindCode) },
    currencyCode: String(row.currency_code ?? row.currencyCode ?? 'INR').trim(),
    minAmountMinor: minor(row.min_amount_minor ?? row.minAmountMinor),
    maxAmountMinor: minor(row.max_amount_minor ?? row.maxAmountMinor),
    interestAprBps: apr,
    subventionBps: sub,
    netAprBps: netAprBps(apr, sub),
    tenureMonthsMin: intOrNull(row.tenure_months_min ?? row.tenureMonthsMin),
    tenureMonthsMax: intOrNull(row.tenure_months_max ?? row.tenureMonthsMax),
    ltvBps: intOrNull(row.ltv_bps ?? row.ltvBps),
    collateralKind: str(row.collateral_kind ?? row.collateralKind),
    originationFeeMinor: minor(row.origination_fee_minor ?? row.originationFeeMinor),
    originationFeeBps: int(row.origination_fee_bps ?? row.originationFeeBps),
    eligibilityRules: row.eligibility_rules ?? row.eligibilityRules ?? {},
    requiredDocuments: {
      count: Array.isArray(ids) ? ids.length : 0,
      codes: Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [],
    },
    repaymentStyle: String(row.repayment_style ?? row.repaymentStyle ?? ''),
    active: (row.is_active ?? row.isActive) === true,
    createdAt: iso(row.created_at ?? row.createdAt),
    updatedAt: iso(row.updated_at ?? row.updatedAt),
    applications30d: Number.isInteger(applications30d) && applications30d >= 0 ? applications30d : 0,
  };
}

/** The shards' per-product counts added (each shard answers { productId: n }). */
export function mergeShelfCounts(shards: ReadonlyArray<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of shards) for (const [k, n] of Object.entries(s)) out[k] = (out[k] ?? 0) + (Number.isInteger(n) ? n : 0);
  return out;
}
