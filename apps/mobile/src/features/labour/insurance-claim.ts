// apps/mobile/src/features/labour/insurance-claim.ts · PURE logic for the worker File-Insurance-Claim screen (146).
// No React / no SDK I/O → unit-tested. It holds the claim-type options, the required-document checklist, and the
// incident-form validators.
// DEV-24 (KV-BL-055): `POST /v1/insurance/claims` is now REAL (DEV-23) and requires an `eventTypeCode` drawn from
// the platform-wide `claim_event` lookup vocabulary (`drought|flood|hail|pest|death|theft|fire|accident` — seeded
// in `0005_lookup_vocabularies.sql`, shared across every insurance vertical, never invented per-module). This
// screen's own claim types (`injury`/`death`) map onto that vocabulary via `CLAIM_EVENT_CODE` below — worker
// accidental-injury claims are the platform's generic `accident` event; death is a direct 1:1 match.

/** Claim types, in design order → i18n `insuranceClaim.type.<key>.title` / `.sub`. */
export const CLAIM_TYPES = [
  { key: 'injury', icon: '🚑' },
  { key: 'death', icon: '⚱' },
] as const;
export type ClaimTypeKey = (typeof CLAIM_TYPES)[number]['key'];

/** Maps this screen's own claim-type key onto the shared `claim_event` lookup CODE the API's
 * `CreateInsuranceClaimSchema.eventTypeCode` expects (resolved server-side to `event_type_id` — never a raw
 * UUID from the client). Pure, exhaustive over `ClaimTypeKey`. */
export const CLAIM_EVENT_CODE: Record<ClaimTypeKey, string> = {
  injury: 'accident',
  death: 'death',
};

/** Supporting documents, in design order. `required` drives the `*` marker + submit gate. */
export const CLAIM_DOCS = [
  { key: 'fir', icon: '📄', required: false },
  { key: 'hospital', icon: '🏥', required: true },
  { key: 'disability', icon: '📋', required: true },
] as const;
export type ClaimDocKey = (typeof CLAIM_DOCS)[number]['key'];

/** Trim + collapse the incident description, cap length, empty → null. Pure. */
export function normalizeClaimText(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.slice(0, 2000);
}

/** A date string is present + shaped like YYYY-MM-DD (client UX check; the server re-validates). Pure. */
export function isIncidentDateValid(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Submit enables once a claim type is chosen, the incident date is well-formed, and a description of ≥10 chars is
 * written (support needs detail to act). Pure. Document uploads have no endpoint yet (§13) so they don't gate here. */
export function canSubmitClaim(
  type: ClaimTypeKey | null | undefined,
  dateIso: string | null | undefined,
  description: string | null | undefined,
): boolean {
  const okType = !!type && CLAIM_TYPES.some((c) => c.key === type);
  return okType && isIncidentDateValid(dateIso) && (normalizeClaimText(description)?.length ?? 0) >= 10;
}
