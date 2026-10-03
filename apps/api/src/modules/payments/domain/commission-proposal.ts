// modules/payments/domain/commission-proposal.ts · PC-56 TENANT-SW-a · A3 — the PURE rules of a commission rule change (canon W149:
// "new effective-dated rows, never edits … takes effect at midnight … 7-day notice enforced"; founder: "freeze at placement + 7-day
// notice + checker"). The database is the wall (0196 trg_crp_moves / trg_commission_rules_gate); these functions let the service refuse
// by name first and let the console print the same dates.
export const COMMISSION_NOTICE_DAYS = 7;
export const COMMISSION_PROPOSAL_TTL_DAYS = 7;
const IST_OFFSET_MS = 330 * 60_000;

/** Today's date in Asia/Kolkata, YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string { return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10); }
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
/** The earliest effective date a proposal may carry: the next IST midnight + 7 days (= IST today + 8). */
export function earliestEffectiveFrom(now: Date = new Date()): string { return addDays(istToday(now), COMMISSION_NOTICE_DAYS + 1); }
/** The earliest date a CONFIRMATION can still honour (the DB's rule on the written row: IST today + 7). */
export function earliestAtConfirm(now: Date = new Date()): string { return addDays(istToday(now), COMMISSION_NOTICE_DAYS); }
/** The instant a date takes effect: 00:00 Asia/Kolkata of that date. */
export function istMidnightOf(ymd: string): Date { return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - IST_OFFSET_MS); }

export type NoticeVerdict = { ok: true } | { ok: false; code: 'too_soon'; earliest: string };
export function noticeVerdict(effectiveFrom: string, now: Date = new Date()): NoticeVerdict {
  const earliest = earliestEffectiveFrom(now);
  return effectiveFrom >= earliest ? { ok: true } : { ok: false, code: 'too_soon', earliest };
}

/** W149's "Resolution example … Lowest priority number wins": which candidate the resolver picks, by the SAME order as
 *  CommissionRuleRepository.resolveBest (tenant first, then category, seller role, source specificity, then priority ASC). */
export interface RuleCandidate { id: string; tenantId: string | null; categoryId: string | null; sellerRoleId: string | null; source: string | null; priority: number; effectiveFrom: string; effectiveTo: string | null; isActive: boolean }
export function resolveAmong(rules: RuleCandidate[], q: { categoryId: string | null; sellerRoleId: string | null; source: string | null; onDate: string }): RuleCandidate | null {
  const eligible = rules.filter((r) => r.isActive && r.effectiveFrom <= q.onDate && (r.effectiveTo == null || r.effectiveTo >= q.onDate)
    && (r.categoryId == null || r.categoryId === q.categoryId) && (r.sellerRoleId == null || r.sellerRoleId === q.sellerRoleId)
    && (r.source == null || r.source === q.source));
  const key = (r: RuleCandidate): number[] => [r.tenantId != null ? 0 : 1, r.categoryId != null ? 0 : 1, r.sellerRoleId != null ? 0 : 1, r.source != null ? 0 : 1, r.priority];
  eligible.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return eligible[0] ?? null;
}
