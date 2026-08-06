// apps/web-admin/src/features/billing/subscription-view.ts · PURE rules for one tenant's subscription screen
// (PC-56 ADMIN-1, canon W017). No IO, no React → unit-provable.
//
// THE HONEST SHAPE OF THIS SCREEN. The canon calls it a "timeline", and the platform has no subscription-EVENT
// table — `subscriptions` carries the CURRENT row only (0002). So this module never pretends to know when a
// subscription became active or who changed it. What it does instead:
//   • names the CURRENT state,
//   • lists the machine's next LEGAL states as possibilities (mirroring admin-api's enum, reflect-never-grant), and
//   • treats the invoices the subscription produced as the real, dated history — because those are facts.
// A timeline reconstructed from `updated_at` would look authoritative and be fiction, and a subscription's history is
// precisely what a tenant disputes years later.
//
// MONEY IS NEVER COMPUTED HERE. The negotiated price, the discount and the add-on prices are all displayed exactly
// as stored; this file does not multiply a monthly price by twelve, apply a discount, or total the add-ons. The
// invoice IS the arithmetic, and it is produced server-side by the billing cycle (Law 2).

/** admin-api's `subscription_status` enum, verbatim (0002 line 14). */
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export function isSubscriptionStatus(v: string | null | undefined): v is SubscriptionStatus {
  return !!v && (SUBSCRIPTION_STATUSES as readonly string[]).includes(v);
}

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** The lifecycle as the platform means it. Read as: from this state, these are the states that can follow.
 *  `cancelled` and `expired` are TERMINAL — a lapsed subscription is re-sold as a new one, not revived, so that a
 *  price and a period start are agreed again rather than silently inherited. */
const NEXT: Readonly<Record<SubscriptionStatus, readonly SubscriptionStatus[]>> = {
  trialing: ['active', 'cancelled', 'expired'],
  active: ['past_due', 'paused', 'cancelled'],
  past_due: ['active', 'paused', 'cancelled', 'expired'],
  paused: ['active', 'cancelled', 'expired'],
  cancelled: [],
  expired: [],
};
export function possibleNext(status: string | null | undefined): readonly SubscriptionStatus[] {
  return isSubscriptionStatus(status) ? NEXT[status] : [];
}
export function isTerminalSubscription(status: string | null | undefined): boolean {
  return status === 'cancelled' || status === 'expired';
}

export interface SubscriptionRow {
  id?: string;
  planId?: string | null;
  status?: string | null;
  billingCycle?: string | null;
  priceMinor?: string | null;
  currency?: string | null;
  discountPct?: string | null;
  anchorTerms?: Record<string, unknown> | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
}

// ---------------------------------------------------------------------------
// The renewal window — the one number an account manager acts on
// ---------------------------------------------------------------------------
/** Whole days from `todayIso` to the period end. NEGATIVE when the period has already ended (a real state: the
 *  renewal job has not run, or the subscription is past_due), and NULL when the date is missing or unreadable —
 *  never 0, which would read as "renews today". */
export function daysToRenewal(periodEnd: string | null | undefined, todayIso: string): number | null {
  const end = Date.parse(String(periodEnd ?? ''));
  const now = Date.parse(todayIso);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  return Math.floor((end - now) / 86_400_000);
}

/** What the period end MEANS, which is not the same as how far away it is:
 *   • `ending` — cancel_at_period_end is set, so this date is the last day of service. Said plainly, because it is
 *     the difference between a renewal to prepare for and a customer to save.
 *   • `lapsed` — the end date has passed and the subscription is not terminal: something did not run. Surfaced
 *     rather than smoothed over.
 *   • `renewing` / `unknown`. */
export type RenewalState = 'renewing' | 'ending' | 'lapsed' | 'terminated' | 'unknown';
export function renewalState(sub: SubscriptionRow, todayIso: string): RenewalState {
  if (isTerminalSubscription(sub.status)) return 'terminated';
  const d = daysToRenewal(sub.periodEnd, todayIso);
  if (d === null) return 'unknown';
  if (sub.cancelAtPeriodEnd === true) return 'ending';
  return d < 0 ? 'lapsed' : 'renewing';
}

/** Anchor terms (founding-partner price locks, free months) are a jsonb bag whose keys are commercial, not
 *  technical. They are shown as recorded KEY/VALUE pairs — never interpreted — because a term this console
 *  mis-summarises is a contract this console mis-states. Values that are objects are stringified compactly so the
 *  page can show something honest rather than "[object Object]". */
export function anchorTermRows(anchorTerms: Record<string, unknown> | null | undefined): Array<{ key: string; value: string }> {
  if (!anchorTerms || typeof anchorTerms !== 'object' || Array.isArray(anchorTerms)) return [];
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(anchorTerms)) {
    if (raw === null || raw === undefined) continue;
    const value = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    if (value.trim()) out.push({ key, value: value.length > 200 ? `${value.slice(0, 200)}…` : value });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** True when the tenant carries negotiated terms at all — worth a heading rather than an empty section. */
export function hasAnchorTerms(sub: SubscriptionRow): boolean { return anchorTermRows(sub.anchorTerms).length > 0; }

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------
export interface AddonRow {
  id?: string; addonCode?: string | null; quantity?: number | null;
  priceMinor?: string | null; startsOn?: string | null; endsOn?: string | null;
}

/** An add-on is billing NOW only if it has started and has not ended. An ended add-on is still shown (it explains a
 *  past invoice) but is not counted as active — the alternative is a support call about a charge that stopped. */
export function addonActive(a: AddonRow, todayIso: string): boolean {
  const today = todayIso.slice(0, 10);
  const starts = String(a.startsOn ?? '').slice(0, 10);
  const ends = String(a.endsOn ?? '').slice(0, 10);
  if (starts && starts > today) return false;
  if (ends && ends < today) return false;
  return true;
}

/** Active first, then by code — so what is billing now is at the top, and the historical rows are still reachable. */
export function sortAddons(rows: readonly AddonRow[], todayIso: string): AddonRow[] {
  return [...rows].sort((a, b) => {
    const aa = addonActive(a, todayIso), ba = addonActive(b, todayIso);
    if (aa !== ba) return aa ? -1 : 1;
    return String(a.addonCode ?? '') < String(b.addonCode ?? '') ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Invoice history (the part of the "timeline" that is real)
// ---------------------------------------------------------------------------
export interface HistoryInvoice {
  id?: string; invoiceNo?: string | null; status?: string | null; currency?: string | null;
  totalMinor?: string | null; dueDate?: string | null; paidAt?: string | null; createdAt?: string | null;
}

/** Newest first — the API already orders this way, but a page that depends on server ordering for MEANING should
 *  re-establish it locally rather than trust it. Rows with no date sort last: an undated invoice is a data problem,
 *  and putting it at the top would make it look like the latest event. */
export function sortHistory(rows: readonly HistoryInvoice[]): HistoryInvoice[] {
  return [...rows].sort((a, b) => {
    const ad = Date.parse(String(a.createdAt ?? '')), bd = Date.parse(String(b.createdAt ?? ''));
    const aok = Number.isFinite(ad), bok = Number.isFinite(bd);
    if (aok !== bok) return aok ? -1 : 1;
    if (!aok) return 0;
    return bd - ad;
  });
}

/** Count of invoices this subscription has left UNSETTLED. Not a money total — see the module header; the amount
 *  owed on a part-paid invoice is not recorded anywhere, so only the COUNT is honest here. */
export function unsettledCount(rows: readonly HistoryInvoice[]): number {
  return rows.filter((r) => r.status === 'issued' || r.status === 'partially_paid' || r.status === 'overdue').length;
}
