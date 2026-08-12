// apps/web-tenant/src/features/charges/console.ts · W150's charge table and tax table, as PURE rules
// (PC-56 TENANT-3c-2). No React, no I/O — unit- and mutation-tested; the API re-enforces every one.

/** The methods the pricing engine implements. `per_km` is a valid value in the column's CHECK and the calculator
 *  THROWS on it, so the console never offers it — a fee a tenant configures must be one checkout can compute. */
export const OFFERED_CALC_METHODS = ['flat', 'percent', 'slab', 'per_unit'] as const;
export type OfferedCalcMethod = (typeof OFFERED_CALC_METHODS)[number];
export function isOfferedCalcMethod(v: string | null | undefined): v is OfferedCalcMethod {
  return !!v && (OFFERED_CALC_METHODS as readonly string[]).includes(v);
}

export const CHARGE_ACTIONS = ['add', 'change', 'end'] as const;
export type ChargeActionKey = (typeof CHARGE_ACTIONS)[number];

/** The earliest date a change may take effect: TOMORROW. Two prices in one day cannot be explained to the buyer who
 *  paid the first, and a backdated row would restate the basis an already-issued invoice froze. */
export function earliestEffectiveFrom(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d.toISOString().slice(0, 10);
}
export function isAllowedEffectiveFrom(date: string, now: Date): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= earliestEffectiveFrom(now);
}

/** What a row IS, in one word, for W150's Status column. `platform_default` is not a lesser row — it is the fee in
 *  force until the tenant overrides it, and calling it "inactive" would read as nothing being charged. */
export type RowState = 'in_force' | 'scheduled' | 'ended' | 'platform_default' | 'superseded';

export function rowState(row: { isTenantOverride: boolean; inForce: boolean; effectiveFrom: string; effectiveTo: string | null; isActive: boolean }, today: string): RowState {
  if (!row.isTenantOverride) return row.inForce ? 'platform_default' : 'superseded';
  if (row.effectiveFrom > today) return 'scheduled';
  if (row.effectiveTo && row.effectiveTo < today) return 'ended';
  return row.inForce ? 'in_force' : 'superseded';
}

/** W150's Amount column, from the config the engine reads — rendered from the SAME shape rather than a stored string,
 *  so a row cannot display one price and charge another. Returns a key + values for i18n. */
export type AmountView =
  | { kind: 'flat'; feeMinor: string }
  | { kind: 'percent'; bps: number; minMinor: string | null; maxMinor: string | null }
  | { kind: 'slab'; bands: Array<{ uptoMinor: string | null; feeMinor: string }> }
  | { kind: 'per_unit'; feeMinor: string }
  | { kind: 'unknown' };

export function amountView(calcMethod: string, config: Record<string, unknown>): AmountView {
  const n = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  if (calcMethod === 'flat') return { kind: 'flat', feeMinor: n(config.fee_minor) ?? '0' };
  if (calcMethod === 'per_unit') return { kind: 'per_unit', feeMinor: n(config.fee_minor) ?? '0' };
  if (calcMethod === 'percent') {
    return { kind: 'percent', bps: Number(config.bps ?? 0), minMinor: n(config.min_minor), maxMinor: n(config.max_minor) };
  }
  if (calcMethod === 'slab') {
    const slabs = Array.isArray(config.slabs) ? (config.slabs as Array<Record<string, unknown>>) : [];
    return { kind: 'slab', bands: slabs.map((s) => ({ uptoMinor: n(s.upto_minor), feeMinor: n(s.fee_minor) ?? '0' })) };
  }
  // An unimplemented or unrecognised method: the row is shown and flagged, never rendered as a price.
  return { kind: 'unknown' };
}

/** Why a row cannot be proposed against — said on the row rather than discovered by pressing. */
export function proposeBlockedBy(
  row: { pendingProposalId: string | null; isTenantOverride: boolean },
  perms: { canManage: boolean },
): 'awaitingChecker' | 'noPermission' | null {
  if (!perms.canManage) return 'noPermission';
  if (row.pendingProposalId) return 'awaitingChecker';
  return null;
}

/** Whether THIS operator may sign a pending proposal: the maker may not be the checker (0141's CHECK, the service,
 *  and here — the same three layers the refund plane uses). */
export function canSignProposal(proposal: { proposedBy: string; status: string }, meId: string | null | undefined, canManage: boolean): boolean {
  return canManage && proposal.status === 'pending' && !!meId && proposal.proposedBy !== meId;
}

/** An APPROVED proposal still has to be applied — the moment the price actually changes. */
export function canApplyProposal(proposal: { status: string }, canManage: boolean): boolean {
  return canManage && proposal.status === 'approved';
}

/** The tax table's "does this platform apply it?" column. `not_read_by_any_code` is printed as its own sentence:
 *  a statutory rate recorded and read by nothing is a fact an operator should know before they rely on it. */
export function readerKey(readBy: string): 'invoiceGoods' | 'invoiceFee' | 'settlement' | 'notRead' {
  if (readBy === 'invoice_goods_line') return 'invoiceGoods';
  if (readBy === 'invoice_fee_line') return 'invoiceFee';
  if (readBy === 'settlement') return 'settlement';
  return 'notRead';
}

/** W150's "Applies to" column. An unknown code says so rather than being labelled with a plausible surface. */
export function surfaceKey(surface: string): 'checkout' | 'auctions' | 'listings' | 'notRead' {
  if (surface === 'checkout' || surface === 'auctions' || surface === 'listings') return surface;
  return 'notRead';
}

/** Are any commodity (category-scoped) GST rates recorded? When NONE are, every invoice's goods line reads "rate not
 *  recorded" — the link between this screen and W151's incomplete-basis counter, stated where it can be acted on. */
export function commodityRatesRecorded(rules: Array<{ taxCode: string; categoryScoped: boolean }>): number {
  return rules.filter((r) => r.taxCode === 'gst' && r.categoryScoped).length;
}
