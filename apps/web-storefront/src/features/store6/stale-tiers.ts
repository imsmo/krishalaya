// apps/web-storefront/src/features/store6/stale-tiers.ts · PC-56 STORE-6a · D5 (survey B9 / F-9) — THE "AS OF" LAW IN TIERS, storefront-local.
// PURE. The drift-pinned port features/offline/stale.ts (byte-identical to web-tenant's) keeps its ONE threshold (1 h) — this module adds the
// canon's escalation on top of it (W313 §2 "<15 min quiet · >1 hour prominent · >24 hours full-width; money figures get their stale tint at
// >1 hour"):
//   fresh      age < 15 min        quiet — the "as of" line only
//   aging      15 min ≤ age ≤ 1 h  the "as of" line (the canon names no tier here; nothing louder than the line)
//   prominent  1 h < age ≤ 24 h    the band, and every money figure is tinted AND worded (never colour alone) — the port's isStale
//   full       age > 24 h          the full-width band + "prices may have moved"
// An unreadable instant is `fresh` (unknown ≠ old — the port's rule). `tierOf` and `bandState` are SELF-CONTAINED (no import, no outside
// reference): components/offline/CachedBand.tsx embeds their exact text into the page's inline script, so the band works on a page the worker
// served from its cache even when the page's JavaScript chunks are not on the phone.
import { isStale } from '../offline/stale';

export type StaleTier = 'fresh' | 'aging' | 'prominent' | 'full';
export const QUIET_MS = 15 * 60_000;
export const PROMINENT_MS = 60 * 60_000;
export const FULL_MS = 24 * 60 * 60_000;

/** The tier of a page rendered at `asOf`, seen at `now` (ms or Date). */
export function tierOf(asOf: string | number | Date | null | undefined, now: number | Date): StaleTier {
  var t = asOf instanceof Date ? asOf.getTime() : typeof asOf === 'number' ? asOf : asOf ? Date.parse(asOf) : NaN;
  var n = now instanceof Date ? now.getTime() : now;
  if (!isFinite(t) || !isFinite(n)) return 'fresh';
  var age = n - t;
  if (age > 24 * 60 * 60000) return 'full';
  if (age > 60 * 60000) return 'prominent';
  if (age >= 15 * 60000) return 'aging';
  return 'fresh';
}

/** What the cached band shows: always offline (a page shown without signal says how old it is); online only once it is no longer fresh.
 *  Self-contained (it repeats `tierOf`'s thresholds rather than calling it — a minifier may rename a module-level reference, and this text is
 *  embedded on its own); the spec pins `bandState(…).tier === tierOf(…)` at every boundary. */
export function bandState(asOf: string | null | undefined, now: number, online: boolean): { show: boolean; tier: StaleTier; minutes: number; money: boolean } {
  var t = asOf ? Date.parse(asOf) : NaN;
  var age = now - t;
  var tier: StaleTier = !isFinite(t) || !isFinite(now) ? 'fresh' : age > 24 * 60 * 60000 ? 'full' : age > 60 * 60000 ? 'prominent' : age >= 15 * 60000 ? 'aging' : 'fresh';
  var minutes = isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
  var money = tier === 'prominent' || tier === 'full';
  return { show: isFinite(t) && (!online || tier !== 'fresh'), tier: tier, minutes: minutes, money: money };
}

/** Money figures are tinted from the port's threshold (> 1 h) — the same instant `prominent` starts (the spec pins the agreement). */
export function moneyStale(asOf: string | Date | null | undefined, now: Date): boolean {
  return isStale(asOf, now);
}

/** The attribute a stale money cell carries (with a word beside it — never colour alone). */
export const MONEY_STALE_ATTR = 'data-kv-stale';
export const MONEY_STALE_VALUE = 'money';
