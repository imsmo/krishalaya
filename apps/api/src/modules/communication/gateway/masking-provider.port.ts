// modules/communication/gateway/masking-provider.port.ts
// Port to the EXTERNAL number-masking telephony provider (Exotel/Knowlarity-style). It bridges a call between
// two users WITHOUT either seeing the other's number — the provider owns the phone directory, so Krishalaya
// passes only user ids + context and NEVER persists raw phone numbers (PII stays with the provider). Adapters
// are resilience-wrapped and DEGRADE (return ok:false) rather than throw — a hung telco must not cascade.
export const MASKING_PROVIDER = Symbol('MASKING_PROVIDER');

export interface BridgeInput { idempotencyKey: string; tenantId: string | null; callerUserId: string; calleeUserId: string; contextType: string | null; contextId: string | null; }
export interface BridgeResult { ok: boolean; providerCallRef?: string; failureReason?: string; }

export interface MaskingProvider {
  readonly providerCode: string;
  bridge(input: BridgeInput): Promise<BridgeResult>;
}
