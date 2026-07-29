// core/auth/sms-sender.provider.ts · binds SMS_SENDER by config (msg91 / twilio / noop).
// [DEV-31 2026-07-28] Extracted verbatim from the inline factory previously in core.module.ts (no behavior
// change — same switch, same inject list) so the config-driven driver selection is independently unit-testable,
// mirroring the established gold-standard pattern (modules/insurance/gateway/insurance-gateways.provider.ts,
// DEV-25). Drop-in readiness audit (S2_PROVIDER_KEY_DROPIN.md execution): this factory is the ONE place that
// decides msg91-vs-twilio-vs-noop; setting SMS_PROVIDER (+ the matching creds) is a pure config change, never a
// code edit — see __tests__/sms-sender.provider.spec.ts for the mechanical proof.
import { Provider } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { ResilienceService } from '../resilience/resilience.service';
import { SMS_SENDER, SmsSender } from './otp.service';
import { NoopSmsSender } from './sms.noop';
import { Msg91SmsSender } from './sms.msg91';
import { TwilioSmsSender } from './sms.twilio';

export const smsSenderProvider: Provider = {
  // SMS provider chosen by config: msg91 (Indian DLT) / twilio (global) / noop (dev). In production
  // assertProductionSecurity has already refused to boot on 'noop' or missing provider creds.
  provide: SMS_SENDER,
  useFactory: (config: AppConfig, resilience: ResilienceService): SmsSender => {
    resilience.configure('sms', { timeoutMs: 6000, retries: 1, circuit: { failureThreshold: 5, resetMs: 15_000, halfOpenMax: 2 }, bulkhead: { maxConcurrent: 32, maxQueue: 256 } });
    switch (config.sms.provider) {
      case 'msg91':  return new Msg91SmsSender(config.sms.msg91, resilience);
      case 'twilio': return new TwilioSmsSender(config.sms.twilio, resilience);
      default:       return new NoopSmsSender(config);
    }
  },
  inject: [AppConfig, ResilienceService],
};
