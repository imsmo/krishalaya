// modules/insurance/gateway/http-pmfby.gateway.ts · HTTP/JSON adapter to a configured PMFBY-portal-shaped
// endpoint. Resilience-wrapped (timeout+retry+breaker+bulkhead) with a FALLBACK (degrade-not-die, Law 12):
// an unreachable/broken portal resolves to {status:'unavailable'}, never a throw into the caller.
//
// HONESTY NOTE (no invented govt API shape): the real PMFBY portal's actual request/response contract is
// NOT in this repository — no partner account exists (§8). The request body below is OUR OWN domain shape
// (see pmfby-provider.port.ts's PmfbyEnrolmentInput), sent as-is to whatever URL is configured. Wiring this
// to the REAL PMFBY API requires a field-mapping pass once a provider account is founder-reviewed and the
// actual API spec is obtained — until then this adapter is only exercisable against a stand-in endpoint
// that speaks this same shape (e.g. a staging mock), which is exactly what PMFBY_PORTAL_URL being unset
// (→ the noop adapter) already communicates honestly.
import { Logger } from '@nestjs/common';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import {
  PmfbyProvider, PmfbyEnrolmentInput, PmfbyEnrolmentResult, PmfbyStatusInput, PmfbyStatusResult,
} from './pmfby-provider.port';

const DEP = 'pmfby-provider';

export interface HttpPmfbyConfig { baseUrl: string; apiKey: string; }

export class HttpPmfbyGateway implements PmfbyProvider {
  readonly providerCode = 'http';
  private readonly log = new Logger('PmfbyProvider');
  constructor(private readonly cfg: HttpPmfbyConfig, private readonly resilience: ResilienceService) {}

  async submitEnrolment(input: PmfbyEnrolmentInput): Promise<PmfbyEnrolmentResult> {
    return this.resilience.run<PmfbyEnrolmentResult>(DEP, async () => {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/enrolments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey, authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          policy_id: input.policyId, tenant_id: input.tenantId, holder_user_id: input.holderUserId,
          product_code: input.productCode, sum_insured_minor: input.sumInsuredMinor, premium_minor: input.premiumMinor,
          valid_from: input.validFrom, valid_until: input.validUntil, crop_season_ref: input.cropSeasonRef ?? null,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as any;
      if (res.status === 400 || res.status === 422) return { status: 'unavailable', failureReason: String(out?.error ?? 'rejected') };
      if (!res.ok) throw new Error(`PMFBY portal responded ${res.status}`);
      return { status: 'submitted', govtApplicationRef: out?.application_ref ?? out?.id };
    }, { fallback: () => { this.log.warn(`PMFBY portal unavailable for policy ${input.policyId}`); return { status: 'unavailable', failureReason: 'pmfby_portal_unavailable' }; } });
  }

  async checkStatus(input: PmfbyStatusInput): Promise<PmfbyStatusResult> {
    return this.resilience.run<PmfbyStatusResult>(DEP, async () => {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/enrolments/${encodeURIComponent(input.govtApplicationRef)}`, {
        method: 'GET', headers: { authorization: `Bearer ${this.cfg.apiKey}` },
      });
      const out = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(`PMFBY portal responded ${res.status}`);
      return { status: 'submitted', portalStatus: out?.status ?? 'unknown' };
    }, { fallback: () => ({ status: 'unavailable', failureReason: 'pmfby_portal_unavailable' }) });
  }
}
