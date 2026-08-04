// apps/mobile/src/features/kyc/kyc.api.ts · KYC data layer. Lists the caller's KYC docs + statuses + the doc-type
// catalogue (reads, degrade-never-die) and submits a new doc (idempotent). A submission references an uploaded
// media id (the doc photo, via core/media) — raw doc numbers are NEVER sent (only an optional masked value). The
// eKYC (Aadhaar/PAN provider) flow lives on the SDK too; review/verification is server/admin-only.
import type { KycDocument, KycDocType, EkycStartResult, EkycVerifyResult, BusinessKycStatus, BusinessType } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

/** The caller's KYC documents + statuses. Degrades to [] on failure. */
export async function listKyc(status?: string): Promise<KycDocument[]> {
  try { return await apiClient().kyc.list(status); }
  catch { return []; }
}

/** The seeded KYC document-type catalogue (id + code + localized name) to enumerate uploadable docs (screen 133).
 * Degrades to [] so the Documents section simply shows nothing rather than crashing. */
export async function kycDocTypes(): Promise<KycDocType[]> {
  try { return await apiClient().kyc.docTypes(); }
  catch { return []; }
}

/** Submit a KYC document (docTypeId + uploaded mediaId). Idempotent. Throws on a real client/validation error. */
export async function submitKyc(input: { docTypeId: string; mediaId: string; roleId?: string; docNoMasked?: string }): Promise<{ id: string }> {
  return apiClient().kyc.submit(input, newId());
}

/** Begin Aadhaar eKYC (screen 72). The RAW Aadhaar number is sent ONLY here; the server validates it, hands it to
 * the UIDAI provider, and persists ONLY a masked value + session ref (§4/DPDP — we never store/log the raw id).
 * Idempotent (Law 3). Returns the session id + whether an OTP is required. Throws on a real error so the screen can
 * surface a precise, friendly message (the SERVER is the authority on validity/eligibility). */
export async function startAadhaarEkyc(idNumber: string, fullName?: string): Promise<EkycStartResult> {
  return apiClient().kyc.startEkyc({ docType: 'aadhaar', idNumber, fullName }, newId());
}

/** Submit the OTP for an eKYC session (screen 73). Idempotent. On success the credential is tokenised server-side. */
export async function verifyAadhaarEkyc(sessionId: string, otp: string): Promise<EkycVerifyResult> {
  return apiClient().kyc.verifyEkyc({ sessionId, otp }, newId());
}

// --- Business KYC (screen 133, P0-5). The RAW gstin/pan are sent ONCE on submit; the server masks them and only
// ever returns masked values. Degrade-never-die read; submit throws on a real validation error so the screen shows it. ---
const EMPTY_BUSINESS_KYC: BusinessKycStatus = { status: 'none', businessType: null, legalName: null, gstinMasked: null, panMasked: null, docMediaIds: [], rejectReason: null, reviewedAt: null, submittedAt: null };
/** The caller's OWN business-KYC status (masked). Degrades to a `status:'none'` shell so the form starts empty. */
export async function businessKycStatus(): Promise<BusinessKycStatus> {
  try { return await apiClient().kyc.businessStatus(); } catch { return EMPTY_BUSINESS_KYC; }
}
/** Submit (or re-submit) the caller's business-KYC profile. Server validates + masks GSTIN/PAN; throws on error. */
export async function submitBusinessKyc(input: { businessType: BusinessType; legalName: string; pan: string; gstin?: string; docMediaIds?: string[] }): Promise<BusinessKycStatus> {
  return apiClient().kyc.submitBusiness(input);
}
