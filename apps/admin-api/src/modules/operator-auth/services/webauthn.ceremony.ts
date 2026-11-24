// apps/admin-api/src/modules/operator-auth/services/webauthn.ceremony.ts · PC-56 ADMIN-AUTH-1 — the hardware-key ceremonies.
//
// WHY THIS ONE IS A DEPENDENCY (@simplewebauthn/server, pinned EXACT at 13.3.3) when the admin realm's JWT and the OIDC
// id_token are verified with Node `crypto` alone: a WebAuthn response is CBOR (attestationObject), COSE keys (EC2/OKP/RSA
// with their own algorithm identifiers), authenticatorData bit-flags, rpIdHash, clientDataJSON origin/type/challenge rules,
// and — for any authenticator that sends one — attestation statement formats. Getting any of those subtly wrong is a silent
// authentication bypass, and a hand-rolled CBOR/COSE parser on the god-mode front door is a larger risk than one
// well-reviewed, widely deployed, MIT-licensed library with a small dependency tree. Protocol correctness outweighs the
// dependency-free posture HERE and only here; `pnpm audit --audit-level high` stays at 0.
//
// POLICY CHOICES (and why):
//   • userVerification 'required'. A FIDO2 security key's UV is its PIN. Requiring it means a lost or stolen key is
//     useless without the PIN, and the hardware factor stays a factor even if the IdP account (the other factor) is
//     phished. The cost — every operator sets a PIN on each key (browsers prompt for one at registration) — is the
//     guidebook's instruction, and a key with a forgotten PIN is exactly why everybody registers two.
//   • attestation 'none' and only 'none'-shaped attestation is accepted (no x5c chain): this realm does not restrict key
//     models, and an attestation certificate would make the library fetch CRLs from URLs inside an attacker-supplied
//     certificate — an outbound request the front door has no reason to make.
//   • residentKey 'discouraged': non-discoverable credentials; every assertion names allowCredentials for one operator.
//   • ES256 (-7), EdDSA (-8) and RS256 (-257) accepted — what YubiKeys and platform authenticators actually produce.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON, AuthenticatorTransportFuture, PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { decodeAttestationObject, isoBase64URL } from '@simplewebauthn/server/helpers';

export const USER_VERIFICATION = 'required' as const;
export const SUPPORTED_ALGS = [-7, -8, -257];
export const CEREMONY_TIMEOUT_MS = 120_000;

export interface RpConfig { rpId: string; rpName: string; origin: string }
export interface StoredCredential { credentialId: string; publicKey: Buffer; signCount: number; transports: string[] }

export class CeremonyError extends Error {
  constructor(public readonly reason: string) { super(`webauthn refused: ${reason}`); this.name = 'CeremonyError'; }
}

/** The challenge the browser signed, read from clientDataJSON — used to look up (and consume) our stored challenge row. */
export function challengeOf(response: { response?: { clientDataJSON?: unknown } } | null | undefined): string | null {
  const raw = response?.response?.clientDataJSON;
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const cd = JSON.parse(isoBase64URL.toUTF8String(raw)) as { challenge?: unknown };
    return typeof cd.challenge === 'string' && cd.challenge.length <= 128 ? cd.challenge : null;
  } catch { return null; }
}

export async function registrationOptions(rp: RpConfig, user: { adminUserId: string; email: string }, exclude: StoredCredential[]):
  Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: rp.rpName, rpID: rp.rpId,
    userName: user.email, userDisplayName: user.email,
    userID: new Uint8Array(Buffer.from(user.adminUserId, 'utf8')),
    attestationType: 'none',
    timeout: CEREMONY_TIMEOUT_MS,
    excludeCredentials: exclude.map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'discouraged', requireResidentKey: false, userVerification: USER_VERIFICATION },
    supportedAlgorithmIDs: SUPPORTED_ALGS,
  });
}

export async function authenticationOptions(rp: RpConfig, allow: StoredCredential[]): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpId, timeout: CEREMONY_TIMEOUT_MS, userVerification: USER_VERIFICATION,
    allowCredentials: allow.map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransportFuture[] })),
  });
}

export interface VerifiedRegistration {
  credentialId: string; publicKey: Buffer; signCount: number; transports: string[]; aaguid: string | null;
}

export async function verifyRegistration(rp: RpConfig, response: RegistrationResponseJSON, expectedChallenge: string): Promise<VerifiedRegistration> {
  // Attestation shape first, before the library sees it: 'none', or a self-attestation with no certificate chain.
  try {
    const att = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
    if (att.get('attStmt')?.get('x5c')) throw new CeremonyError('attestation_certificate_not_accepted');
  } catch (e) {
    if (e instanceof CeremonyError) throw e;
    throw new CeremonyError('undecodable_attestation');
  }
  let out;
  try {
    out = await verifyRegistrationResponse({
      response, expectedChallenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId,
      requireUserPresence: true, requireUserVerification: true, supportedAlgorithmIDs: SUPPORTED_ALGS,
    });
  } catch (e) { throw new CeremonyError(`registration_invalid:${(e as Error).message.slice(0, 120)}`); }
  if (!out.verified) throw new CeremonyError('registration_not_verified');
  const c = out.registrationInfo.credential;
  return {
    credentialId: c.id,
    publicKey: Buffer.from(c.publicKey),
    signCount: c.counter,
    transports: (response.response.transports ?? []).map(String).slice(0, 8),
    aaguid: out.registrationInfo.aaguid ?? null,
  };
}

export async function verifyAssertion(rp: RpConfig, response: AuthenticationResponseJSON, expectedChallenge: string, cred: StoredCredential):
  Promise<{ newSignCount: number }> {
  let out;
  try {
    out = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId,
      credential: { id: cred.credentialId, publicKey: new Uint8Array(cred.publicKey), counter: cred.signCount, transports: cred.transports as AuthenticatorTransportFuture[] },
      requireUserVerification: true,
    });
  } catch (e) { throw new CeremonyError(`assertion_invalid:${(e as Error).message.slice(0, 120)}`); }
  if (!out.verified) throw new CeremonyError('assertion_not_verified');
  return { newSignCount: out.authenticationInfo.newCounter };
}
