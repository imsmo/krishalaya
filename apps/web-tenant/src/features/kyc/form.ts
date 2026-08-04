// apps/web-tenant/src/features/kyc/form.ts · pure validation for the KYC document submission form (PC-20).
// No IO, no SDK — unit-tested 1:1 (src/test/kyc-form.spec.ts). The masked-doc-number rule enforces the
// privacy law of this surface IN THE CLIENT PATH TOO: we never accept what looks like a full raw document
// number (Aadhaar/PAN/etc.) — at most 4 plain digits may appear (e.g. "XXXX-XXXX-1234"). The server masks
// again regardless; this check just refuses to transport raw PII in the first place.

export type KycSubmission = { docTypeId: string; mediaId: string; docNoMasked?: string };
export type BuildResult =
  | { ok: true; value: KycSubmission }
  | { ok: false; error: 'doctype' | 'docmedia' | 'docno' };

const MAX_MASKED_LEN = 32;
const MAX_PLAIN_DIGITS = 4;

/** True when the value is masked enough to transport: ≤4 digits total; rest X, x, asterisk, space, hyphen, slash. */
export function isMaskedDocNo(v: string): boolean {
  if (v.length > MAX_MASKED_LEN) return false;
  if (!/^[0-9Xx*\s/-]+$/.test(v)) return false;
  const digits = v.replace(/[^0-9]/g, '');
  return digits.length <= MAX_PLAIN_DIGITS;
}

export function buildKycSubmission(input: { docTypeId: string; mediaId: string; docNoMasked: string }): BuildResult {
  const docTypeId = input.docTypeId.trim();
  const mediaId = input.mediaId.trim();
  const docNoMasked = input.docNoMasked.trim();
  if (!docTypeId) return { ok: false, error: 'doctype' };
  if (!mediaId) return { ok: false, error: 'docmedia' };
  if (docNoMasked && !isMaskedDocNo(docNoMasked)) return { ok: false, error: 'docno' };
  const value: KycSubmission = { docTypeId, mediaId };
  if (docNoMasked) value.docNoMasked = docNoMasked;
  return { ok: true, value };
}
