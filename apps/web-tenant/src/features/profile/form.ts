// apps/web-tenant/src/features/profile/form.ts · PURE helpers for the KYC + profile page. No framework, no I/O →
// unit-tested. buildProfilePatch validates the "edit my profile" form and assembles the PII-minimal PATCH payload
// the SDK's users.updateMe accepts (dropping blank fields so a partial edit only sends what changed); kycStatusKey
// maps a KYC document status to a known i18n key (guarding against an unexpected server value). No raw doc numbers
// are ever handled here — the page renders only the server-masked `docNoMasked`.
import type { KycStatus } from '@krishalaya/sdk-js';

/** Languages the console ships (mirrors @krishalaya/i18n LANGUAGES); the API re-validates regardless. */
export const PROFILE_LANGUAGES = ['hi', 'en', 'gu'] as const;
/** Genders the SDK's users.updateMe accepts. */
export const PROFILE_GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;
export type ProfileGender = (typeof PROFILE_GENDERS)[number];

export type ProfilePatch = {
  fullName?: string;
  gender?: ProfileGender;
  dob?: string;
  languageCode?: string;
  email?: string;
  photoMediaId?: string;
};

export type ProfilePatchResult =
  | { ok: true; value: ProfilePatch }
  | { ok: false; error: 'email' | 'dob' | 'gender' | 'language' | 'empty' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate + assemble the profile PATCH. Every field is optional; blanks are dropped. A submission with nothing
 *  to change is rejected ('empty') so we never fire a no-op write. The API re-enforces all of this server-side. */
export function buildProfilePatch(raw: {
  fullName?: string; gender?: string; dob?: string; languageCode?: string; email?: string; photoMediaId?: string;
}): ProfilePatchResult {
  const value: ProfilePatch = {};

  const fullName = (raw.fullName ?? '').trim();
  if (fullName) value.fullName = fullName;

  const email = (raw.email ?? '').trim();
  if (email) {
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'email' };
    value.email = email;
  }

  const dob = (raw.dob ?? '').trim();
  if (dob) {
    if (!DOB_RE.test(dob) || Number.isNaN(Date.parse(dob))) return { ok: false, error: 'dob' };
    value.dob = dob;
  }

  const gender = (raw.gender ?? '').trim();
  if (gender) {
    if (!(PROFILE_GENDERS as readonly string[]).includes(gender)) return { ok: false, error: 'gender' };
    value.gender = gender as ProfileGender;
  }

  const languageCode = (raw.languageCode ?? '').trim();
  if (languageCode) {
    if (!(PROFILE_LANGUAGES as readonly string[]).includes(languageCode)) return { ok: false, error: 'language' };
    value.languageCode = languageCode;
  }

  const photoMediaId = (raw.photoMediaId ?? '').trim();
  if (photoMediaId) value.photoMediaId = photoMediaId;

  if (Object.keys(value).length === 0) return { ok: false, error: 'empty' };
  return { ok: true, value };
}

const KYC_STATUSES: readonly KycStatus[] = ['pending', 'verified', 'rejected', 'expired'];

/** Map a KYC document status to a known i18n sub-key, falling back to 'pending' for an unexpected server value
 *  (so the badge never renders a raw/missing key). */
export function kycStatusKey(status: string | null | undefined): KycStatus {
  return (KYC_STATUSES as readonly string[]).includes(status ?? '') ? (status as KycStatus) : 'pending';
}
