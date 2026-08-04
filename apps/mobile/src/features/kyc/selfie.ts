// apps/mobile/src/features/kyc/selfie.ts · PURE helper for the KYC selfie/liveness step (173). No React/native —
// unit-tested. The app captures a selfie and submits it as a KYC DOCUMENT; the actual liveness + Aadhaar-photo
// FACE-MATCH is a server/provider capability (Law 11 — the app never asserts a match). This helper only resolves
// which seeded KYC doc-type the selfie should be filed under, by matching its code — never fabricating an id.
import type { KycDocType } from '@krishalaya/sdk-js';

// Codes a selfie/liveness doc-type might carry in the seeded catalogue (server-owned controlled vocab).
const SELFIE_CODE_RE = /(selfie|liveness|live_photo|face|photo)/i;

/** Resolve the KYC doc-type id to file a selfie under, by matching its code. Returns null when the catalogue has
 * no selfie/photo type — the screen then honestly degrades (no submit under a wrong type). Pure. */
export function selfieDocType(list: ReadonlyArray<KycDocType> | null | undefined): KycDocType | null {
  for (const d of list ?? []) if (d && typeof d.code === 'string' && SELFIE_CODE_RE.test(d.code)) return d;
  return null;
}
