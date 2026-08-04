// apps/mobile/src/features/ambassador/ambassador-home.ts · PURE logic for the Ambassador Home screen (86). No React
// / no SDK I/O (SDK types are `import type` → erased) → unit-tested. Drives the home stat tiles, the "pending
// onboardings" list, and the cluster-rank badge from the ambassador's OWN referrals + earnings + leaderboard row.
// §13: referrals are PII-minimised (no farmer name on the contract) → the list anonymises to a code-initial + the
// server-enforced status; a specific pending REASON (e.g. "Aadhaar pending") and a farmer ACTIVITY feed have no
// contract yet, so those are rendered honestly (status label / coming-soon), never fabricated.
import type { Referral, LeaderboardEntry } from '@krishalaya/sdk-js';

/** Count referrals created in the calendar month of `nowMs`. Pure. */
export function referralsThisMonth(items: readonly Referral[] | null | undefined, nowMs: number): number {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  let n = 0;
  for (const r of items ?? []) {
    if (!r.createdAt) continue;
    const d = new Date(r.createdAt);
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() === y && d.getUTCMonth() === m) n += 1;
  }
  return n;
}

/** Referrals still being onboarded (invited / signed_up — not yet activated or rewarded), newest first, capped.
 * Drives the "Pending onboardings" list. Pure. */
export function pendingReferrals(items: readonly Referral[] | null | undefined, limit = 4): Referral[] {
  return (items ?? [])
    .filter((r) => r.status === 'invited' || r.status === 'signed_up')
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, Math.max(0, limit));
}

/** The caller's rank in the leaderboard window, or null if they're not on it. Pure. */
export function myRank(entries: readonly LeaderboardEntry[] | null | undefined, userId: string | null | undefined): number | null {
  if (!userId) return null;
  const e = (entries ?? []).find((x) => x.userId === userId);
  return e ? e.rank : null;
}

/** Two-letter uppercase initials from a name or referral code (avatar chip). Pure. Never a raw id. */
export function personInitials(source: string | null | undefined): string {
  const s = (source ?? '').trim();
  if (!s) return '–';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '–';
}

// My-Farmers (87) filter tabs. §13: the referral contract exposes only status (invited→signed_up→activated→
// rewarded), NOT per-farmer 30-day activity, so we bucket by the REAL states we have — never a fabricated
// active/inactive split: 'all', 'onboarded' (activated|rewarded), 'pending' (invited|signed_up).
export const FARMER_TABS = ['all', 'onboarded', 'pending'] as const;
export type FarmerTab = (typeof FARMER_TABS)[number];

function isOnboarded(status: string): boolean { return status === 'activated' || status === 'rewarded'; }
function isPending(status: string): boolean { return status === 'invited' || status === 'signed_up'; }

/** Filter referrals to a tab (newest first). Pure. */
export function filterReferralsByTab(items: readonly Referral[] | null | undefined, tab: FarmerTab): Referral[] {
  const rows = (items ?? []).filter((r) => tab === 'all' || (tab === 'onboarded' ? isOnboarded(r.status) : isPending(r.status)));
  return rows.slice().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Count of referrals in each tab bucket. Pure. */
export function farmerTabCounts(items: readonly Referral[] | null | undefined): Record<FarmerTab, number> {
  const list = items ?? [];
  return { all: list.length, onboarded: list.filter((r) => isOnboarded(r.status)).length, pending: list.filter((r) => isPending(r.status)).length };
}

// --- Leaderboard (93) ------------------------------------------------------------------------------------------
// §13: the leaderboard row carries {ambassadorId, userId, tierId, earnedMinor, events, rank} — NO ambassador name
// and NO cluster/region label. So the screen ranks by the REAL fields (rank, events, earnedMinor) and marks the
// caller's own row "YOU"; other rows are anonymised (never a fabricated "Rita Pandya · Anand cluster"). The bonus
// AMOUNT for #1 has no contract, so the motivator is framed generically (no fabricated "₹2,000").

/** Leaderboard sorted ascending by the server's rank (stable copy). Pure. */
export function sortByRank(entries: readonly LeaderboardEntry[] | null | undefined): LeaderboardEntry[] {
  return [...(entries ?? [])].sort((a, b) => a.rank - b.rank);
}

/** Whole years since the ambassador joined (from profile.createdAt) — drives the Tenure tile. null when the date
 * is absent/unparseable (§13: never a fabricated tenure). */
export function tenureYears(createdAt: string | null | undefined, nowMs: number): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  const years = Math.floor((nowMs - t) / (365.25 * 24 * 60 * 60 * 1000));
  return years >= 0 ? years : null;
}

/** How many more onboardings the caller needs to overtake #1 = (topEvents − myEvents + 1). Returns null when the
 * caller is already #1, isn't ranked, or the board is empty — never a fabricated target. */
export function onboardsToReachTop(entries: readonly LeaderboardEntry[] | null | undefined, userId: string | null | undefined): number | null {
  const sorted = sortByRank(entries);
  if (sorted.length === 0 || !userId) return null;
  const me = sorted.find((e) => e.userId === userId);
  if (!me) return null;
  const top = sorted[0];
  if (me.rank === top.rank) return null;
  const diff = top.events - me.events;
  return diff > 0 ? diff + 1 : 1;
}
