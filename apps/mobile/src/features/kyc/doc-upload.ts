// apps/mobile/src/features/kyc/doc-upload.ts · PURE helper for the KYC document-upload screen (174). No React/native
// — unit-tested. Resolves the seeded KYC doc-type the upload targets (passed by id from the docs list). The doc-type
// NAME is real (from the catalogue); the app never fabricates a doc-type. The server verifies/OCRs the upload (Law 11).
import type { KycDocType } from '@krishalaya/sdk-js';

/** Find the KYC doc-type by id in the seeded catalogue. Null when absent (the screen then degrades honestly rather
 * than submitting under a guessed type). Pure. */
export function resolveDocType(list: ReadonlyArray<KycDocType> | null | undefined, id: string | null | undefined): KycDocType | null {
  if (!id) return null;
  for (const d of list ?? []) if (d && d.id === id) return d;
  return null;
}
