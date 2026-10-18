// modules/partner-console/domain/partner-insurance.rules.ts · PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK — the PURE pieces (no I/O).
//
// Founder Q6 (2026-10-18): an insurer sees POLICY FACTS on ITS OWN PRODUCTS only — subject TYPE, sum insured, premium (the farmer's share as
// stored), valid from / until, status, created, the FPO's PUBLIC display name; NEVER `holder_user_id`, `subject_id`, `premium_payment_id`, a
// name, a phone, a land parcel, an animal tag, a vet or health record. 0228's definers never return those columns; the projections below are
// the second wall: they BUILD each output field by field from an allow-list, so an identity column that ever reached a row (a definer
// widened by mistake — mutant M4) still cannot reach a response. The console never returns the policy's `tenantId` either: the FPO is named
// by its public display name only (the 1a dashboard precedent), and the field is `fpoName` — never `name`, so a deep-key check can exclude
// every `name` property from the insurer's responses.
//
// Money: bigint minor-unit STRINGS (Law 2); rates: integer basis points; no float anywhere.
import { POLICY_STATUSES, type PolicyStatus } from '../../insurance/domain/insurance-policy.state';
import { parsePremiumCalc } from '../../insurance/domain/premium-calc';
import { sumMinor } from './partner-dashboard.rules';
import { pgDateOrNull } from '../../../core/database/pg-date';

export { sumMinor };

/** The statuses an insurer may filter its book by — the state machine's own list (insurance-policy.state.ts), never invented. */
export const PARTNER_POLICY_STATUSES: readonly PolicyStatus[] = POLICY_STATUSES;
export const isPartnerPolicyStatus = (v: unknown): v is PolicyStatus => typeof v === 'string' && (POLICY_STATUSES as readonly string[]).includes(v);

/** Founder Q5: a policy is IN FORCE when it is `active` (the farmer's payment was confirmed) — `proposed` is awaiting the farmer, never cover. */
export function inForce(status: string): boolean { return status === 'active'; }

/** Property names that never leave the partner realm's insurance read (the deep-key wall the live spec and the unit spec both assert). */
export const IDENTITY_FIELDS = Object.freeze([
  'holderUserId', 'holder_user_id', 'holder', 'subjectId', 'subject_id', 'premiumPaymentId', 'premium_payment_id', 'tenantId', 'tenant_id',
  'parametricTriggers', 'parametric_triggers', 'createdBy', 'created_by', 'updatedBy', 'updated_by', 'phone', 'name',
] as const);

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
/** A `date` column as the calendar day PostgreSQL holds (core/database/pg-date — never `String(date).slice`, the TENANT-6b-1 trap). */
const day = (v: unknown): string | null => pgDateOrNull(v);
const minor = (v: unknown): string => {
  const s = String(v ?? '0');
  return /^-?\d+$/.test(s) ? BigInt(s).toString() : '0';
};

export interface PartnerPolicyView {
  id: string;
  /** NULL on every activated policy today (no insurer issues on the platform — founder Q5); the console prints "no policy number yet". */
  policyNo: string | null;
  productId: string;
  productName: string | null;
  /** The FPO's PUBLIC display name (0204's `public_tenant_profile`), or null for a non-live organisation — never its id. */
  fpoName: string | null;
  subjectType: string;
  status: string;
  sumInsuredMinor: string;
  /** The FARMER's premium share as stored on the policy (the government's share is not stored — survey §1 money 3). */
  premiumMinor: string;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string | null;
}

/** One policy row (as the 0228 definer answers it, snake or camel) → the view. Field by field from the allow-list; nothing else passes. */
export function projectPolicy(row: Record<string, unknown>, names: { fpoName: string | null; productName: string | null }): PartnerPolicyView {
  return {
    id: String(row.id),
    policyNo: str(row.policy_no ?? row.policyNo),
    productId: String(row.product_id ?? row.productId),
    productName: names.productName,
    fpoName: names.fpoName,
    subjectType: String(row.subject_type ?? row.subjectType ?? ''),
    status: String(row.status ?? ''),
    sumInsuredMinor: minor(row.sum_insured_minor ?? row.sumInsuredMinor),
    premiumMinor: minor(row.premium_minor ?? row.premiumMinor),
    validFrom: day(row.valid_from ?? row.validFrom),
    validUntil: day(row.valid_until ?? row.validUntil),
    createdAt: str(row.created_us) ?? iso(row.created_at ?? row.createdAt),
  };
}

/** The insurer's own pricing terms, typed: the two shapes enrolment prices (integer bps / a flat minor amount), or `not_priceable` — the
 *  stored terms are still printed as data (W247 is read-only), but nothing claims a parametric product can be priced or paid (founder Q3). */
export type PartnerFormula = { kind: 'pct_of_sum_insured'; bps: number } | { kind: 'flat_minor'; amountMinor: string } | { kind: 'not_priceable' };
export function formulaOf(premiumCalc: unknown): PartnerFormula {
  try { return parsePremiumCalc(premiumCalc); } catch { return { kind: 'not_priceable' }; }
}

export interface PartnerProductView {
  id: string;
  productName: string;
  kind: { id: string | null; code: string | null };
  formula: PartnerFormula;
  /** The insurer's OWN stored terms, as stored (0090's pricing-IP rule: never another insurer's). */
  storedTerms: unknown;
  sumInsuredRules: unknown;
  /** Recorded on the product; nothing is charged against it today (founder Q4). */
  govtSubsidyBps: number;
  /** Recorded on the product; nothing is charged against it today (founder Q4). */
  ourCommissionBps: number;
  isParametric: boolean;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  /** Policies on this product by status (merged over the shards). */
  policies: Record<string, number>;
}

export function projectProduct(row: Record<string, unknown>, policies: Record<string, number> = {}): PartnerProductView {
  const int = (v: unknown) => { const n = Number(v ?? 0); return Number.isInteger(n) ? n : 0; };
  return {
    id: String(row.id),
    productName: String(row.name ?? row.productName ?? ''),
    kind: { id: str(row.kind_id ?? null), code: str(row.kind_code ?? null) },
    formula: formulaOf(row.premium_calc ?? row.premiumCalc),
    storedTerms: row.premium_calc ?? row.premiumCalc ?? null,
    sumInsuredRules: row.sum_insured_rules ?? row.sumInsuredRules ?? {},
    govtSubsidyBps: int(row.govt_subsidy_bps ?? row.govtSubsidyBps),
    ourCommissionBps: int(row.our_commission_bps ?? row.ourCommissionBps),
    isParametric: (row.is_parametric ?? row.isParametric) === true,
    active: (row.is_active ?? row.isActive) === true,
    createdAt: iso(row.created_at ?? row.createdAt),
    updatedAt: iso(row.updated_at ?? row.updatedAt),
    policies: { ...policies },
  };
}

/** One shard's `partner_insurance_counts()` row. */
export interface InsuranceCountsShard { policies: string; inForce: string; inForceSumInsuredMinor: string; proposed: string; fpos: string; perProduct: Record<string, Record<string, number | string>> }

export interface PartnerInsuranceDashboard {
  computedAt: string;
  policies: number;
  /** Policies in force (`active`) and Σ their sum insured — never a premium total called the insurer's (founder Q1). */
  inForce: { count: number; sumInsuredMinor: string };
  /** Proposed: awaiting the farmer's payment — not cover (founder Q5). */
  proposed: number;
  /** FPOs with at least one policy on this insurer's products (a tenant lives on one shard, so the shards' distinct counts add). */
  fpos: number;
  products: number;
}

/** Merge the shards' counts: counts and bigint sums add; per-product status counts add. */
export function mergeCounts(shards: readonly InsuranceCountsShard[]): { policies: number; inForce: { count: number; sumInsuredMinor: string }; proposed: number; fpos: number; perProduct: Record<string, Record<string, number>> } {
  const add = (xs: readonly string[]) => Number(xs.reduce((a, x) => a + BigInt(x || '0'), 0n));
  const perProduct: Record<string, Record<string, number>> = {};
  for (const s of shards) {
    for (const [pid, st] of Object.entries(s.perProduct ?? {})) {
      const into = (perProduct[pid] ??= {});
      for (const [k, n] of Object.entries(st)) into[k] = (into[k] ?? 0) + Number(n);
    }
  }
  return {
    policies: add(shards.map((s) => s.policies)),
    inForce: { count: add(shards.map((s) => s.inForce)), sumInsuredMinor: sumMinor(shards.map((s) => s.inForceSumInsuredMinor)) },
    proposed: add(shards.map((s) => s.proposed)),
    fpos: add(shards.map((s) => s.fpos)),
    perProduct,
  };
}
