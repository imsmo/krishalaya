// modules/identity/gateway/ekyc-provider.port.ts
// Port to the EXTERNAL eKYC provider (UIDAI Aadhaar OTP / DigiLocker / Karza-style). Krishalaya owns the
// POLICY (which doc types, consent, retention) + the SESSION state; the provider owns the actual identity proof.
// CONTRACT, non-negotiable:
//   • the RAW Aadhaar/PAN is passed to start() and goes NO FURTHER than the adapter — never persisted, never logged.
//   • the provider returns a VAULT REF (an opaque token standing in for the verified id) + a MASKED id; we store
//     ONLY those (Law: never store raw Aadhaar/PAN — only vault refs + last-4, masked).
//   • adapters are resilience-wrapped and DEGRADE (throw a typed EkycProviderError) rather than hang (Law 12).
export const EKYC_PROVIDER = Symbol('EKYC_PROVIDER');

export type EkycDocType = 'aadhaar' | 'pan';

export interface EkycStartInput { docType: EkycDocType; idNumber: string; fullName?: string | null; }
export interface EkycStartResult {
  providerRef: string;        // opaque session/transaction id at the provider (we bind it to the user)
  otpRequired: boolean;       // Aadhaar OTP flow → true; some PAN NSDL checks verify synchronously → false
}

export interface EkycVerifyInput { providerRef: string; otp: string; }
export interface EkycVerifyResult {
  verified: boolean;
  vaultRef?: string;          // opaque token for the verified id (what we persist) — present iff verified
  maskedId?: string;          // provider-masked id for display (we also compute our own mask defensively)
  nameMatch?: boolean;        // did the provider's name match the supplied fullName (KYC quality signal)
  validUntil?: string | null; // ISO; some providers return a credential validity
  failureReason?: string;     // when verified=false (wrong/expired OTP, mismatch, …) — never contains the raw id
}

export interface EkycProvider {
  readonly providerCode: string;
  start(input: EkycStartInput): Promise<EkycStartResult>;
  verify(input: EkycVerifyInput): Promise<EkycVerifyResult>;
}
