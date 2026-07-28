// apps/mobile/src/features/labour/pmsby-enroll.ts · PURE logic for the worker PMSBY-enrolment screen (145). No
// React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. It holds the PMSBY statutory money
// constants (public government-scheme facts — same for every worker, bigint minor per Law 2 — NOT per-user data),
// the nominee-relationship options, the nominee-form validators (name/optional-Aadhaar), and the REAL eligibility
// derivation from the worker profile + bank accounts + verified Aadhaar KYC.
// DEV-24 (KV-BL-055): the enrolment/premium-payment endpoints are now REAL (`apps/api/src/modules/insurance`,
// DEV-22/23) — `pmsbyCoverageWindow()` adds the pure ISO date-range helper the screen needs to call
// `POST /v1/insurance/policies` (`validFrom`/`validUntil`), matching PMSBY's real annual cycle (1 June - 31 May,
// per screen 145's own auto-debit mandate copy "on 1 June each year").
import type { WorkerProfile, BankAccount, KycDocument, KycDocType } from '@krishi-verse/sdk-js';

// PMSBY statutory figures (public scheme constants — bigint minor, Law 2; not per-user/seed data).
export const PMSBY_COVER_MINOR = '20000000';   // ₹2,00,000 accidental death / total disability
export const PMSBY_PARTIAL_MINOR = '10000000'; // ₹1,00,000 partial disability
export const PMSBY_PREMIUM_MINOR = '2000';     // ₹20 / year

/** Nominee relationship options, in design order → i18n `pmsbyEnroll.rel.<key>`. */
export const NOMINEE_RELATIONSHIPS = ['spouse', 'father', 'mother', 'son', 'daughter', 'sibling', 'other'] as const;
export type NomineeRelationship = (typeof NOMINEE_RELATIONSHIPS)[number];

/** Trim + collapse the nominee name, cap length, empty → null. Pure. */
export function normalizeNomineeName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.slice(0, 100);
}

/** Keep only digits, cap at 12 (an Aadhaar number). Pure. Never stored raw beyond this transient field (§4). */
export function normalizeAadhaar(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, 12);
}

/** Aadhaar is OPTIONAL here: valid when blank OR exactly 12 digits. Pure. */
export function isAadhaarValidOptional(raw: string | null | undefined): boolean {
  const d = normalizeAadhaar(raw);
  return d.length === 0 || d.length === 12;
}

/** Enroll enables once a nominee name + a valid relationship are set and any Aadhaar entered is well-formed. Pure. */
export function canEnroll(name: string | null | undefined, rel: NomineeRelationship | null | undefined, aadhaar?: string | null): boolean {
  const okName = !!normalizeNomineeName(name);
  const okRel = !!rel && NOMINEE_RELATIONSHIPS.some((r) => r === rel);
  return okName && okRel && isAadhaarValidOptional(aadhaar);
}

export interface PmsbyEligibility { ageOk: boolean; bankOk: boolean; aadhaarOk: boolean; qualifies: boolean; }

/** REAL eligibility: 18+ (age-verified worker), a linked bank account (auto-debit source), and a verified Aadhaar
 * KYC doc. All three → qualifies. Pure. */
export function pmsbyEligibility(
  worker: WorkerProfile | null | undefined,
  banks: readonly BankAccount[] | null | undefined,
  docTypes: readonly KycDocType[] | null | undefined,
  kyc: readonly KycDocument[] | null | undefined,
): PmsbyEligibility {
  const ageOk = !!worker?.ageVerified18;
  const bankOk = (banks ?? []).some((b) => b.accountKind === 'bank');
  const aadhaarType = (docTypes ?? []).find((d) => d.code.toLowerCase().includes('aadhaar'));
  const aadhaarOk = !!aadhaarType && (kyc ?? []).some((k) => k.docTypeId === aadhaarType.id && k.status === 'verified');
  return { ageOk, bankOk, aadhaarOk, qualifies: ageOk && bankOk && aadhaarOk };
}

/** PMSBY's real annual cover cycle: 1 June - 31 May (screen 145's own mandate copy: "auto-debited ... on 1 June
 * each year"). Pure, deterministic given `now` (unit-tested; the screen always calls with `new Date()`). If
 * today is on/after 1 June, the current cycle runs this-year-June → next-year-May; otherwise the cycle already
 * in force runs last-year-June → this-year-May. Returned as `YYYY-MM-DD` (the API's `isoDate` DTO shape). */
export function pmsbyCoverageWindow(now: Date = new Date()): { validFrom: string; validUntil: string } {
  const y = now.getUTCFullYear();
  const juneFirstThisYear = Date.UTC(y, 5, 1); // month 5 = June (0-indexed)
  const startYear = now.getTime() >= juneFirstThisYear ? y : y - 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${pad(mm)}-${pad(dd)}`;
  return { validFrom: iso(startYear, 6, 1), validUntil: iso(startYear + 1, 5, 31) };
}
