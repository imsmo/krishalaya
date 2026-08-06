// apps/web-admin/src/features/billing/dunning-queue.ts · PURE collection-queue rules (PC-56 ADMIN-1, canon W015).
// No IO, no React → unit-provable. Mirrors admin-api billing-ops (dunningQueue read + nextDunningAttempt caps).
//
// THIS SCREEN IS WHERE THE PLATFORM ASKS PEOPLE FOR MONEY, so every number on it has to be defensible in front of
// the tenant being chased. Two rules follow from that and they shape everything below:
//
//   1. AN UNKNOWN BALANCE IS NEVER A NUMBER. `invoice_status` can reach `partially_paid`, but the platform records
//      no SaaS-invoice PAYMENTS (0002 has `paid_at` only) — so for a part-paid invoice the outstanding amount is
//      genuinely unknown. The API sends `outstandingMinor: null` with a reason; this module keeps it null all the
//      way to the screen and REFUSES to include it in any total. Showing the full total would overstate the debt;
//      showing zero would understate it. Both put a false figure in a collections call. (GAP-BACKEND ADMIN-1-Q1.)
//   2. THE LADDER IS DESCRIPTIVE, NOT PRESCRIPTIVE. There is no dunning-POLICY table, so "next action" cannot be
//      read from configuration. `dunningStep` below is simply how many touches have been recorded, and the suggested
//      channel is the conventional escalation — labelled as a suggestion, never as a policy the platform enforces.

export const DUNNING_CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'in_app'] as const;
export type DunningChannel = (typeof DUNNING_CHANNELS)[number];

/** admin-api's per-invoice cap — the literal value in `modules/billing-ops/domain/dunning.ts`
 *  (`MAX_DUNNING_ATTEMPTS = 12`, past which the server tells you to escalate instead of chasing). Mirrored so the
 *  console stops OFFERING a touch at the cap rather than letting an officer compose one and be refused. Pinned by a
 *  spec assertion, because the two constants live in different apps and a silent divergence would show a control
 *  that cannot work. */
export const MAX_DUNNING_ATTEMPTS = 12;

export interface QueueRow {
  invoiceId?: string;
  invoiceNo?: string | null;
  tenantId?: string | null;
  tenantSlug?: string | null;
  status?: string | null;
  currency?: string | null;
  totalMinor?: string | null;
  outstandingMinor?: string | null;
  outstandingUnknownReason?: string | null;
  dueDate?: string | null;
  daysLate?: number | null;
  dunningAttempts?: number | null;
  lastDunnedAt?: string | null;
  subscriptionStatus?: string | null;
  cancelAtPeriodEnd?: boolean | null;
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------
/** The tiers the console groups by. `current` means owed but NOT yet late — deliberately visible, because an invoice
 *  that is about to age is the cheapest one to collect. */
export const AGEING_TIERS = ['current', 'late', 'overdue_30', 'overdue_60', 'overdue_90'] as const;
export type AgeingTier = (typeof AGEING_TIERS)[number];

export function ageingTier(daysLate: number | null | undefined): AgeingTier {
  const d = Number(daysLate);
  if (!Number.isFinite(d) || d <= 0) return 'current';
  if (d >= 90) return 'overdue_90';
  if (d >= 60) return 'overdue_60';
  if (d >= 30) return 'overdue_30';
  return 'late';
}

/** 90+ days is the write-off conversation, not the collections one — flagged so it is escalated rather than dunned
 *  again. This is a LABEL: provisioning and write-off are finance decisions with their own approvals. */
export function needsWriteOffReview(row: QueueRow): boolean {
  return ageingTier(row.daysLate) === 'overdue_90';
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------
/** How many touches have been recorded. Not a policy step — see the header. */
export function dunningStep(row: QueueRow): number {
  const n = Number(row.dunningAttempts);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** True once the per-invoice cap is reached: no further touch may be recorded, so none is offered. */
export function dunningExhausted(row: QueueRow): boolean {
  return dunningStep(row) >= MAX_DUNNING_ATTEMPTS;
}

/** The conventional next channel — gentler first, personal later. Returns null when the cap is reached, so the page
 *  says "escalate this" rather than suggesting a seventh email. */
export function suggestedChannel(row: QueueRow): DunningChannel | null {
  if (dunningExhausted(row)) return null;
  // gentle → personal. Past the written ladder everything is a call: by the seventh touch, another automated
  // message is not the missing ingredient.
  const ladder: DunningChannel[] = ['email', 'sms', 'whatsapp', 'email', 'call', 'whatsapp'];
  return ladder[dunningStep(row)] ?? 'call';
}

/** Why a touch cannot be recorded right now, so the page can say it in words rather than hide a control.
 *  `not_collectible` covers draft (never sent) and paid/void (settled) — the API refuses those too. */
export type TouchBlock = 'none' | 'not_collectible' | 'capped';
export function touchBlockedReason(row: QueueRow): TouchBlock {
  const s = String(row.status ?? '');
  if (!(s === 'issued' || s === 'partially_paid' || s === 'overdue')) return 'not_collectible';
  if (dunningExhausted(row)) return 'capped';
  return 'none';
}
export function canRecordTouch(row: QueueRow): boolean { return touchBlockedReason(row) === 'none'; }

// ---------------------------------------------------------------------------
// Money — the part that must never guess
// ---------------------------------------------------------------------------
/** True when the balance is unknown rather than zero. The page shows a word, never a figure. */
export function outstandingUnknown(row: QueueRow): boolean {
  return row.outstandingMinor === null || row.outstandingMinor === undefined;
}

/** Sum of the balances we actually KNOW, plus a count of the ones we do not — returned together so a caller cannot
 *  render the total without also being able to say how incomplete it is. A single number here would be read as
 *  "this is what the platform is owed", and with part-paid invoices excluded that would be false. */
export function knownOutstanding(rows: readonly QueueRow[]): { totalMinor: bigint; knownRows: number; unknownRows: number } {
  let totalMinor = 0n; let knownRows = 0; let unknownRows = 0;
  for (const r of rows) {
    if (outstandingUnknown(r)) { unknownRows += 1; continue; }
    const s = String(r.outstandingMinor).trim();
    if (!/^-?\d{1,20}$/.test(s)) { unknownRows += 1; continue; }   // unparseable is unknown, not zero
    totalMinor += BigInt(s); knownRows += 1;
  }
  return { totalMinor, knownRows, unknownRows };
}

/** Group counts per ageing tier, for the filter chips. Only tiers with rows are returned — a chip reading "0" invites
 *  a click that lands on an empty list. */
export function tierCounts(rows: readonly QueueRow[]): Array<{ tier: AgeingTier; n: number }> {
  const map = new Map<AgeingTier, number>();
  for (const r of rows) {
    const t = ageingTier(r.daysLate);
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return AGEING_TIERS.filter((t) => (map.get(t) ?? 0) > 0).map((t) => ({ tier: t, n: map.get(t) as number }));
}

/** The `minDaysLate` a tier maps to, for the GET-form filter. `current` sends 0 (everything owed). */
export function tierMinDays(tier: AgeingTier): number {
  return tier === 'overdue_90' ? 90 : tier === 'overdue_60' ? 60 : tier === 'overdue_30' ? 30 : tier === 'late' ? 1 : 0;
}
export function isAgeingTier(v: string | null | undefined): v is AgeingTier {
  return !!v && (AGEING_TIERS as readonly string[]).includes(v);
}

/** A subscription already cancelling at period end changes the conversation — worth surfacing, because chasing an
 *  invoice from a tenant who is leaving is a different task from chasing one who is staying. */
export function isLeaving(row: QueueRow): boolean {
  return row.cancelAtPeriodEnd === true || row.subscriptionStatus === 'cancelled' || row.subscriptionStatus === 'expired';
}
