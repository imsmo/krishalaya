// apps/mobile/src/features/dairy/dairy.ts · PURE dairy-farmer logic (PC-50 W10-2). Date-window helpers for the
// milk diary and display gates for bills. MONEY LAW: every amount shown is a SERVER-priced minor string
// (collections are priced from the rate card at record time; bill gross/deductions/net are server-generated).
// This file never sums money — period totals belong to the BILL, not a client-side reduce. No IO.
export const BILL_STATUSES = ['draft', 'previewed', 'disputed', 'approved', 'paid'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The diary's default window: the 1st of the current month → today (local calendar, ISO dates). */
export function defaultDiaryRange(today: Date): { from: string; to: string } {
  return { from: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: toIsoDate(today) };
}
/** Previous full month of a given window start — for the "previous month" pager. */
export function shiftMonth(fromIso: string, delta: number): { from: string; to: string } {
  const [y, m] = fromIso.split('-').map(Number);
  const start = new Date(y, m - 1 + delta, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { from: toIsoDate(start), to: toIsoDate(end) };
}
export function isValidRange(from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
}

export function billTone(status: string | undefined): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'paid') return 'success';
  if (status === 'disputed') return 'danger';
  if (status === 'approved') return 'info';
  if (status === 'previewed') return 'warning';
  return 'neutral'; // draft
}
/** The dispute window is OPEN if the server gave an end instant that is still in the future. */
export function disputeWindowOpen(disputeWindowEnds: string | null | undefined, now: Date): boolean {
  if (!disputeWindowEnds) return false;
  const t = Date.parse(disputeWindowEnds);
  return Number.isFinite(t) && t > now.getTime();
}
