// modules/insurance/__tests__/insurance-gateways.spec.ts · DEV-25/KV-BL-057 (Wave 7) — the 3 external-
// integration adapters. Pins the HONESTY CONTRACT (Law 7/12): a noop/unreachable provider NEVER fabricates a
// success — it degrades to 'unavailable' (or, for vet-cert, EVERY environment including dev, since a claim
// settlement decision may rest on this signal). HTTP adapters are tested against a mocked `fetch` (no live
// calls) using a fake ResilienceService that mirrors modules/communication's own gateway-test convention
// (run(dep, fn, opts) => fn() with opts.fallback applied on throw — see expo-push-sender.spec.ts).
import { NoopPmfbyGateway } from '../gateway/noop-pmfby.gateway';
import { HttpPmfbyGateway } from '../gateway/http-pmfby.gateway';
import { NoopSurveyorDispatchGateway } from '../gateway/noop-surveyor-dispatch.gateway';
import { HttpSurveyorDispatchGateway } from '../gateway/http-surveyor-dispatch.gateway';
import { NoopVetCertGateway } from '../gateway/noop-vet-cert.gateway';
import { HttpVetCertGateway } from '../gateway/http-vet-cert.gateway';
import { pmfbyProviderProvider, surveyorDispatchGatewayProvider, vetCertProviderProvider } from '../gateway/insurance-gateways.provider';

const fakeResilience = () => ({
  run: async <T,>(_dep: string, fn: () => Promise<T>, opts?: { fallback?: () => T }) => {
    try { return await fn(); } catch (e) { if (opts?.fallback) return opts.fallback(); throw e; }
  },
}) as any;

function fakeFetch(handler: (url: string, init: any) => { status?: number; body?: unknown } | 'network-error') {
  (global as any).fetch = async (url: any, init: any) => {
    const r = handler(String(url), init);
    if (r === 'network-error') throw new Error('ECONNREFUSED');
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {} } as any;
  };
}
afterEach(() => { delete (global as any).fetch; });

const pmfbyInput = {
  idempotencyKey: 'p1', tenantId: 't1', policyId: 'p1', holderUserId: 'u1', productCode: 'pmfby',
  sumInsuredMinor: '10000000', premiumMinor: '200000', validFrom: '2026-06-15', validUntil: '2026-11-30', cropSeasonRef: null,
};
const dispatchInput = { idempotencyKey: 'c1:s1', tenantId: 't1', claimId: 'c1', policyId: 'p1', surveyorUserId: 's1', isReassignment: false };
const vetCertInput = { idempotencyKey: 'c1:cert1', tenantId: 't1', claimId: 'c1', certRef: 'cert1' };

describe('PMFBY provider (external integration #1)', () => {
  it('noop DEV: accepts (exercises the flow end-to-end without a live portal) — never a real-looking application ref', async () => {
    const gw = new NoopPmfbyGateway({ isProd: false } as any);
    const res = await gw.submitEnrolment(pmfbyInput);
    expect(res.status).toBe('submitted');
    expect(res.govtApplicationRef).toBe('dev-pmfby-p1');   // clearly dev-labeled, never a fabricated real-looking ref
  });
  it('noop PROD: degrades honestly to unavailable — NEVER fabricates a govt application reference', async () => {
    const gw = new NoopPmfbyGateway({ isProd: true } as any);
    const res = await gw.submitEnrolment(pmfbyInput);
    expect(res.status).toBe('unavailable');
    expect(res.govtApplicationRef).toBeUndefined();
    expect(res.failureReason).toBe('pmfby_portal_not_configured');
  });
  it('http adapter: maps a 2xx response to submitted + the portal-returned application ref', async () => {
    fakeFetch(() => ({ status: 201, body: { application_ref: 'PMFBY-REF-1' } }));
    const gw = new HttpPmfbyGateway({ baseUrl: 'https://pmfby.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.submitEnrolment(pmfbyInput);
    expect(res).toEqual({ status: 'submitted', govtApplicationRef: 'PMFBY-REF-1' });
  });
  it('http adapter: a 422 rejection maps to unavailable with the portal error, never a thrown exception', async () => {
    fakeFetch(() => ({ status: 422, body: { error: 'duplicate_enrolment' } }));
    const gw = new HttpPmfbyGateway({ baseUrl: 'https://pmfby.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.submitEnrolment(pmfbyInput);
    expect(res).toEqual({ status: 'unavailable', failureReason: 'duplicate_enrolment' });
  });
  it('http adapter: a network error (timeout/unreachable) degrades via the resilience fallback, never throws', async () => {
    fakeFetch(() => 'network-error');
    const gw = new HttpPmfbyGateway({ baseUrl: 'https://pmfby.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.submitEnrolment(pmfbyInput);
    expect(res.status).toBe('unavailable');
    expect(res.failureReason).toBe('pmfby_portal_unavailable');
  });
});

describe('Surveyor-dispatch gateway (external integration #2)', () => {
  it('noop DEV: accepts, dev-labeled dispatch ref', async () => {
    const gw = new NoopSurveyorDispatchGateway({ isProd: false } as any);
    const res = await gw.dispatch(dispatchInput);
    expect(res).toEqual({ status: 'dispatched', providerDispatchRef: 'dev-dispatch-c1:s1' });
  });
  it('noop PROD: degrades honestly to unavailable', async () => {
    const gw = new NoopSurveyorDispatchGateway({ isProd: true } as any);
    const res = await gw.dispatch(dispatchInput);
    expect(res).toEqual({ status: 'unavailable', failureReason: 'surveyor_network_not_configured' });
  });
  it('http adapter: maps a 2xx response to dispatched + the network-returned dispatch ref', async () => {
    fakeFetch(() => ({ status: 200, body: { dispatch_ref: 'DISP-1' } }));
    const gw = new HttpSurveyorDispatchGateway({ baseUrl: 'https://surveyors.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.dispatch(dispatchInput);
    expect(res).toEqual({ status: 'dispatched', providerDispatchRef: 'DISP-1' });
  });
  it('http adapter: a network error degrades via fallback, never throws', async () => {
    fakeFetch(() => 'network-error');
    const gw = new HttpSurveyorDispatchGateway({ baseUrl: 'https://surveyors.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.dispatch(dispatchInput);
    expect(res).toEqual({ status: 'unavailable', failureReason: 'surveyor_network_unavailable' });
  });
});

describe('Vet-cert provider (external integration #3) — DELIBERATELY STRICTER noop', () => {
  it('noop: unavailable in EVERY environment (dev included) — a livestock claim settlement signal is never a synthetic "verified"', async () => {
    const gw = new NoopVetCertGateway();
    const res = await gw.verify(vetCertInput);
    expect(res).toEqual({ status: 'unavailable', failureReason: 'vet_cert_provider_not_configured' });
  });
  it('http adapter: maps verified=true to status verified', async () => {
    fakeFetch(() => ({ status: 200, body: { verified: true, reference: 'VC-1' } }));
    const gw = new HttpVetCertGateway({ baseUrl: 'https://vetcert.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.verify(vetCertInput);
    expect(res).toEqual({ status: 'verified', providerRef: 'VC-1' });
  });
  it('http adapter: maps verified=false to a real "rejected" (not "unavailable") — a genuine negative result', async () => {
    fakeFetch(() => ({ status: 200, body: { verified: false, reference: 'VC-2' } }));
    const gw = new HttpVetCertGateway({ baseUrl: 'https://vetcert.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.verify(vetCertInput);
    expect(res).toEqual({ status: 'rejected', providerRef: 'VC-2' });
  });
  it('http adapter: a network error degrades via fallback to unavailable, never a fabricated verified/rejected', async () => {
    fakeFetch(() => 'network-error');
    const gw = new HttpVetCertGateway({ baseUrl: 'https://vetcert.example', apiKey: 'k' }, fakeResilience());
    const res = await gw.verify(vetCertInput);
    expect(res).toEqual({ status: 'unavailable', failureReason: 'vet_cert_provider_unavailable' });
  });
});

describe('Gateway DI providers (config-driven selection, no named partner account configured today)', () => {
  it('pmfbyProviderProvider binds the noop when no baseUrl is configured', async () => {
    const config = { insurance: { pmfby: { baseUrl: null, apiKey: '' } }, isProd: false } as any;
    const gw = await (pmfbyProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(NoopPmfbyGateway);
  });
  it('pmfbyProviderProvider binds the http adapter once a baseUrl IS configured', async () => {
    const config = { insurance: { pmfby: { baseUrl: 'https://pmfby.example', apiKey: 'k' } }, isProd: false } as any;
    const gw = await (pmfbyProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(HttpPmfbyGateway);
  });
  it('surveyorDispatchGatewayProvider binds the noop when no baseUrl is configured', async () => {
    const config = { insurance: { surveyorDispatch: { baseUrl: null, apiKey: '' } }, isProd: false } as any;
    const gw = await (surveyorDispatchGatewayProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(NoopSurveyorDispatchGateway);
  });
  it('vetCertProviderProvider binds the noop when no baseUrl is configured', async () => {
    const config = { insurance: { vetCert: { baseUrl: null, apiKey: '' } } } as any;
    const gw = await (vetCertProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(NoopVetCertGateway);
  });
  it('vetCertProviderProvider binds the http adapter once a baseUrl IS configured', async () => {
    const config = { insurance: { vetCert: { baseUrl: 'https://vetcert.example', apiKey: 'k' } } } as any;
    const gw = await (vetCertProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(HttpVetCertGateway);
  });
});
