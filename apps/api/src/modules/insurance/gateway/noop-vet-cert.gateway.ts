// modules/insurance/gateway/noop-vet-cert.gateway.ts · default adapter when no vet-cert verification
// provider is configured (every environment today — no partner account exists, §8). DELIBERATELY STRICTER
// than the notification/masking noops (which accept in dev to unblock flow-testing): a claim SETTLEMENT
// decision may partly rest on this signal, so this adapter returns 'unavailable' (⇒ manual review) in
// EVERY environment, dev included — Law 12 ("trust surfaces render only verified truth") means a livestock
// claim's vet-cert check must never present even a synthetic "verified" as if it were real. Tests that need
// a 'verified'/'rejected' branch use a dedicated fake VetCertProvider, not this adapter.
import { Injectable, Logger } from '@nestjs/common';
import { VetCertProvider, VetCertVerifyInput, VetCertVerifyResult } from './vet-cert-provider.port';

@Injectable()
export class NoopVetCertGateway implements VetCertProvider {
  readonly providerCode = 'noop';
  private readonly log = new Logger('VetCertProvider');

  async verify(input: VetCertVerifyInput): Promise<VetCertVerifyResult> {
    this.log.warn(`vet-cert verification provider not configured; claim ${input.claimId} needs manual review`);
    return { status: 'unavailable', failureReason: 'vet_cert_provider_not_configured' };
  }
}
