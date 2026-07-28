// modules/insurance/gateway/http-vet-cert.gateway.ts · HTTP/JSON adapter to a configured vet-certificate
// verification endpoint. Resilience-wrapped (timeout+retry+breaker+bulkhead) with a FALLBACK
// (degrade-not-die, Law 12): an unreachable/broken provider resolves to {status:'unavailable'} (⇒ manual
// review), never a throw and never a fabricated 'verified'. Request body is OUR OWN domain shape (no real
// provider's API spec is in this repo — no partner account exists, §8).
import { Logger } from '@nestjs/common';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { VetCertProvider, VetCertVerifyInput, VetCertVerifyResult } from './vet-cert-provider.port';

const DEP = 'vet-cert-provider';

export interface HttpVetCertConfig { baseUrl: string; apiKey: string; }

export class HttpVetCertGateway implements VetCertProvider {
  readonly providerCode = 'http';
  private readonly log = new Logger('VetCertProvider');
  constructor(private readonly cfg: HttpVetCertConfig, private readonly resilience: ResilienceService) {}

  async verify(input: VetCertVerifyInput): Promise<VetCertVerifyResult> {
    return this.resilience.run<VetCertVerifyResult>(DEP, async () => {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/certificates/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey, authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({ claim_id: input.claimId, tenant_id: input.tenantId, cert_ref: input.certRef }),
      });
      const out = (await res.json().catch(() => ({}))) as any;
      if (res.status === 400 || res.status === 422) return { status: 'unavailable', failureReason: String(out?.error ?? 'rejected') };
      if (!res.ok) throw new Error(`vet-cert provider responded ${res.status}`);
      const verified = out?.verified === true;
      return { status: verified ? 'verified' : 'rejected', providerRef: out?.reference ?? out?.id };
    }, { fallback: () => { this.log.warn(`vet-cert provider unavailable for claim ${input.claimId}`); return { status: 'unavailable', failureReason: 'vet_cert_provider_unavailable' }; } });
  }
}
