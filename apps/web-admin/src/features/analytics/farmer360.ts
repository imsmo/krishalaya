// apps/web-admin/src/features/analytics/farmer360.ts · W109 pure console logic (PC-56 ADMIN-SWEEP-b4).
//
// The one rule this file owns outright: NULL IS NOT ZERO. A tile whose value is null prints "unknown" with its
// basis — a farmer with no dairy membership must never read as a farmer earning ₹0 from dairy.
//
// DEV-60 (UI Port Program batch 3, Part 1, Slice A): `bandClass` now returns a `StatusTone` instead of a raw
// `kv-status kv-status--X` string — disposition (c), same pattern as `ai-governance.ts`. Call site renders
// `<StatusPill tone={...} label={...} />`. DISCLOSED FINDING: the pre-existing `restricted`/`blocked` branch
// returned `kv-status kv-status--err`, and `.kv-status--err` has NO matching rule in globals.css (only
// `--ok`/`--warn`/`--muted`/`--danger` exist) — so those two bands rendered with NO colour override at all
// (default `.kv-status` font-weight, inherited text colour), never the intended emphasis. Mapped to `danger`
// here, the tone the `--err` name always meant; this is a real, deliberate colour change for `restricted` and
// `blocked` bands, not a silent behaviour patch. This file's own `bandClass` is unrelated to
// `trust-safety.ts`'s identically-named export (a different band vocabulary, different file, out of this
// slice's scope).
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { StatusTone } from '@krishalaya/ui';

export interface MoneyTile { valueMinor: string | null; basis: string; n: number }

/** DEV-56 Part 5: delegates to the canonical `formatMoneyMinor` (`@krishalaya/i18n`) instead of hand-rolling string
 *  arithmetic on the minor-unit string directly — the version this replaced never used BigInt at all (string
 *  slicing + a fixed `padStart(3,'0')`/`-2` split) and, being hand-maintained arithmetic rather than a real
 *  currency formatter, hardcoded BOTH the ₹ symbol and the 2-decimal-currency assumption with no parameter to
 *  override either.
 *
 *  DATA GAP, DISCLOSED RATHER THAN SILENTLY PATCHED: this function has no `currency` parameter because nothing
 *  upstream carries one — `MoneyTile` (this file) and the Farmer 360 dashboard's timeline entries (grep-verified
 *  against `app/analytics/farmer-360/page.tsx`'s own interfaces) have no `currency` field anywhere in the API
 *  response. The INR default below preserves this file's pre-existing (always-₹) behaviour; it is not a claim that
 *  a currency was checked and found to be INR. A future wave that makes Farmer 360 currency-aware needs a real
 *  `currency` column on the underlying query, not a parameter default here. */
export function formatMinor(v: string | null): string {
  if (v === null) return '';
  return formatMoneyMinor(v, 'INR');
}

/** What a tile prints: a figure, or the honest word for its absence. */
export function tileText(t: MoneyTile): { key: 'value' | 'unknown'; text: string } {
  return t.valueMinor === null ? { key: 'unknown', text: '' } : { key: 'value', text: formatMinor(t.valueMinor) };
}

export function bandTone(band: string | null): StatusTone {
  if (band === 'trusted') return 'success';
  if (band === 'restricted' || band === 'blocked') return 'danger';
  if (band === 'caution') return 'warning';
  return 'neutral';
}

export function timelineIcon(kind: string): string {
  return kind === 'order' ? '₹' : kind === 'listing' ? '◆' : '✓';
}

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

export const EXPORT_REASON_MIN = 10;   // one floor with the server

export function buildExport(v: { reason: string }): Built<{ reason: string }> {
  const reason = v.reason.trim();
  if (reason.length < EXPORT_REASON_MIN) return { ok: false, error: 'reason' };
  return { ok: true, value: { reason } };
}

/** Search input gate: ≥2 chars (a single letter would sweep the population). No phone shapes are special-cased —
 *  the server has no phone predicate to hit anyway; this is display-side hygiene only. */
export function buildSearch(v: { q: string }): Built<{ q: string }> {
  const q = v.q.trim();
  if (q.length < 2) return { ok: false, error: 'q' };
  return { ok: true, value: { q } };
}
