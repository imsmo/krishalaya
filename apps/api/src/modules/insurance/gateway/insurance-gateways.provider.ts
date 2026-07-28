// modules/insurance/gateway/insurance-gateways.provider.ts · binds the 3 Wave 7 external-integration
// tokens by config (DEV-25, KV-BL-057). Mirrors modules/communication/gateway/gateway.provider.ts exactly:
// a real URL configured → the resilience-wrapped HTTP adapter; otherwise the honest noop adapter. Swapping/
// scaling any of these 3 providers is config, not code. No named commercial/govt provider account exists in
// this environment (§8) — every one of these binds to its noop today.
import { Provider } from '@nestjs/common';
import { AppConfig } from '../../../core/config/app-config';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { PMFBY_PROVIDER } from './pmfby-provider.port';
import { NoopPmfbyGateway } from './noop-pmfby.gateway';
import { HttpPmfbyGateway } from './http-pmfby.gateway';
import { SURVEYOR_DISPATCH_GATEWAY } from './surveyor-dispatch.port';
import { NoopSurveyorDispatchGateway } from './noop-surveyor-dispatch.gateway';
import { HttpSurveyorDispatchGateway } from './http-surveyor-dispatch.gateway';
import { VET_CERT_PROVIDER } from './vet-cert-provider.port';
import { NoopVetCertGateway } from './noop-vet-cert.gateway';
import { HttpVetCertGateway } from './http-vet-cert.gateway';

export const pmfbyProviderProvider: Provider = {
  provide: PMFBY_PROVIDER,
  inject: [AppConfig, ResilienceService],
  useFactory: (config: AppConfig, resilience: ResilienceService) => {
    const c = config.insurance.pmfby;
    if (c.baseUrl) return new HttpPmfbyGateway({ baseUrl: c.baseUrl, apiKey: c.apiKey }, resilience);
    return new NoopPmfbyGateway(config);
  },
};

export const surveyorDispatchGatewayProvider: Provider = {
  provide: SURVEYOR_DISPATCH_GATEWAY,
  inject: [AppConfig, ResilienceService],
  useFactory: (config: AppConfig, resilience: ResilienceService) => {
    const c = config.insurance.surveyorDispatch;
    if (c.baseUrl) return new HttpSurveyorDispatchGateway({ baseUrl: c.baseUrl, apiKey: c.apiKey }, resilience);
    return new NoopSurveyorDispatchGateway(config);
  },
};

export const vetCertProviderProvider: Provider = {
  provide: VET_CERT_PROVIDER,
  inject: [AppConfig, ResilienceService],
  useFactory: (config: AppConfig, resilience: ResilienceService) => {
    const c = config.insurance.vetCert;
    if (c.baseUrl) return new HttpVetCertGateway({ baseUrl: c.baseUrl, apiKey: c.apiKey }, resilience);
    return new NoopVetCertGateway();
  },
};
