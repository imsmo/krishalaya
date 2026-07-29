// core/auth/__tests__/sms-sender.provider.spec.ts · [DEV-31] MECHANICAL PROOF for the MSG91/DLT drop-in.
// Proves the actual DI factory (not a hand-rolled re-implementation) flips driver purely on config: setting
// SMS_PROVIDER=msg91 (+ placeholder-shaped, non-credential creds per contract §7) selects Msg91SmsSender wired
// to the configured baseUrl/authkey/template id; twilio selects TwilioSmsSender; anything else (including unset)
// degrades honestly to NoopSmsSender — Law 7's "never fabricate" holds even at the wiring layer. Mirrors the
// gold-standard pattern already shipped for the insurance gateways (DEV-25,
// modules/insurance/__tests__/insurance-gateways.spec.ts's "Gateway DI providers" block).
import { smsSenderProvider } from '../sms-sender.provider';
import { Msg91SmsSender } from '../sms.msg91';
import { TwilioSmsSender } from '../sms.twilio';
import { NoopSmsSender } from '../sms.noop';

const fakeResilience = () => ({ run: (_d: string, fn: () => Promise<unknown>) => fn(), configure: () => {} }) as any;

function fakeConfig(overrides: { provider?: string; isProd?: boolean } = {}) {
  return {
    isProd: overrides.isProd ?? false,
    sms: {
      provider: overrides.provider ?? 'noop',
      // placeholder-shaped, obviously-fake values — never a credential-shaped literal (contract §7)
      msg91: { authKey: 'test-msg91-authkey-unset', senderId: 'KRSHVR', otpTemplateId: 'test-template-id', baseUrl: 'https://msg91.example.test' },
      twilio: { accountSid: 'test-twilio-sid-unset', authToken: 'test-twilio-token-unset', from: '+10000000000' },
    },
  } as any;
}

describe('smsSenderProvider (config-driven MSG91/Twilio/noop selection)', () => {
  it('binds Msg91SmsSender when SMS_PROVIDER=msg91, wired to the configured baseUrl/authKey/template', async () => {
    const config = fakeConfig({ provider: 'msg91' });
    const sender = await (smsSenderProvider as any).useFactory(config, fakeResilience());
    expect(sender).toBeInstanceOf(Msg91SmsSender);

    // prove the WIRING (baseUrl + authkey header shape), not just the class — send a real OTP through it.
    let captured: { url: string; headers: any } | null = null;
    global.fetch = (async (url: string, init: any) => { captured = { url, headers: init.headers }; return { ok: true, status: 200, json: async () => ({ type: 'success' }) }; }) as any;
    await sender.sendOtp('+919812345678', { code: '111111', ttlMin: 5, purpose: 'login', locale: 'en' }, 'x');
    expect(captured!.url).toBe('https://msg91.example.test/api/v5/otp');
    expect(captured!.headers.authkey).toBe('test-msg91-authkey-unset');
    delete (global as any).fetch;
  });

  it('binds TwilioSmsSender when SMS_PROVIDER=twilio, wired to Basic-auth + Accounts/:sid/Messages.json', async () => {
    const config = fakeConfig({ provider: 'twilio' });
    const sender = await (smsSenderProvider as any).useFactory(config, fakeResilience());
    expect(sender).toBeInstanceOf(TwilioSmsSender);

    let captured: { url: string; headers: any } | null = null;
    global.fetch = (async (url: string, init: any) => { captured = { url, headers: init.headers }; return { ok: true, status: 201, json: async () => ({}) }; }) as any;
    await sender.sendOtp('+919812345678', { code: '111111', ttlMin: 5, purpose: 'login', locale: 'en' }, 'rendered');
    expect(captured!.url).toContain('/Accounts/test-twilio-sid-unset/Messages.json');
    expect(captured!.headers.authorization).toMatch(/^Basic /);
    delete (global as any).fetch;
  });

  it('degrades to NoopSmsSender when SMS_PROVIDER is unset/noop (Law 7: honest degrade, not a thrown/fabricated send)', async () => {
    const sender = await (smsSenderProvider as any).useFactory(fakeConfig({ provider: 'noop' }), fakeResilience());
    expect(sender).toBeInstanceOf(NoopSmsSender);
  });

  it('an unrecognised provider value also degrades to Noop (fail-closed default branch, never a crash)', async () => {
    const sender = await (smsSenderProvider as any).useFactory(fakeConfig({ provider: 'not-a-real-provider' }), fakeResilience());
    expect(sender).toBeInstanceOf(NoopSmsSender);
  });
});
