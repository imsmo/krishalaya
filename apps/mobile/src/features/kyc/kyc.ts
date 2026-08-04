// apps/mobile/src/features/kyc/kyc.ts · PURE KYC presentation logic (no React/native; SDK types are `import type`
// → erased) → unit-tested. Maps the caller's submitted docs onto the doc-type catalogue for the upload screen.
import type { KycDocument, KycStatus } from '@krishalaya/sdk-js';

/** The status of the caller's most-recent submission for a given doc type, or null if they haven't submitted one.
 * Drives each Documents row on screen 133 (Uploaded/Verified/Pending vs an empty "Upload" affordance). Pure. */
export function kycStatusFor(docs: ReadonlyArray<Pick<KycDocument, 'docTypeId' | 'status'>>, docTypeId: string): KycStatus | null {
  const d = docs.find((x) => x.docTypeId === docTypeId);
  return d ? d.status : null;
}

// --- Business KYC (P0-5): pure client-side field validation. The SERVER re-validates + masks; we only pre-check
// shape so the buyer gets instant feedback and we never send obvious garbage. Raw values are sent ONCE on submit. ---
export const BUSINESS_TYPES = ['proprietorship', 'partnership', 'pvt_ltd', 'llp', 'fpo', 'cooperative', 'trader', 'huf', 'other'] as const;
export type BusinessTypeValue = (typeof BUSINESS_TYPES)[number];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function isValidGstin(raw: string): boolean { return GSTIN_RE.test((raw ?? '').trim().toUpperCase()); }
export function isValidPan(raw: string): boolean { return PAN_RE.test((raw ?? '').trim().toUpperCase()); }

/** Can the business-KYC form be submitted? PAN + a ≥2-char legal name + business type are mandatory; GSTIN, when
 * entered, must be valid AND embed the same PAN (chars 3-12). Pure — drives the Submit button's disabled state. */
export function canSubmitBusinessKyc(input: { businessType: string; legalName: string; pan: string; gstin?: string }): boolean {
  if (!(BUSINESS_TYPES as readonly string[]).includes(input.businessType)) return false;
  if ((input.legalName ?? '').trim().length < 2) return false;
  if (!isValidPan(input.pan)) return false;
  const g = (input.gstin ?? '').trim();
  if (g.length === 0) return true;                          // GSTIN optional (below-threshold buyers)
  return isValidGstin(g) && g.toUpperCase().slice(2, 12) === input.pan.trim().toUpperCase();
}
