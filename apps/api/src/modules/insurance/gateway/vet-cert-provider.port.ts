// modules/insurance/gateway/vet-cert-provider.port.ts
// Port to an EXTERNAL veterinary-certificate verification service (DEV-25, KV-BL-057, Wave 7) — checks a
// livestock claim's vet-issued certificate (death/illness/treatment cert referenced by the claimant) against
// the issuing authority's own record. Mirrors identity's ekyc-provider.port.ts honesty contract exactly:
// Krishi-Verse owns the CLAIM + the POLICY; the provider owns the actual veterinary-registry proof. NO
// commercial provider account exists in this environment (§8) — the certificate reference passed in is
// whatever the claimant/insurer already has on file (a cert number / VCI registration, never a raw document
// upload parsed here). Adapters are resilience-wrapped and DEGRADE to 'unavailable' (never a fabricated
// 'verified' when the real provider is unset — Law 7/12: an AI/provider surface never invents a confident
// answer, it degrades to "needs manual review").
export const VET_CERT_PROVIDER = Symbol('VET_CERT_PROVIDER');

export interface VetCertVerifyInput {
  idempotencyKey: string;
  tenantId: string;
  claimId: string;
  certRef: string;                 // the vet certificate number / VCI registration cited on the claim's evidence
}

export type VetCertVerificationStatus = 'verified' | 'rejected' | 'unavailable';

export interface VetCertVerifyResult {
  status: VetCertVerificationStatus;
  providerRef?: string;            // the provider's own lookup/transaction reference
  failureReason?: string;          // present iff status === 'unavailable' (never set for a real 'rejected')
}

export interface VetCertProvider {
  readonly providerCode: string;
  verify(input: VetCertVerifyInput): Promise<VetCertVerifyResult>;
}
