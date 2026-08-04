// apps/web-ops/src/features/kiosk/form.ts · PURE validation for kiosk-assisted farmer creation (PC-31 OW-1).
// Phone E.164-ish (mirrors users.create); name optional ≤120; language limited to the platform set. The ops
// staff CREATES the account; everything personal after that (OTP login, KYC, first listing) happens in the
// FARMER'S OWN session — assisted, never impersonated (no silent on-behalf writes; consent law).
export const KIOSK_LANGS = ['hi', 'gu', 'en'] as const;

export type FarmerResult =
  | { ok: true; value: { phone: string; fullName?: string; languageCode?: string } }
  | { ok: false; error: 'phone' | 'name' | 'lang' };

export function buildFarmer(raw: { phone: string; fullName: string; languageCode: string }): FarmerResult {
  const phone = raw.phone.trim().replace(/[\s-]/g, '');
  if (!/^\+?\d{8,15}$/.test(phone)) return { ok: false, error: 'phone' };
  const fullName = raw.fullName.trim();
  if (fullName.length > 120) return { ok: false, error: 'name' };
  const languageCode = raw.languageCode.trim();
  if (languageCode && !(KIOSK_LANGS as readonly string[]).includes(languageCode)) return { ok: false, error: 'lang' };
  const value: { phone: string; fullName?: string; languageCode?: string } = { phone };
  if (fullName) value.fullName = fullName;
  if (languageCode) value.languageCode = languageCode;
  return { ok: true, value };
}
