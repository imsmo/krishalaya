// modules/identity/__tests__/ekyc-provider.provider.spec.ts · [DEV-31] MECHANICAL PROOF for the eKYC drop-in.
// Proves the actual DI factory (ekycProviderProvider, already named-exported — no refactor needed here, unlike
// the SMS/Razorpay factories) flips driver purely on config: EKYC_PROVIDER_KIND='sandbox' (the default, dev/test
// only — assertProductionSecurity refuses it in prod) binds SandboxEkycProvider; any real provider name (e.g.
// 'digilocker') binds HttpEkycProvider wired to the configured baseUrl/apiKey. Mirrors the gold-standard pattern
// already shipped for the insurance gateways (DEV-25).
import { ekycProviderProvider } from '../gateway/ekyc-provider.provider';
import { SandboxEkycProvider } from '../gateway/sandbox-ekyc.provider';
import { HttpEkycProvider } from '../gateway/http-ekyc.provider';

const fakeResilience = () => ({ run: (_d: string, fn: () => Promise<unknown>) => fn(), configure: () => {} }) as any;

describe('ekycProviderProvider (config-driven sandbox vs real-provider selection)', () => {
  it('binds SandboxEkycProvider when EKYC_PROVIDER_KIND is unset/sandbox (dev/test-only default)', async () => {
    const config = { ekyc: { kind: 'sandbox', baseUrl: '', apiKey: '' } } as any;
    const gw = await (ekycProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(SandboxEkycProvider);
  });

  it('binds HttpEkycProvider once a real EKYC_PROVIDER_KIND is set, wired to the configured baseUrl/apiKey', async () => {
    // placeholder-shaped, obviously-fake values — never a credential-shaped literal (contract §7)
    const config = { ekyc: { kind: 'digilocker', baseUrl: 'https://ekyc.example.test', apiKey: 'test-ekyc-apikey-unset' } } as any;
    const gw = await (ekycProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(HttpEkycProvider);

    let captured: { url: string; headers: any } | null = null;
    global.fetch = (async (url: string, init: any) => { captured = { url, headers: init.headers }; return { ok: true, status: 200, json: async () => ({ reference_id: 'ref_1', otp_required: true }) }; }) as any;
    await gw.start({ docType: 'aadhaar', idNumber: '123456789012', fullName: null });
    expect(captured!.url).toBe('https://ekyc.example.test/v1/ekyc/initiate');
    expect(captured!.headers.authorization).toBe('Bearer test-ekyc-apikey-unset');
    delete (global as any).fetch;
  });

  it('a differently-cased real kind (e.g. "Digilocker") still binds HttpEkycProvider — never falls back to sandbox on casing', async () => {
    const config = { ekyc: { kind: 'karza', baseUrl: 'https://ekyc.example.test', apiKey: 'test-ekyc-apikey-unset' } } as any;
    const gw = await (ekycProviderProvider as any).useFactory(config, fakeResilience());
    expect(gw).toBeInstanceOf(HttpEkycProvider);
  });
});
