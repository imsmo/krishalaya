// apps/mobile/src/features/schemes/schemes.api.ts · data layer for the govt-schemes vertical (P-21). Keeps screens
// thin (guide §3). The scheme catalogue + detail are read through the SWR cache (slow-changing reference data →
// usable offline). Eligibility check + lifecycle writes (apply/submit/resubmit/appeal) hit the server and THROW so
// the screen shows the precise outcome (idempotent — Law 3; a paid scheme fee / DBT moves money SERVER-SIDE, never
// here — Law 11). Document upload reuses the core/media pipeline (P-01: pick → process/EXIF-drop → presign → PUT →
// confirm) and returns a mediaId. Reads degrade-never-die (empty/null). Money is bigint minor strings (Law 2).
import type { Scheme, SchemeAuthority, SchemeApplication, EligibilityResult, DbtTransfer, SchemeApplicationDocument } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';
import { processImage, uploadProcessed, type PickedImage } from '../../core/media';
import type { EligibilityInput } from './schemes';

const CATALOGUE_SCOPE = 'public'; // the scheme catalogue is global (not user-private)
export interface ApplicationsPage { items: SchemeApplication[]; nextCursor: string | null }

// --- catalogue (cached → offline) ---
export async function listSchemes(categoryId?: string): Promise<Scheme[]> {
  try {
    const { value } = await cache.read<Scheme[]>({
      scope: CATALOGUE_SCOPE, ns: 'schemes', parts: [categoryId ?? 'all'], policy: POLICY.reference,
      fetcher: () => apiClient().schemes.list({ categoryId, activeOnly: true }),
    });
    return value;
  } catch { return []; }
}
/** The scheme AUTHORITIES (id→name lookup for the catalogue cards). Reference data → cached. Degrades to []. */
export async function listAuthorities(): Promise<SchemeAuthority[]> {
  try {
    const { value } = await cache.read<SchemeAuthority[]>({
      scope: CATALOGUE_SCOPE, ns: 'schemes.authorities', parts: ['all'], policy: POLICY.reference,
      fetcher: () => apiClient().schemes.authorities(),
    });
    return value;
  } catch { return []; }
}

export async function getScheme(id: string): Promise<Scheme | null> {
  try {
    const { value } = await cache.read<Scheme>({
      scope: CATALOGUE_SCOPE, ns: 'schemes.detail', parts: [id], policy: POLICY.reference,
      fetcher: () => apiClient().schemes.get(id),
    });
    return value;
  } catch { return null; }
}

/** Explainable eligibility check (server-evaluated). Null on failure → the screen shows a retry. */
export async function checkEligibility(id: string, input: EligibilityInput): Promise<EligibilityResult | null> {
  try { return await apiClient().schemes.checkEligibility(id, input); } catch { return null; }
}

// --- the caller's own applications ---
export async function myApplications(cursor?: string): Promise<ApplicationsPage> {
  try { return await apiClient().schemes.myApplications({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getApplication(id: string): Promise<SchemeApplication | null> {
  try { return await apiClient().schemes.getApplication(id); } catch { return null; }
}
export async function dbtTransfers(id: string): Promise<DbtTransfer[]> {
  try { return await apiClient().schemes.dbtTransfers(id); } catch { return []; }
}

// --- lifecycle mutations (throw on a real error so the screen shows the precise outcome) ---
export function applyToScheme(input: { schemeId: string; formData: Record<string, unknown> }): Promise<SchemeApplication> {
  return apiClient().schemes.apply(input, newId());
}
export function submitApplication(id: string): Promise<SchemeApplication> {
  return apiClient().schemes.submitApplication(id, newId());
}
export function resubmitApplication(id: string): Promise<SchemeApplication> { return apiClient().schemes.resubmit(id); }
export function appealApplication(id: string): Promise<SchemeApplication> { return apiClient().schemes.appeal(id); }

/** A presigned, time-bounded URL to view an attached document (only for a clean asset). Null on failure. */
export async function schemeDocUrl(mediaId: string): Promise<string | null> {
  try { return (await apiClient().media.downloadUrl(mediaId)).url; } catch { return null; }
}

/** Upload one supporting document via the media pipeline; returns a mediaId (or null if it had to queue offline /
 * failed — the caller keeps the doc unattached and can retry). EXIF is dropped + the image downscaled in process. */
export async function uploadSchemeDocument(picked: PickedImage): Promise<string | null> {
  try {
    const processed = await processImage(picked);
    const outcome = await uploadProcessed(processed, { kind: 'document' });
    return outcome.mediaId;
  } catch { return null; }
}

// --- supporting documents (P1-16): link uploaded media to the application against a required doc type ---
/** The application's attached documents. Degrades to [] (offline / not yet live). */
export async function applicationDocuments(id: string): Promise<SchemeApplicationDocument[]> {
  try { return await apiClient().schemes.listDocuments(id); } catch { return []; }
}
/** Attach an uploaded document (mediaId) to the application. Throws on a real error so the screen shows the outcome. */
export function attachSchemeDocument(applicationId: string, mediaId: string, docTypeId?: string): Promise<SchemeApplicationDocument> {
  return apiClient().schemes.attachDocument(applicationId, { mediaId, docTypeId });
}
/** Detach a previously-attached document (only while the application is still editable). */
export async function detachSchemeDocument(applicationId: string, documentId: string): Promise<boolean> {
  try { const r = await apiClient().schemes.detachDocument(applicationId, documentId); return r.ok; } catch { return false; }
}
