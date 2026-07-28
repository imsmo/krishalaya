// modules/insurance/gateway/http-surveyor-dispatch.gateway.ts · HTTP/JSON adapter to a configured
// surveyor-network dispatch endpoint. Resilience-wrapped (timeout+retry+breaker+bulkhead) with a FALLBACK
// (degrade-not-die, Law 12): an unreachable/broken network resolves to {status:'unavailable'}, never a
// throw into the caller. Request body is OUR OWN domain shape (no real surveyor-network API spec is in
// this repo — no partner account exists, §8); wiring to a REAL network's actual contract is provider-
// onboarding work, not invented here.
import { Logger } from '@nestjs/common';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { SurveyorDispatchGateway, SurveyorDispatchInput, SurveyorDispatchResult } from './surveyor-dispatch.port';

const DEP = 'surveyor-dispatch-gateway';

export interface HttpSurveyorDispatchConfig { baseUrl: string; apiKey: string; }

export class HttpSurveyorDispatchGateway implements SurveyorDispatchGateway {
  readonly providerCode = 'http';
  private readonly log = new Logger('SurveyorDispatchGateway');
  constructor(private readonly cfg: HttpSurveyorDispatchConfig, private readonly resilience: ResilienceService) {}

  async dispatch(input: SurveyorDispatchInput): Promise<SurveyorDispatchResult> {
    return this.resilience.run<SurveyorDispatchResult>(DEP, async () => {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/dispatches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey, authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          claim_id: input.claimId, policy_id: input.policyId, tenant_id: input.tenantId,
          surveyor_user_id: input.surveyorUserId, is_reassignment: input.isReassignment,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as any;
      if (res.status === 400 || res.status === 422) return { status: 'unavailable', failureReason: String(out?.error ?? 'rejected') };
      if (!res.ok) throw new Error(`surveyor-network responded ${res.status}`);
      return { status: 'dispatched', providerDispatchRef: out?.dispatch_ref ?? out?.id };
    }, { fallback: () => { this.log.warn(`surveyor-network unavailable for claim ${input.claimId}`); return { status: 'unavailable', failureReason: 'surveyor_network_unavailable' }; } });
  }
}
