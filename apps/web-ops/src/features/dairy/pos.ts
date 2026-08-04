// apps/web-ops/src/features/dairy/pos.ts · PURE dairy-POS logic (PC-34 OW-4). Mirrors RecordCollectionInput
// (weightKg/fatPct/snfPct decimal strings — the SERVER prices the collection from the rate card; the POS never
// computes money) + GenerateBillInput and the bill state machine (draft → previewed → approved → paid).
export const DAIRY_SHIFTS = ['morning', 'evening'] as const;
export const BILL_STATUSES = ['draft', 'previewed', 'disputed', 'approved', 'paid'] as const;
export const ADULTERATION_FLAGS = ['water', 'starch', 'urea', 'detergent'] as const;

export function isBillStatus(v: string | undefined | null): boolean {
  return !!v && (BILL_STATUSES as readonly string[]).includes(v);
}
export function canPreview(status: string | undefined | null): boolean { return status === 'draft'; }
export function canApprove(status: string | undefined | null): boolean { return status === 'previewed'; }
export function canPay(status: string | undefined | null): boolean { return status === 'approved'; }

const DEC = (max: number, dp: number) => new RegExp(`^\\d{1,${max}}(\\.\\d{1,${dp}})?$`);

export type CollectionResult =
  | { ok: true; value: { membershipId: string; shift: 'morning' | 'evening'; collectedOn: string; weightKg: string; fatPct: string; snfPct: string; waterFlag?: boolean; adulterationFlags?: string[] } }
  | { ok: false; error: 'member' | 'shift' | 'date' | 'weight' | 'fat' | 'snf' };

export function buildCollection(raw: { membershipId: string; shift: string; collectedOn: string; weightKg: string; fatPct: string; snfPct: string; waterFlag: boolean; adulteration: string[] }): CollectionResult {
  const membershipId = raw.membershipId.trim();
  if (!membershipId) return { ok: false, error: 'member' };
  if (!(DAIRY_SHIFTS as readonly string[]).includes(raw.shift)) return { ok: false, error: 'shift' };
  const collectedOn = raw.collectedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)) return { ok: false, error: 'date' };
  const weightKg = raw.weightKg.trim();
  if (!DEC(4, 3).test(weightKg) || Number(weightKg) <= 0) return { ok: false, error: 'weight' };
  const fatPct = raw.fatPct.trim();
  if (!DEC(2, 2).test(fatPct) || Number(fatPct) <= 0 || Number(fatPct) > 15) return { ok: false, error: 'fat' };
  const snfPct = raw.snfPct.trim();
  if (!DEC(2, 2).test(snfPct) || Number(snfPct) <= 0 || Number(snfPct) > 15) return { ok: false, error: 'snf' };
  const adulterationFlags = raw.adulteration.filter((f) => (ADULTERATION_FLAGS as readonly string[]).includes(f));
  const out: { membershipId: string; shift: 'morning' | 'evening'; collectedOn: string; weightKg: string; fatPct: string; snfPct: string; waterFlag?: boolean; adulterationFlags?: string[] } =
    { membershipId, shift: raw.shift as 'morning' | 'evening', collectedOn, weightKg, fatPct, snfPct };
  if (raw.waterFlag) out.waterFlag = true;
  if (adulterationFlags.length) out.adulterationFlags = adulterationFlags;
  return { ok: true, value: out };
}

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
