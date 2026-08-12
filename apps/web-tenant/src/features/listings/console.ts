// apps/web-tenant/src/features/listings/console.ts · W123 staff console + W126/W127 QC pure logic
// (PC-56 TENANT-2a). No I/O, no framework — everything here is mutation-testable.

/** The tab vocabulary IS the state machine's, closed, in the canon's order — plus `held`, which the canon's
 *  mock happened to draw with a count of zero and omit: a platform-held listing that no tab can reach would be
 *  invisible exactly when it most needs an owner's eyes. */
export const CONSOLE_TABS = [
  'all', 'published', 'pending_approval', 'draft', 'paused', 'sold_out', 'expired', 'rejected', 'hidden', 'held', 'archived',
] as const;
export type ConsoleTab = (typeof CONSOLE_TABS)[number];

export function isConsoleTab(v: string | undefined): v is ConsoleTab {
  return v !== undefined && (CONSOLE_TABS as readonly string[]).includes(v);
}

/** Tab links NEVER carry the cursor — a keyset cursor is a position in ONE ordered set (the 1b lesson), and
 *  carrying it into another tab would silently skip everything that sorts earlier. */
export function tabHref(tab: ConsoleTab): string {
  return tab === 'all' ? '/listings' : `/listings?status=${tab}`;
}

/** Waiting age for the QC queue. `unclocked` = parked in review before 0138's clock existed — said, not aged
 *  (an invented "2.1h" over an unknown wait is the exact number W126 must never fake). */
export type WaitingAge = { kind: 'aged'; hours: number; overTarget: boolean } | { kind: 'unclocked' };

export const QC_TARGET_HOURS = 4;   // W126's own target: "nothing waits past 4h during trading hours"

export function waitingAge(qcSubmittedAt: string | null, now: Date): WaitingAge {
  if (!qcSubmittedAt) return { kind: 'unclocked' };
  const hours = Math.max(0, (now.getTime() - new Date(qcSubmittedAt).getTime()) / 3_600_000);
  const rounded = Math.round(hours * 10) / 10;
  return { kind: 'aged', hours: rounded, overTarget: rounded >= QC_TARGET_HOURS };
}

/** Price against the peer band — labelled verdicts only, never a fake "AI" attribution: the band is P10–P90
 *  of THIS tenant's own published listings for the same product × region. */
export type BandVerdict =
  | { kind: 'inside' } | { kind: 'below'; pct: number } | { kind: 'above'; pct: number }
  | { kind: 'no_band' };   // no comparable published listings — unknown ≠ "inside"

export function bandVerdict(priceMinor: string, band: { lowMinor: string; highMinor: string } | null): BandVerdict {
  if (!band) return { kind: 'no_band' };
  const p = BigInt(priceMinor), lo = BigInt(band.lowMinor), hi = BigInt(band.highMinor);
  if (p < lo) return { kind: 'below', pct: lo > 0n ? Number(((lo - p) * 100n) / lo) : 0 };
  if (p > hi) return { kind: 'above', pct: hi > 0n ? Number(((p - hi) * 100n) / hi) : 0 };
  return { kind: 'inside' };
}

/** Bulk selection gate: bounded, and NEVER a price path — W123's own bar says "bulk actions never change
 *  price"; this module simply has no bulk verb that could. */
export const BULK_MAX = 50;

export function parseBulkIds(ids: readonly string[]): { ok: true; ids: string[] } | { ok: false; error: 'none' | 'toomany' } {
  const clean = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  if (clean.length === 0) return { ok: false, error: 'none' };
  if (clean.length > BULK_MAX) return { ok: false, error: 'toomany' };
  return { ok: true, ids: clean };
}

/** Status → house badge tone. `rejected`/`held` alarm (they demand an owner's action); everything else is the
 *  neutral badge — there is no tone that celebrates: published is simply the working state of a marketplace. */
export function statusClass(status: string): string {
  return status === 'rejected' || status === 'held' ? 'kv-badge kv-badge--frozen' : 'kv-badge';
}
