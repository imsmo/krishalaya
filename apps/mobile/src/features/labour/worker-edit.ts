// apps/mobile/src/features/labour/worker-edit.ts · PURE form logic for the worker Edit-Profile screen (136). No
// React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. It validates the form and SPLITS it into
// the two real patches the server accepts: the identity profile (users.updateMe: fullName + gender + languageCode)
// and the worker prefs (WorkerPrefsInput: villageRegionId + travelKm + minWageExpectationMinor). Money is bigint
// paise (Law 2). Fields with NO contract yet (age, spoken-languages list, about-me, market wage-range) are NOT
// assembled here — the screen renders them for design parity but flags them as not-yet-persisted (§13), never
// fabricating a dob from an age or a wage range we don't have.
import type { WorkerPrefsInput } from '@krishalaya/sdk-js';

export const GENDERS = ['female', 'male', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

/** The three launch languages the design offers as speak-languages chips; the PRIMARY (first selected) maps to the
 * one real field — the account `languageCode` — since the contract has no spoken-languages list yet. */
export const LANGUAGE_CODES = ['hi', 'gu', 'en'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export interface WorkerEditForm {
  fullName?: string;
  gender?: Gender | '';
  villageRegionId?: string;
  travelKm?: string;
  dailyRateRupees?: string;
  languages?: LanguageCode[]; // multi-select in the UI; only the primary persists (languageCode)
}
export type WorkerEditField = 'name' | 'village' | 'travelKm' | 'rate';
export interface ProfilePatch { fullName?: string; gender?: Gender; languageCode?: LanguageCode }
export interface WorkerEditResult {
  ok: boolean;
  errors: WorkerEditField[];
  profilePatch: ProfilePatch;   // → users.updateMe
  workerPatch: WorkerPrefsInput; // → labour.updateWorker
}

const KM = /^\d{1,4}$/;

/** Whole-rupees → paise minor string (non-negative integer ≤ 10 digits), or undefined to reject. Pure, BigInt. */
export function dailyRateToMinor(rupees: string | undefined): string | undefined {
  const s = (rupees ?? '').trim();
  if (!/^\d{1,10}$/.test(s)) return undefined;
  try { const p = BigInt(s) * 100n; return p > 0n ? p.toString() : undefined; } catch { return undefined; }
}

/** Validate + split the edit form. Name and home-village are required (design `*`); travelKm/rate are optional but
 * must be well-formed when present. Returns the field-groups that failed so the UI can point at them. Pure. */
export function buildWorkerProfileEdit(form: WorkerEditForm): WorkerEditResult {
  const errors: WorkerEditField[] = [];
  const profilePatch: ProfilePatch = {};
  const workerPatch: WorkerPrefsInput = {};

  const name = (form.fullName ?? '').trim();
  if (name.length < 2 || name.length > 80) errors.push('name');
  else profilePatch.fullName = name;

  if (form.gender && (GENDERS as readonly string[]).includes(form.gender)) profilePatch.gender = form.gender as Gender;

  const primary = (form.languages ?? []).find((l) => (LANGUAGE_CODES as readonly string[]).includes(l));
  if (primary) profilePatch.languageCode = primary;

  const village = (form.villageRegionId ?? '').trim();
  if (!village) errors.push('village');
  else workerPatch.villageRegionId = village;

  const km = (form.travelKm ?? '').trim();
  if (km) { if (KM.test(km)) workerPatch.travelKm = Number(km); else errors.push('travelKm'); }

  const rate = (form.dailyRateRupees ?? '').trim();
  if (rate) { const minor = dailyRateToMinor(rate); if (minor) workerPatch.minWageExpectationMinor = minor; else errors.push('rate'); }

  return { ok: errors.length === 0, errors, profilePatch, workerPatch };
}

/** Toggle a language in the multi-select set, preserving order (primary = first). Pure. */
export function toggleLanguage(current: LanguageCode[], code: LanguageCode): LanguageCode[] {
  return current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
}
