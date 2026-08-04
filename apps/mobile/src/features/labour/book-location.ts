// apps/mobile/src/features/labour/book-location.ts · PURE presentation logic for the booking wizard's Work-Location
// step (screen 62). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. It turns the
// farmer's REAL land parcels into selectable "saved location" rows (title + region/area subtitle) and marks the
// default + selected. The booking's actual navigation coordinates come from a GPS fix (core/location) — parcels
// carry no lat/lng or street address in the contract — so the design's street line / "2.4 km away" / landmark
// persistence HONESTLY degrade (§13); this file never fabricates an address or distance.
import type { LandParcel, LabourLookups } from '@krishalaya/sdk-js';

export interface SavedLocationRow {
  id: string;
  /** e.g. "Plot 247" from the survey number, else a generic "Parcel N". Pure, never a fabricated street. */
  title: string;
  /** region name (resolved via lookups) + area, e.g. "Anand · 2 acre". '' when neither is known. */
  subtitle: string;
  isDefault: boolean;
  selected: boolean;
}

function regionName(regionId: string | null, lookups: LabourLookups | null): string | null {
  if (!regionId || !lookups) return null;
  return lookups.regions.find((r) => r.id === regionId)?.name ?? null;
}

/** Build the saved-location list from the farmer's parcels. The FIRST parcel is the default; `selectedId` (else the
 * default) is marked selected. Titles/subtitles use only real fields (survey no, region, area) — no invented
 * address. Pure. */
export function savedLocationRows(parcels: LandParcel[], lookups: LabourLookups | null, selectedId?: string | null): SavedLocationRow[] {
  const list = parcels ?? [];
  const effectiveSelected = selectedId ?? (list[0]?.id ?? null);
  return list.map((p, i) => {
    const title = p.surveyNo && p.surveyNo.trim() ? `Plot ${p.surveyNo.trim()}` : `Parcel ${i + 1}`;
    const region = regionName(p.regionId, lookups);
    const area = p.area && p.areaUnit ? `${p.area} ${p.areaUnit}` : null;
    const subtitle = [region, area].filter(Boolean).join(' · ');
    return { id: p.id, title, subtitle, isDefault: i === 0, selected: p.id === effectiveSelected };
  });
}

/** A GPS fix supplies the navigation coordinates the booking needs; the location step can only continue once one is
 * set (the parcel selection is context, not coordinates). Pure. */
export function canContinueLocation(fix: { lat: number; lng: number } | null | undefined): boolean {
  return !!fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng);
}

/** Trim a free-text landmark for carrying forward (helps the worker find the spot). Empty → null. Bounded to a sane
 * length so a hostile client can't push a huge string. Pure. (No booking contract field yet → carried, flagged.) */
export function normalizeLandmark(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.slice(0, 120);
}
