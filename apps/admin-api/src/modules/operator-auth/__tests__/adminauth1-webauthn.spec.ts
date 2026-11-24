// PC-56 ADMIN-AUTH-1 · the hardware-key ceremonies, round-tripped against a SOFTWARE authenticator (no hardware): options →
// a hand-built attestation/assertion → @simplewebauthn/server verification through this module's ceremony wrapper.
import { generateKeyPairSync } from 'node:crypto';
import {
  CeremonyError, USER_VERIFICATION, authenticationOptions, challengeOf, registrationOptions, verifyAssertion, verifyRegistration,
} from '../services/webauthn.ceremony';
import { SoftAuthenticator } from './fixtures/soft-authenticator';
import { signCountAcceptable } from '../domain/operator-auth.rules';

const RP = { rpId: 'admin.example.test', rpName: 'Krishalaya Admin', origin: 'https://admin.example.test' };
const USER = { adminUserId: '0190a0b0-0000-7000-8000-000000000001', email: 'founder@example.test' };

async function enrolled(key = new SoftAuthenticator({ rpId: RP.rpId, origin: RP.origin })) {
  const opts = await registrationOptions(RP, USER, []);
  const reg = await verifyRegistration(RP, key.register(opts) as never, opts.challenge);
  return { key, reg, stored: { credentialId: reg.credentialId, publicKey: reg.publicKey, signCount: reg.signCount, transports: reg.transports } };
}

describe('ADMIN-AUTH-1 · WebAuthn options are the documented policy', () => {
  it('registration: attestation none, UV required, non-resident, ES256/EdDSA/RS256, the operator as the user', async () => {
    const o = await registrationOptions(RP, USER, []);
    expect(o.rp).toEqual({ name: RP.rpName, id: RP.rpId });
    expect(o.attestation).toBe('none');
    expect(o.authenticatorSelection).toMatchObject({ residentKey: 'discouraged', userVerification: 'required' });
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -8, -257]);
    expect(o.user.name).toBe(USER.email);
    expect(USER_VERIFICATION).toBe('required');
  });
  it('authentication: allowCredentials names exactly the operator\'s keys, UV required', async () => {
    const { stored } = await enrolled();
    const o = await authenticationOptions(RP, [stored]);
    expect(o.userVerification).toBe('required');
    expect(o.allowCredentials?.map((c) => c.id)).toEqual([stored.credentialId]);
    expect(o.rpId).toBe(RP.rpId);
  });
});

describe('ADMIN-AUTH-1 · software-authenticator round trip', () => {
  it('registers a key and stores its credential id, COSE public key and counter', async () => {
    const { key, reg } = await enrolled();
    expect(reg.credentialId).toBe(key.id);
    expect(reg.publicKey.length).toBeGreaterThan(60);
    expect(reg.signCount).toBe(0);
    expect(reg.transports).toEqual(['usb']);
  });

  it('verifies an assertion and returns the new counter; the challenge is read from clientDataJSON', async () => {
    const { key, stored } = await enrolled();
    const o = await authenticationOptions(RP, [stored]);
    const resp = key.assert(o);
    expect(challengeOf(resp)).toBe(o.challenge);
    const out = await verifyAssertion(RP, resp as never, o.challenge, stored);
    expect(out.newSignCount).toBe(1);
  });

  it('refuses an assertion for the wrong origin, the wrong RP id, a wrong challenge, or another key\'s signature', async () => {
    const { key, stored } = await enrolled();
    const o = await authenticationOptions(RP, [stored]);
    await expect(verifyAssertion(RP, key.assert(o, { origin: 'https://evil.example' }) as never, o.challenge, stored)).rejects.toBeInstanceOf(CeremonyError);
    await expect(verifyAssertion(RP, key.assert(o, { rpId: 'evil.example' }) as never, o.challenge, stored)).rejects.toBeInstanceOf(CeremonyError);
    await expect(verifyAssertion(RP, key.assert(o) as never, 'another-challenge', stored)).rejects.toBeInstanceOf(CeremonyError);
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    await expect(verifyAssertion(RP, key.assert(o, { signWith: other }) as never, o.challenge, stored)).rejects.toBeInstanceOf(CeremonyError);
  });

  it('refuses an assertion without user verification (the key\'s PIN) — UV is required', async () => {
    const key = new SoftAuthenticator({ rpId: RP.rpId, origin: RP.origin });
    const { stored } = await enrolled(key);
    const noUv = new SoftAuthenticator({ rpId: RP.rpId, origin: RP.origin, userVerified: false });
    Object.assign(noUv, { credentialId: key.credentialId, kp: (key as unknown as { kp: unknown }).kp });
    const o = await authenticationOptions(RP, [stored]);
    await expect(verifyAssertion(RP, noUv.assert(o) as never, o.challenge, stored)).rejects.toThrow(/assertion_invalid/);
  });

  it('refuses a registration without UV, and one carrying an attestation certificate chain (no CRL fetches from the front door)', async () => {
    const o = await registrationOptions(RP, USER, []);
    const noUv = new SoftAuthenticator({ rpId: RP.rpId, origin: RP.origin, userVerified: false });
    await expect(verifyRegistration(RP, noUv.register(o) as never, o.challenge)).rejects.toThrow(/registration_invalid/);
    const k = new SoftAuthenticator({ rpId: RP.rpId, origin: RP.origin });
    await expect(verifyRegistration(RP, k.register(o, { x5c: true }) as never, o.challenge)).rejects.toThrow('attestation_certificate_not_accepted');
    await expect(verifyRegistration(RP, k.register(o, { origin: 'https://evil.example' }) as never, o.challenge)).rejects.toThrow(/registration_invalid/);
  });

  it('SIGN-COUNT REGRESSION IS REFUSED: a replayed/cloned counter fails; a key that never increments (0 → 0) passes', async () => {
    const { key, stored } = await enrolled();
    const o1 = await authenticationOptions(RP, [stored]);
    const first = await verifyAssertion(RP, key.assert(o1, { counter: 7 }) as never, o1.challenge, stored);
    const after = { ...stored, signCount: first.newSignCount };
    const o2 = await authenticationOptions(RP, [after]);
    await expect(verifyAssertion(RP, key.assert(o2, { counter: 7 }) as never, o2.challenge, after)).rejects.toThrow(/assertion_invalid/);
    await expect(verifyAssertion(RP, key.assert(o2, { counter: 3 }) as never, o2.challenge, after)).rejects.toThrow(/assertion_invalid/);
    expect(signCountAcceptable(7, 7)).toBe(false);
    expect(signCountAcceptable(7, 3)).toBe(false);
    expect(signCountAcceptable(7, 8)).toBe(true);

    const zero = new SoftAuthenticator({ rpId: RP.rpId, origin: RP.origin, counterStep: 0 });
    const z = await enrolled(zero);
    const o3 = await authenticationOptions(RP, [z.stored]);
    await expect(verifyAssertion(RP, zero.assert(o3) as never, o3.challenge, z.stored)).resolves.toEqual({ newSignCount: 0 });
    expect(signCountAcceptable(0, 0)).toBe(true);
  });

  it('challengeOf refuses garbage', () => {
    expect(challengeOf(null)).toBeNull();
    expect(challengeOf({ response: { clientDataJSON: 'not-json' } })).toBeNull();
    expect(challengeOf({ response: { clientDataJSON: 'x'.repeat(5000) } })).toBeNull();
  });
});
