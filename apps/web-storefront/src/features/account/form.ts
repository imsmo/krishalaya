// apps/web-storefront/src/features/account/form.ts · PURE validation for the buyer /account surface (PC-24b):
// the PII-minimal profile patch + the address-book create form. No IO → unit-tested. The server re-validates
// everything; empty optional fields are DROPPED (never sent as empty strings).

export type ProfilePatch = { fullName?: string; email?: string; languageCode?: string };
export type ProfileResult = { ok: true; value: ProfilePatch } | { ok: false; error: 'email' | 'empty' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function buildProfilePatch(raw: { fullName?: string; email?: string; languageCode?: string }): ProfileResult {
  const value: ProfilePatch = {};
  const fullName = (raw.fullName ?? '').trim();
  const email = (raw.email ?? '').trim();
  const languageCode = (raw.languageCode ?? '').trim();
  if (fullName) value.fullName = fullName;
  if (email) {
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'email' };
    value.email = email;
  }
  if (languageCode) value.languageCode = languageCode;
  if (Object.keys(value).length === 0) return { ok: false, error: 'empty' };
  return { ok: true, value };
}

export type AddressInput = {
  line1: string; line2?: string; village?: string; pincode?: string;
  contactName?: string; contactPhone?: string; isDefault?: boolean;
};
export type AddressResult = { ok: true; value: AddressInput } | { ok: false; error: 'line1' | 'pincode' | 'phone' };

/** What an address FORM hands in: every field optional (validation below decides what's acceptable), and
 *  `isDefault` a real boolean. NOT `Record<string, string|undefined> & { isDefault?: boolean }` — that
 *  intersection is unsatisfiable, because the index signature requires EVERY property to be a string, so a
 *  boolean `isDefault` can never conform and every caller fails to typecheck. */
export type AddressFormInput = {
  line1?: string; line2?: string; village?: string; pincode?: string;
  contactName?: string; contactPhone?: string; isDefault?: boolean;
};

export function buildAddress(raw: AddressFormInput): AddressResult {
  const line1 = (raw.line1 ?? '').trim();
  if (line1.length < 3) return { ok: false, error: 'line1' };
  const pincode = (raw.pincode ?? '').trim();
  if (pincode && !/^\d{6}$/.test(pincode)) return { ok: false, error: 'pincode' };
  const contactPhone = (raw.contactPhone ?? '').trim();
  if (contactPhone && !/^\+?\d{8,15}$/.test(contactPhone.replace(/[\s-]/g, ''))) return { ok: false, error: 'phone' };
  const value: AddressInput = { line1 };
  const line2 = (raw.line2 ?? '').trim(); if (line2) value.line2 = line2;
  const village = (raw.village ?? '').trim(); if (village) value.village = village;
  if (pincode) value.pincode = pincode;
  const contactName = (raw.contactName ?? '').trim(); if (contactName) value.contactName = contactName;
  if (contactPhone) value.contactPhone = contactPhone.replace(/[\s-]/g, '');
  if (raw.isDefault) value.isDefault = true;
  return { ok: true, value };
}
