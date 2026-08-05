// apps/mobile/src/features/equipment/equipment.ts · PURE equipment-owner logic (PC-50 W10-6; design canon
// screens 308–312). Mirrors the rental state machine (requested → quoted → confirmed → in_progress →
// completed → settled; cancel pre-start) — the SAME gates web-ops proved (features/equipment/manage.ts) —
// plus zod-mirror builders for asset registration and rate lines. Money rupees→minor by string math (Law 2).
import { rupeesToMinor } from '../vet/vet';

export const RENTAL_STATUSES = ['requested', 'quoted', 'confirmed', 'in_progress', 'completed', 'settled', 'cancelled'] as const;
export const RATE_BASES = ['per_hour', 'per_acre', 'per_day', 'per_job', 'per_km'] as const;
export const ASSET_STATUSES = ['active', 'maintenance', 'retired'] as const;
export type OwnerAction = 'quote' | 'start' | 'complete' | 'settle' | 'cancel';

/** Owner-legal actions per status. CONFIRM is the RENTER's move (their consent, their wallet) — never here. */
export function ownerActionsFor(status: string | undefined | null): OwnerAction[] {
  switch (status) {
    case 'requested': return ['quote', 'cancel'];
    case 'quoted': return ['cancel'];            // waiting on the renter's confirm
    case 'confirmed': return ['start', 'cancel']; // start needs the RENTER's OTP (presence proof)
    case 'in_progress': return ['complete'];
    case 'completed': return ['settle'];
    default: return []; // settled / cancelled
  }
}
export function rentalTone(status: string | undefined): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'settled') return 'success';
  if (status === 'cancelled') return 'danger';
  if (status === 'requested') return 'neutral';
  if (status === 'completed') return 'info';
  return 'warning';
}
export function assetTone(status: string | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status === 'maintenance' ? 'warning' : status === 'retired' ? 'danger' : 'neutral';
}

export type AssetDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'category' | 'regno' | 'year' | 'hours' | 'hp' | 'radius' };

/** Mirrors CreateAssetSchema.strict(): categoryId required; empty optionals OMITTED. */
export function buildAssetDraft(raw: { categoryId: string; regNo: string; yearOfMfg: string; engineHours: string; hpRating: string; serviceRadiusKm: string }): AssetDraftResult {
  if (!raw.categoryId) return { ok: false, error: 'category' };
  const out: Record<string, unknown> = { categoryId: raw.categoryId };
  const regNo = raw.regNo.trim();
  if (regNo) { if (regNo.length > 20) return { ok: false, error: 'regno' }; out.regNo = regNo; }
  const year = raw.yearOfMfg.trim();
  if (year) {
    const n = Number(year);
    if (!/^\d{4}$/.test(year) || n < 1950 || n > 2100) return { ok: false, error: 'year' };
    out.yearOfMfg = n;
  }
  const hours = raw.engineHours.trim();
  if (hours) { if (!/^\d{1,9}(\.\d)?$/.test(hours)) return { ok: false, error: 'hours' }; out.engineHours = hours; }
  const hp = raw.hpRating.trim();
  if (hp) {
    const n = Number(hp);
    if (!/^\d+$/.test(hp) || n < 1 || n > 2000) return { ok: false, error: 'hp' };
    out.hpRating = n;
  }
  const radius = raw.serviceRadiusKm.trim();
  if (radius) {
    const n = Number(radius);
    if (!/^\d+$/.test(radius) || n > 1000) return { ok: false, error: 'radius' };
    out.serviceRadiusKm = n;
  }
  return { ok: true, value: out };
}

export type RateDraftResult =
  | { ok: true; value: { rateBasis: string; rateMinor: string; includesOperator: boolean; includesFuel: boolean } }
  | { ok: false; error: 'basis' | 'rate' };

/** Mirrors CreateRateSchema.strict(): a real basis + a float-free positive rate. */
export function buildRateDraft(raw: { rateBasis: string; rateRupees: string; includesOperator: boolean; includesFuel: boolean }): RateDraftResult {
  if (!(RATE_BASES as readonly string[]).includes(raw.rateBasis)) return { ok: false, error: 'basis' };
  const rateMinor = rupeesToMinor(raw.rateRupees);
  if (!rateMinor) return { ok: false, error: 'rate' };
  return { ok: true, value: { rateBasis: raw.rateBasis, rateMinor, includesOperator: raw.includesOperator, includesFuel: raw.includesFuel } };
}
