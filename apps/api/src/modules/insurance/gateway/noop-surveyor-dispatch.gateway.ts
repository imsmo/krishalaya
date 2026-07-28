// modules/insurance/gateway/noop-surveyor-dispatch.gateway.ts · default adapter when no external
// surveyor-network is configured (every environment today — no partner account exists, §8). Mirrors
// communication's NoopNotificationGateway exactly: dev/test accepts (exercise the flow end-to-end without
// a live network), prod WARNS and returns 'unavailable' — never a fabricated dispatch reference.
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../core/config/app-config';
import { SurveyorDispatchGateway, SurveyorDispatchInput, SurveyorDispatchResult } from './surveyor-dispatch.port';

@Injectable()
export class NoopSurveyorDispatchGateway implements SurveyorDispatchGateway {
  readonly providerCode = 'noop';
  private readonly log = new Logger('SurveyorDispatchGateway');
  constructor(private readonly config: AppConfig) {}

  async dispatch(input: SurveyorDispatchInput): Promise<SurveyorDispatchResult> {
    if (this.config.isProd) {
      this.log.warn(`surveyor-network not configured; claim ${input.claimId} needs manual surveyor dispatch`);
      return { status: 'unavailable', failureReason: 'surveyor_network_not_configured' };
    }
    this.log.debug(`[dev surveyor-dispatch] would notify network for claim ${input.claimId} surveyor ${input.surveyorUserId}`);
    return { status: 'dispatched', providerDispatchRef: `dev-dispatch-${input.idempotencyKey}` };
  }
}
