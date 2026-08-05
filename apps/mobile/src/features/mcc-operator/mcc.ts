// apps/mobile/src/features/mcc-operator/mcc.ts · PURE MCC-counter logic (PC-50 W10-7; design canon screens
// 236–239). Mirrors web-ops features/dairy/pos.ts EXACTLY (the proven counter rules): weighment DEC(4,3),
// FAT/SNF DEC(2,2) in (0,15], seeded adulteration flags only, empty optionals omitted. THE COUNTER NEVER
// PRICES MILK — the server prices every slip from the rate card (Law 2/11). No IO.
export const SHIFTS = ['morning', 'evening'] as const;
export const ADULTERATION_FLAGS = ['water', 'starch', 'urea', 'detergent'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEC = (w: number, f: number) => new RegExp(`^\\d{1,${w}}(\\.\\d{1,${f}})?$`);

export type SlipDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'member' | 'shift' | 'date' | 'weight' | 'fat' | 'snf' };

export function buildSlipDraft(raw: { membershipId: string; shift: string; collectedOn: string; weightKg: string; fatPct: string; snfPct: string; waterFlag: boolean; adulteration: string[] }): SlipDraftResult {
  if (!raw.membershipId) return { ok: false, error: 'member' };
  if (!(SHIFTS as readonly string[]).includes(raw.shift)) return { ok: false, error: 'shift' };
  if (!DATE.test(raw.collectedOn)) return { ok: false, error: 'date' };
  const weightKg = raw.weightKg.trim();
  if (!DEC(4, 3).test(weightKg) || Number(weightKg) <= 0) return { ok: false, error: 'weight' };
  const fatPct = raw.fatPct.trim();
  if (!DEC(2, 2).test(fatPct) || Number(fatPct) <= 0 || Number(fatPct) > 15) return { ok: false, error: 'fat' };
  const snfPct = raw.snfPct.trim();
  if (!DEC(2, 2).test(snfPct) || Number(snfPct) <= 0 || Number(snfPct) > 15) return { ok: false, error: 'snf' };
  const adulterationFlags = raw.adulteration.filter((f) => (ADULTERATION_FLAGS as readonly string[]).includes(f));
  const out: Record<string, unknown> = { membershipId: raw.membershipId, shift: raw.shift, collectedOn: raw.collectedOn, weightKg, fatPct, snfPct };
  if (raw.waterFlag) out.waterFlag = true;
  if (adulterationFlags.length) out.adulterationFlags = adulterationFlags;
  return { ok: true, value: out };
}

/** Case-insensitive member filter over the FETCHED page (display filtering, never money). */
export function filterMembers<T extends { memberCode: string }>(members: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...members];
  return members.filter((m) => m.memberCode.toLowerCase().includes(needle));
}
