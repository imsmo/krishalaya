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

// PC-56 HOTFIX-10 · H10-1 (survey OPS-1 F-1 / C-6, founder Q9-A). What the kiosk prints after `users.create`. The API used to answer an
// existing phone with 200 and THAT PERSON'S profile, so this page said "Account created" for somebody who already existed. Now the API's
// only success is 201 (a fresh account) and an existing phone is 409 `USER_PHONE_ALREADY_REGISTERED` with nothing about the person:
//   resolved (the 201)                          → 'created'  ("Account created")
//   409 USER_PHONE_ALREADY_REGISTERED            → 'exists'   ("This number already has an account. She signs in herself, on her own phone.")
//   anything else (incl. another 409, e.g. a key still in flight) → 'create' (the generic "couldn't create" — never a false "exists")
// The SDK hands back the body only, so "resolved" stands for the 201; the sentence printed never comes from the response.
export const PHONE_ALREADY_REGISTERED = 'USER_PHONE_ALREADY_REGISTERED';
export type KioskOutcome = 'created' | 'exists' | 'create';
export function kioskCreateOutcome(r: { ok: true } | { ok: false; status?: number; code?: string }): KioskOutcome {
  if (r.ok) return 'created';
  return r.status === 409 && r.code === PHONE_ALREADY_REGISTERED ? 'exists' : 'create';
}
