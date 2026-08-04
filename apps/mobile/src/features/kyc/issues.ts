// apps/mobile/src/features/kyc/issues.ts · PURE helper for the KYC re-submission screen (175). No React/native —
// unit-tested. Builds the "what to fix" list from the caller's REJECTED KYC documents: each carries a real
// server-written rejection reason + (optionally) its doc-type id, which we resolve to a real name from the
// catalogue. §13: nothing here is fabricated — an issue exists only if the server rejected a real document.
import type { KycDocument, KycDocType } from '@krishalaya/sdk-js';
import { resolveDocType } from './doc-upload';

export interface KycIssue { id: string; docTypeId: string | null; docTypeName: string | null; reason: string | null }

/** Map rejected KYC documents → issues (real reason + resolved type name). Non-rejected docs are excluded. Pure. */
export function buildKycIssues(
  docs: ReadonlyArray<KycDocument> | null | undefined,
  docTypes: ReadonlyArray<KycDocType> | null | undefined,
): KycIssue[] {
  const out: KycIssue[] = [];
  for (const d of docs ?? []) {
    if (!d || d.status !== 'rejected') continue;
    out.push({
      id: d.id,
      docTypeId: d.docTypeId ?? null,
      docTypeName: resolveDocType(docTypes, d.docTypeId)?.name ?? null,
      reason: d.rejectReason ?? null,
    });
  }
  return out;
}
