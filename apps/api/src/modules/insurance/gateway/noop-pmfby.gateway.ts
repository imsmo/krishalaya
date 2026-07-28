// modules/insurance/gateway/noop-pmfby.gateway.ts · default PMFBY adapter when no real portal is
// configured (which is EVERY environment today — no PMFBY portal account exists, per §8). Mirrors
// communication's NoopNotificationGateway convention: dev/test accepts (so the flow can be exercised
// end-to-end without a live govt portal), prod WARNS and returns 'unavailable' — it never fabricates a
// govt application reference (Law 7/12: degrade honestly, an AI/provider surface never invents a
// confident-looking value when the real thing is unset).
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../core/config/app-config';
import {
  PmfbyProvider, PmfbyEnrolmentInput, PmfbyEnrolmentResult, PmfbyStatusInput, PmfbyStatusResult,
} from './pmfby-provider.port';

@Injectable()
export class NoopPmfbyGateway implements PmfbyProvider {
  readonly providerCode = 'noop';
  private readonly log = new Logger('PmfbyProvider');
  constructor(private readonly config: AppConfig) {}

  async submitEnrolment(input: PmfbyEnrolmentInput): Promise<PmfbyEnrolmentResult> {
    if (this.config.isProd) {
      this.log.warn(`PMFBY portal not configured; policy ${input.policyId} needs manual PMFBY submission`);
      return { status: 'unavailable', failureReason: 'pmfby_portal_not_configured' };
    }
    this.log.debug(`[dev pmfby] would submit enrolment for policy ${input.policyId}`);
    return { status: 'submitted', govtApplicationRef: `dev-pmfby-${input.idempotencyKey}` };
  }

  async checkStatus(input: PmfbyStatusInput): Promise<PmfbyStatusResult> {
    if (this.config.isProd) {
      this.log.warn(`PMFBY portal not configured; status check for ${input.govtApplicationRef} needs manual follow-up`);
      return { status: 'unavailable', failureReason: 'pmfby_portal_not_configured' };
    }
    this.log.debug(`[dev pmfby] would check status for ${input.govtApplicationRef}`);
    return { status: 'submitted', portalStatus: 'dev-pending' };
  }
}
