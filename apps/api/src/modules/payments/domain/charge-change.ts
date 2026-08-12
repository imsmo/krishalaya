// modules/payments/domain/charge-change.ts · W150's charge table, as the rules a write path needs (PC-56 TENANT-3c-2).
// Pure, no I/O — unit- and mutation-tested, because these decide what every buyer on a tenant pays.
//
// **THE TABLE HAD NO WRITER AT ALL**: `ChargeDefinitionRepository` was two SELECTs, and W150's "Add charge" and
// "Propose change (checker)" sat over a table whose entire content was a three-row platform seed. This file is the
// half that was missing — what a proposal may say, when it may take effect, and what makes it safe to apply.

/**
 * THE METHODS THE CALCULATOR ACTUALLY IMPLEMENTS.
 *
 * `charge_definitions.calc_method`'s CHECK also allows `per_km`, and `computeCharge` ends with
 * `default: throw new UnsupportedChargeMethodError(method)` — its own header says per_km "needs a resolved delivery
 * distance — deferred". So a per_km row is a definition the SCHEMA invites and CHECKOUT CRASHES ON. The write path
 * refuses it by name; the schema keeps it, because the method is a real intention with a real blocker and deleting
 * it from the CHECK would erase the plan rather than gate it (0141 DEFECT 4).
 */
export const SUPPORTED_CALC_METHODS = ['flat', 'percent', 'slab', 'per_unit'] as const;
export type SupportedCalcMethod = (typeof SUPPORTED_CALC_METHODS)[number];
export function isSupportedCalcMethod(v: string | null | undefined): v is SupportedCalcMethod {
  return !!v && (SUPPORTED_CALC_METHODS as readonly string[]).includes(v);
}

export const CHARGE_ACTIONS = ['add', 'change', 'end'] as const;
export type ChargeAction = (typeof CHARGE_ACTIONS)[number];

/** Same floor as every other note in this programme (0112, 0114, 0139, 0140): the person on the other side reads it. */
export const MIN_NOTE_CHARS = 20;
/** A percent charge above this reads as a typo rather than a fee — 30%. Refused with the figure in the message
 *  rather than silently clamped, because clamping a tenant's intent is its own kind of lie. */
export const MAX_PERCENT_BPS = 3_000;
/** A flat/slab fee above ₹1,00,000 on a marketplace order is the same class of typo (an extra zero). */
export const MAX_FLAT_MINOR = 10_000_000n;

export type ConfigVerdict =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string; detail?: Record<string, unknown> };

const int = (v: unknown): bigint | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d{1,18}$/.test(v)) return BigInt(v);
  return null;
};

/**
 * Validate a proposed config against the method that will read it — **the check that stops a fee nobody can compute
 * from reaching the resolver.** `computeCharge` is forgiving by design (a missing `fee_minor` reads as 0, an unknown
 * slab shape produces no charge), which is right at CHECKOUT time (no surprise fees) and wrong at WRITE time: a
 * malformed row would sit in the table quietly charging nothing while a tenant believed they had set a price.
 */
export function validateChargeConfig(method: string, raw: unknown): ConfigVerdict {
  if (!isSupportedCalcMethod(method)) {
    return { ok: false, error: 'CHARGE_METHOD_UNSUPPORTED', detail: { method, supported: [...SUPPORTED_CALC_METHODS] } };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'CHARGE_CONFIG_INVALID' };
  const c = raw as Record<string, unknown>;

  if (method === 'flat' || method === 'per_unit') {
    const fee = int(c.fee_minor);
    if (fee === null) return { ok: false, error: 'CHARGE_CONFIG_FEE_REQUIRED' };
    if (fee > MAX_FLAT_MINOR) return { ok: false, error: 'CHARGE_CONFIG_FEE_TOO_LARGE', detail: { maxMinor: MAX_FLAT_MINOR.toString() } };
    return { ok: true, config: { fee_minor: Number(fee) } };
  }

  if (method === 'percent') {
    const bps = typeof c.bps === 'number' && Number.isInteger(c.bps) && c.bps >= 0 ? c.bps : null;
    if (bps === null) return { ok: false, error: 'CHARGE_CONFIG_BPS_REQUIRED' };
    if (bps > MAX_PERCENT_BPS) return { ok: false, error: 'CHARGE_CONFIG_BPS_TOO_LARGE', detail: { maxBps: MAX_PERCENT_BPS } };
    const min = c.min_minor === undefined || c.min_minor === null ? null : int(c.min_minor);
    const max = c.max_minor === undefined || c.max_minor === null ? null : int(c.max_minor);
    if (c.min_minor != null && min === null) return { ok: false, error: 'CHARGE_CONFIG_MIN_INVALID' };
    if (c.max_minor != null && max === null) return { ok: false, error: 'CHARGE_CONFIG_MAX_INVALID' };
    // A floor above the ceiling makes the clamp order decide the fee — the calculator applies min then max, so the
    // max would win and the tenant's floor would silently not exist.
    if (min !== null && max !== null && min > max) return { ok: false, error: 'CHARGE_CONFIG_MIN_ABOVE_MAX' };
    const out: Record<string, unknown> = { bps };
    if (min !== null) out.min_minor = Number(min);
    if (max !== null) out.max_minor = Number(max);
    return { ok: true, config: out };
  }

  // slab: an ordered list, first match wins in the calculator — so the ORDER matters and an unsorted list is a
  // different price table than the one the tenant thinks they wrote.
  const slabs = Array.isArray(c.slabs) ? (c.slabs as Array<Record<string, unknown>>) : null;
  if (!slabs || slabs.length === 0) return { ok: false, error: 'CHARGE_CONFIG_SLABS_REQUIRED' };
  if (slabs.length > 20) return { ok: false, error: 'CHARGE_CONFIG_SLABS_TOO_MANY', detail: { max: 20 } };
  const clean: Array<{ upto_minor: number | null; fee_minor: number }> = [];
  let lastUpto: bigint | null = null;
  let sawCatchAll = false;
  for (const s of slabs) {
    if (sawCatchAll) return { ok: false, error: 'CHARGE_CONFIG_SLAB_AFTER_CATCHALL' };   // unreachable slab
    const fee = int(s.fee_minor);
    if (fee === null) return { ok: false, error: 'CHARGE_CONFIG_FEE_REQUIRED' };
    if (fee > MAX_FLAT_MINOR) return { ok: false, error: 'CHARGE_CONFIG_FEE_TOO_LARGE', detail: { maxMinor: MAX_FLAT_MINOR.toString() } };
    if (s.upto_minor === null || s.upto_minor === undefined) { sawCatchAll = true; clean.push({ upto_minor: null, fee_minor: Number(fee) }); continue; }
    const upto = int(s.upto_minor);
    if (upto === null) return { ok: false, error: 'CHARGE_CONFIG_SLAB_UPTO_INVALID' };
    // ASCENDING, strictly: the calculator returns the first slab whose ceiling the base fits under, so a lower
    // ceiling appearing after a higher one is a band that can never be reached.
    if (lastUpto !== null && upto <= lastUpto) return { ok: false, error: 'CHARGE_CONFIG_SLABS_NOT_ASCENDING' };
    lastUpto = upto;
    clean.push({ upto_minor: Number(upto), fee_minor: Number(fee) });
  }
  return { ok: true, config: { slabs: clean } };
}

/** W150's "Applies to" column. A REGISTRY IN CODE, not a column: the surface a code prices is a fact about which
 *  call site resolves it, and a data column naming it would drift the moment a code was read somewhere new. A code
 *  with no known reader reads as `not_read_by_any_code` — the promise-with-no-reader check, applied to pricing. */
export const CHARGE_CODE_SURFACES: Record<string, string> = {
  delivery_fee: 'checkout',
  buyer_platform_fee: 'checkout',
  emd: 'auctions',
  boost_local: 'listings',
  boost_regional: 'listings',
  boost_statewide: 'listings',
};
export function surfaceOf(code: string): string {
  return CHARGE_CODE_SURFACES[code] ?? 'not_read_by_any_code';
}

/** When may a change take effect? **NOT TODAY AND NOT IN THE PAST.** An order priced this morning under one rule and
 *  this afternoon under another cannot be explained to the buyer who paid the first price — and a backdated row would
 *  change what an already-issued invoice claims its basis was (TENANT-3a froze the snapshot for exactly this reason).
 *  So the earliest a proposal may take effect is TOMORROW, and it must start after the row it supersedes began. */
export type EffectiveVerdict =
  | { ok: true }
  | { ok: false; error: 'CHARGE_EFFECTIVE_NOT_FUTURE' | 'CHARGE_EFFECTIVE_BEFORE_CURRENT' | 'CHARGE_EFFECTIVE_INVALID' };

export function effectiveFromGate(effectiveFrom: string, today: string, currentFrom: string | null): EffectiveVerdict {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) return { ok: false, error: 'CHARGE_EFFECTIVE_INVALID' };
  if (effectiveFrom <= today) return { ok: false, error: 'CHARGE_EFFECTIVE_NOT_FUTURE' };
  if (currentFrom && effectiveFrom <= currentFrom) return { ok: false, error: 'CHARGE_EFFECTIVE_BEFORE_CURRENT' };
  return { ok: true };
}

/** The day the superseded row must be end-dated on: the day BEFORE the new one starts, so the two windows touch
 *  without overlapping (0141's EXCLUDE constraint would refuse an overlap, and this is why it never sees one). */
export function endDateFor(effectiveFrom: string): string {
  const d = new Date(`${effectiveFrom}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export type ProposalGate =
  | { kind: 'ready'; proposalId: string }
  | { kind: 'awaiting_checker'; proposalId: string }
  | { kind: 'rejected_by_checker'; proposalId: string }
  | { kind: 'already_applied'; proposalId: string }
  | { kind: 'none' };

/** What stands between a proposal and the price changing. Same vocabulary as 0139's refund gate on purpose: an
 *  operator who has learned one maker-checker screen has learned all three. */
export function proposalGate(p: { id: string; status: ProposalStatus; decidedBy: string | null; proposedBy: string } | null): ProposalGate {
  if (!p) return { kind: 'none' };
  if (p.status === 'applied') return { kind: 'already_applied', proposalId: p.id };
  if (p.status === 'rejected') return { kind: 'rejected_by_checker', proposalId: p.id };
  if (p.status === 'pending') return { kind: 'awaiting_checker', proposalId: p.id };
  // Belt over 0141's CHECK: a row whose checker equals its proposer cannot exist, and if one ever did it must not be
  // the thing that changes a price.
  if (p.decidedBy && p.decidedBy === p.proposedBy) return { kind: 'awaiting_checker', proposalId: p.id };
  return { kind: 'ready', proposalId: p.id };
}

/** A human-readable diff for W2525's review step and for the audit row — the checker is signing for a CHANGE, and a
 *  screen that showed only the new value would make them verify it against their memory. */
export function diffSummary(
  current: { calcMethod: string; config: Record<string, unknown> } | null,
  proposed: { calcMethod: string; config: Record<string, unknown> } | null,
): Array<{ field: string; from: string | null; to: string | null }> {
  const out: Array<{ field: string; from: string | null; to: string | null }> = [];
  const fromMethod = current?.calcMethod ?? null;
  const toMethod = proposed?.calcMethod ?? null;
  if (fromMethod !== toMethod) out.push({ field: 'calcMethod', from: fromMethod, to: toMethod });
  const keys = [...new Set([...Object.keys(current?.config ?? {}), ...Object.keys(proposed?.config ?? {})])].sort();
  for (const k of keys) {
    const a = current?.config?.[k];
    const b = proposed?.config?.[k];
    const as = a === undefined ? null : JSON.stringify(a);
    const bs = b === undefined ? null : JSON.stringify(b);
    if (as !== bs) out.push({ field: k, from: as, to: bs });
  }
  return out;
}

/** Which recorded tax rules does any code path actually READ? A registry, for the same reason as the charge surfaces:
 *  this is a fact about call sites. W150's table is read-only, and the honest thing to print beside a statutory rate
 *  is whether this platform applies it — `tds_194q` is listed by the canon and is NOT recorded and NOT computed here,
 *  because it is the BUYER's own deduction (TENANT-3a corrected W134 on the same section). */
export const TAX_CODE_READERS: Record<string, string> = {
  gst: 'invoice_goods_line',
  gst_service: 'invoice_fee_line',
  tds_194o: 'settlement',
};
export function readerOf(taxCode: string): string {
  return TAX_CODE_READERS[taxCode] ?? 'not_read_by_any_code';
}
