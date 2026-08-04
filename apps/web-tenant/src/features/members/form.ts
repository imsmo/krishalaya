// apps/web-tenant/src/features/members/form.ts · PURE validation for the members surface (PC-28). Mirrors
// CreateTierSchema (code /^[A-Za-z0-9_]{2,40}$/, name 2–120, fees non-negative integer minor strings). Money
// parsed float-free. No IO → unit-tested.
import { parseMajorToMinor } from '../listings/form';

export type TierResult =
  | { ok: true; value: { code: string; defaultName: string; monthlyFeeMinor: string; annualFeeMinor?: string } }
  | { ok: false; error: 'code' | 'name' | 'fee' };

export function buildTier(raw: { code: string; name: string; monthlyMajor: string; annualMajor: string }): TierResult {
  const code = raw.code.trim();
  if (!/^[A-Za-z0-9_]{2,40}$/.test(code)) return { ok: false, error: 'code' };
  const defaultName = raw.name.trim();
  if (defaultName.length < 2 || defaultName.length > 120) return { ok: false, error: 'name' };
  const monthlyFeeMinor = raw.monthlyMajor.trim() === '' ? '0' : parseMajorToMinor(raw.monthlyMajor);
  if (monthlyFeeMinor === undefined) return { ok: false, error: 'fee' };
  const value: { code: string; defaultName: string; monthlyFeeMinor: string; annualFeeMinor?: string } =
    { code, defaultName, monthlyFeeMinor };
  const annual = raw.annualMajor.trim();
  if (annual) {
    const annualFeeMinor = parseMajorToMinor(annual);
    if (annualFeeMinor === undefined) return { ok: false, error: 'fee' };
    value.annualFeeMinor = annualFeeMinor;
  }
  return { ok: true, value };
}

/** Roster statuses offered by the filter (server validates; unknown → dropped). */
export const MEMBERSHIP_STATUSES = ['active', 'expired', 'cancelled', 'pending'] as const;
export function isMembershipStatus(v: string | undefined | null): boolean {
  return !!v && (MEMBERSHIP_STATUSES as readonly string[]).includes(v);
}
