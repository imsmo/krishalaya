// apps/web-ops/src/features/dairy/pos.ts · PURE dairy-desk logic (PC-34 OW-4): GenerateBillInput and the bill state machine (draft → previewed →
// approved → paid), and the shift / flag vocabularies the counter reuses. (PC-56 OPS-3a moved the pour-record check to features/ops3/counter.ts.)
export const DAIRY_SHIFTS = ['morning', 'evening'] as const;
export const BILL_STATUSES = ['draft', 'previewed', 'disputed', 'approved', 'paid'] as const;
export const ADULTERATION_FLAGS = ['water', 'starch', 'urea', 'detergent'] as const;

export function isBillStatus(v: string | undefined | null): boolean {
  return !!v && (BILL_STATUSES as readonly string[]).includes(v);
}
export function canPreview(status: string | undefined | null): boolean { return status === 'draft'; }
export function canApprove(status: string | undefined | null): boolean { return status === 'previewed'; }
export function canPay(status: string | undefined | null): boolean { return status === 'approved'; }

// PC-56 OPS-3a: `buildCollection` (the pour-record form's check, with `Number(…)` bounds) is GONE with the form — the record act moved to the
// counter, and its pattern-only check is `buildPour` in features/ops3/counter.ts (no float on the reading path, a day after today refused).

export type BillGenResult =
  | { ok: true; value: { membershipId: string; periodStart: string; periodEnd: string } }
  | { ok: false; error: 'member' | 'period' };

export function buildBillGen(raw: { membershipId: string; periodStart: string; periodEnd: string }): BillGenResult {
  const membershipId = raw.membershipId.trim();
  if (!membershipId) return { ok: false, error: 'member' };
  const periodStart = raw.periodStart.trim();
  const periodEnd = raw.periodEnd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodEnd < periodStart) {
    return { ok: false, error: 'period' };
  }
  return { ok: true, value: { membershipId, periodStart, periodEnd } };
}
