// apps/web-partner/src/features/insurance/authoring.ts · PURE insurer-authoring rules (PC-55 B7, on W54-9).
// Framework-free mirrors of modules/insurance/services/authoring.service.ts.
//
// THE PREMIUM FORMULA IS THE PRODUCT. `premium_calc` is what the enrolment path later EXECUTES to price a farmer's
// cover, so a malformed or ambiguous formula is not a validation nuisance — it is a mispriced policy, discovered
// when somebody claims. The server accepts exactly three shapes and refuses everything else:
//     { pct_of_sum_insured: <number > 0> }   |   { flat_minor: "<digits>" }   |   { parametric: { … } }
// This builder produces ONE of those three and never a hybrid: a form that sent both a percentage and a flat amount
// would leave the executing side to pick, and "whichever the code happens to read first" is not a pricing policy.
//
// AND: NO PREMIUM, NO COVER. Issuance is refused server-side until a premium payment is linked, and only from
// 'proposed'. The console reflects both, so an insurer never types a policy number into a form that cannot succeed —
// and, more importantly, so nobody believes cover exists before it was paid for.

export const CALC_MODES = ['pct_of_sum_insured', 'flat_minor', 'parametric'] as const;
export type CalcMode = (typeof CALC_MODES)[number];
export function isCalcMode(v: string | undefined | null): v is CalcMode {
  return !!v && (CALC_MODES as readonly string[]).includes(v);
}

export type CalcError = 'mode' | 'pct' | 'flat' | 'parametric' | 'parametricJson';
export type CalcResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: CalcError };

/** Build `premium_calc` — exactly one shape, validated the way the server validates it.
 *  • pct_of_sum_insured must be > 0 (a zero-percent premium is free cover, which is not a product);
 *  • flat_minor is a bigint minor-unit STRING (Law 2), digits only;
 *  • parametric is a non-empty object of trigger terms, entered as JSON because the terms are the insurer's own
 *    vocabulary and inventing a form for them here would constrain products we have not seen. Malformed JSON is
 *    refused with its own error, so an insurer is told the difference between "I typed bad JSON" and "that shape is
 *    not allowed". */
export function buildPremiumCalc(raw: { mode: string; pct: string; flatMajor: string; parametricJson: string }, toMinor: (major: string) => string | undefined): CalcResult {
  if (!isCalcMode(raw.mode)) return { ok: false, error: 'mode' };

  if (raw.mode === 'pct_of_sum_insured') {
    const t = raw.pct.trim();
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(t)) return { ok: false, error: 'pct' };
    const pct = Number.parseFloat(t);
    if (!(pct > 0) || pct > 100) return { ok: false, error: 'pct' };
    return { ok: true, value: { pct_of_sum_insured: pct } };
  }

  if (raw.mode === 'flat_minor') {
    const flat = toMinor(raw.flatMajor.trim());
    if (!flat || flat === '0' || !/^\d{1,15}$/.test(flat)) return { ok: false, error: 'flat' };
    return { ok: true, value: { flat_minor: flat } };
  }

  const text = raw.parametricJson.trim();
  if (!text) return { ok: false, error: 'parametric' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'parametricJson' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed as object).length === 0) {
    return { ok: false, error: 'parametric' };
  }
  return { ok: true, value: { parametric: parsed as Record<string, unknown> } };
}

export interface ProductInput {
  partnerId: string; productKindId: string; defaultName: string; premiumCalc: Record<string, unknown>;
  sumInsuredRules?: Record<string, unknown>; govtSubsidyBps?: number; ourCommissionBps?: number; isParametric?: boolean;
}
export type ProductError = CalcError | 'partner' | 'kind' | 'name' | 'subsidy' | 'commission' | 'sumInsuredJson';
export type ProductResult = { ok: true; value: ProductInput } | { ok: false; error: ProductError };

const UUID = /^[0-9a-fA-F-]{36}$/;

/** Build the product. `isParametric` is DERIVED from the chosen calc mode rather than being a separate switch: a
 *  product whose formula is parametric but whose flag says otherwise (or the reverse) is a contradiction the
 *  enrolment path would have to resolve, and it should never be expressible in the first place. */
export function buildProduct(raw: {
  partnerId: string; productKindId: string; defaultName: string;
  mode: string; pct: string; flatMajor: string; parametricJson: string;
  sumInsuredJson: string; govtSubsidyBps: string; ourCommissionBps: string;
}, toMinor: (major: string) => string | undefined): ProductResult {
  const partnerId = raw.partnerId.trim();
  if (!UUID.test(partnerId)) return { ok: false, error: 'partner' };
  const productKindId = raw.productKindId.trim();
  if (!UUID.test(productKindId)) return { ok: false, error: 'kind' };
  const defaultName = raw.defaultName.trim();
  if (defaultName.length < 3 || defaultName.length > 200) return { ok: false, error: 'name' };

  const calc = buildPremiumCalc(raw, toMinor);
  if (!calc.ok) return { ok: false, error: calc.error };

  const value: ProductInput = {
    partnerId, productKindId, defaultName, premiumCalc: calc.value,
    isParametric: raw.mode === 'parametric',
  };

  const subsidy = bps(raw.govtSubsidyBps);
  if (subsidy === 'bad') return { ok: false, error: 'subsidy' };
  if (subsidy !== null) value.govtSubsidyBps = subsidy;

  const commission = bps(raw.ourCommissionBps);
  if (commission === 'bad') return { ok: false, error: 'commission' };
  if (commission !== null) value.ourCommissionBps = commission;

  const sir = raw.sumInsuredJson.trim();
  if (sir) {
    let parsed: unknown;
    try { parsed = JSON.parse(sir); } catch { return { ok: false, error: 'sumInsuredJson' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'sumInsuredJson' };
    value.sumInsuredRules = parsed as Record<string, unknown>;
  }
  return { ok: true, value };
}

/** Basis points, 0..10000. Returns null when the field was left blank (the API applies its own default) and 'bad'
 *  when it was filled with something that is not a whole number in range — a silently-clamped commission would move
 *  real money. */
function bps(s: string): number | null | 'bad' {
  const t = s.trim();
  if (!t) return null;
  if (!/^\d{1,5}$/.test(t)) return 'bad';
  const n = Number.parseInt(t, 10);
  return n >= 0 && n <= 10000 ? n : 'bad';
}

/** Describe a stored premium_calc in words, for the product list. An unrecognised shape says so rather than being
 *  rendered as blank — a product whose formula this console cannot read is exactly what an insurer needs to notice. */
export function describeCalc(calc: Record<string, unknown> | null | undefined): { mode: CalcMode | 'unknown'; pct?: number; flatMinor?: string } {
  if (!calc || typeof calc !== 'object') return { mode: 'unknown' };
  if (typeof calc.pct_of_sum_insured === 'number' && calc.pct_of_sum_insured > 0) return { mode: 'pct_of_sum_insured', pct: calc.pct_of_sum_insured };
  if (typeof calc.flat_minor === 'string' && /^\d{1,15}$/.test(calc.flat_minor)) return { mode: 'flat_minor', flatMinor: calc.flat_minor };
  if (calc.parametric && typeof calc.parametric === 'object') return { mode: 'parametric' };
  return { mode: 'unknown' };
}

// ---------------------------------------------------------------------------
// Issuance — no premium, no cover
// ---------------------------------------------------------------------------
export interface PolicyRow { id?: string; status?: string | null; premiumPaymentId?: string | null; policyNo?: string | null }

/** Issuance is offered only for a PROPOSED policy whose premium has actually been paid. Both are server guards; the
 *  console mirrors them so nobody types a policy number into a form that cannot succeed — and so no colleague
 *  believes cover is live before the money arrived. */
export function canIssue(p: PolicyRow): boolean {
  return p.status === 'proposed' && !!p.premiumPaymentId;
}
/** Why issuance is unavailable, so the page can say it in words instead of hiding a button silently. */
export function issueBlockedReason(p: PolicyRow): 'none' | 'not_proposed' | 'no_premium' {
  if (p.status !== 'proposed') return 'not_proposed';
  if (!p.premiumPaymentId) return 'no_premium';
  return 'none';
}

export type IssueResult = { ok: true; value: { policyNo: string; parametricTriggers?: Record<string, unknown> } } | { ok: false; error: 'policyNo' | 'triggersJson' };

/** A policy number is the insurer's own reference on the document a farmer keeps; 3..80 chars, trimmed. */
export function buildIssue(raw: { policyNo: string; triggersJson: string }): IssueResult {
  const policyNo = raw.policyNo.trim();
  if (policyNo.length < 3 || policyNo.length > 80) return { ok: false, error: 'policyNo' };
  const value: { policyNo: string; parametricTriggers?: Record<string, unknown> } = { policyNo };
  const t = raw.triggersJson.trim();
  if (t) {
    let parsed: unknown;
    try { parsed = JSON.parse(t); } catch { return { ok: false, error: 'triggersJson' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'triggersJson' };
    value.parametricTriggers = parsed as Record<string, unknown>;
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Loss-ratio insights
// ---------------------------------------------------------------------------
export interface InsightRow { status?: string | null; n?: number | null; premium?: string | null; approved?: string | null }

/** Loss ratio = approved claims ÷ written premium, in BASIS POINTS so it stays integer arithmetic on minor-unit
 *  strings (Law 2 — never a float on money). Returns null when there is no premium yet: a ratio with a zero
 *  denominator is not "0%" or "infinite", it is UNKNOWN, and an insurer reading a fabricated 0% would draw exactly
 *  the wrong conclusion about a young book. */
export function lossRatioBps(policies: readonly InsightRow[], claims: readonly InsightRow[]): number | null {
  const premium = sumMinor(policies.map((p) => p.premium));
  if (premium === 0n) return null;
  const approved = sumMinor(claims.map((c) => c.approved));
  return Number((approved * 10000n) / premium);
}

export function sumMinor(values: ReadonlyArray<string | null | undefined>): bigint {
  let total = 0n;
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (/^-?\d{1,20}$/.test(s)) total += BigInt(s);
  }
  return total;
}

/** Count rows by status into a plain map, without inventing statuses the API did not return. */
export function countByStatus(rows: readonly InsightRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r.status ?? '').trim();
    if (!k) continue;
    out[k] = (out[k] ?? 0) + (Number.isFinite(Number(r.n)) ? Number(r.n) : 0);
  }
  return out;
}
