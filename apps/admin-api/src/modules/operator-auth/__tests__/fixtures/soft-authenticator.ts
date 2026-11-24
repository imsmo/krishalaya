// Test fixture (PC-56 ADMIN-AUTH-1): a SOFTWARE WebAuthn authenticator and a FAKE OpenID Connect provider.
//
// No hardware: the authenticator generates an ES256 (P-256) key pair and builds the attestation/assertion objects BY HAND
// (CBOR via @simplewebauthn/server's own isoCBOR encoder, so the bytes are the format a real key sends): authenticatorData =
// rpIdHash ‖ flags ‖ signCount ‖ [aaguid ‖ credIdLen ‖ credId ‖ COSE key]; the assertion signature is ECDSA-SHA256 (DER)
// over authenticatorData ‖ sha256(clientDataJSON) — exactly what a YubiKey computes.
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign, KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

export interface SoftKeyOptions { rpId: string; origin: string; userVerified?: boolean; counterStep?: number }

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly kp = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  counter = 0;
  constructor(private readonly o: SoftKeyOptions) {}

  get id(): string { return b64u(this.credentialId); }

  private flags(attested: boolean): number {
    let f = 0x01;                          // UP
    if (this.o.userVerified !== false) f |= 0x04;   // UV
    if (attested) f |= 0x40;               // AT
    return f;
  }

  private coseKey(): Uint8Array {
    const jwk = this.kp.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const m = new Map<number, number | Uint8Array>();
    m.set(1, 2); m.set(3, -7); m.set(-1, 1);
    m.set(-2, new Uint8Array(Buffer.from(jwk.x, 'base64url')));
    m.set(-3, new Uint8Array(Buffer.from(jwk.y, 'base64url')));
    return isoCBOR.encode(m as never);
  }

  private authData(attested: boolean, rpId = this.o.rpId): Buffer {
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter >>> 0);
    const parts: Buffer[] = [sha256(rpId), Buffer.from([this.flags(attested)]), cnt];
    if (attested) {
      const len = Buffer.alloc(2); len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, Buffer.from(this.coseKey()));
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string, origin = this.o.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** navigator.credentials.create() → RegistrationResponseJSON. `x5c` adds a (fake) attestation certificate chain. */
  register(optionsJSON: { challenge: string }, over: { origin?: string; x5c?: boolean } = {}) {
    const attStmt = new Map<string, unknown>();
    let fmt = 'none';
    if (over.x5c) { fmt = 'packed'; attStmt.set('alg', -7); attStmt.set('sig', new Uint8Array(8)); attStmt.set('x5c', [new Uint8Array(16)]); }
    const att = new Map<string, unknown>([['fmt', fmt], ['attStmt', attStmt], ['authData', new Uint8Array(this.authData(true))]]);
    return {
      id: this.id, rawId: this.id, type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(this.clientData('webauthn.create', optionsJSON.challenge, over.origin)),
        attestationObject: b64u(isoCBOR.encode(att as never)),
        transports: ['usb'],
      },
      clientExtensionResults: {}, authenticatorAttachment: 'cross-platform',
    };
  }

  /** navigator.credentials.get() → AuthenticationResponseJSON. `counter` overrides the next counter (regression tests). */
  assert(optionsJSON: { challenge: string }, over: { origin?: string; counter?: number; rpId?: string; signWith?: KeyObject } = {}) {
    this.counter = over.counter ?? this.counter + (this.o.counterStep ?? 1);
    const authData = this.authData(false, over.rpId);
    const cd = this.clientData('webauthn.get', optionsJSON.challenge, over.origin);
    const sig = cryptoSign('sha256', Buffer.concat([authData, sha256(cd)]), over.signWith ?? this.kp.privateKey);
    return {
      id: this.id, rawId: this.id, type: 'public-key' as const,
      response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig), userHandle: null },
      clientExtensionResults: {}, authenticatorAttachment: 'cross-platform',
    };
  }
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* A fake OpenID Connect provider: discovery, JWKS (rotatable), token endpoint, id_token signer                           */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface FakeIdpOptions { issuer: string; clientId: string }

export class FakeIdp {
  keys: { kid: string; alg: 'RS256' | 'ES256'; priv: KeyObject; jwk: Record<string, unknown> }[] = [];
  /** code → id_token the token endpoint will hand out. */
  readonly codes = new Map<string, string>();
  jwksHits = 0;
  lastTokenRequest: URLSearchParams | null = null;

  constructor(readonly o: FakeIdpOptions) { this.rotate('RS256'); }

  rotate(alg: 'RS256' | 'ES256' = 'RS256'): string {
    const kid = `k${this.keys.length + 1}-${randomBytes(3).toString('hex')}`;
    const kp = alg === 'RS256' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...(kp.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid, alg, use: 'sig' };
    this.keys.push({ kid, alg, priv: kp.privateKey, jwk });
    return kid;
  }

  /** Sign an id_token. Defaults: valid for 1 h, email_verified true. `header`/`claims` override anything. */
  idToken(claims: Record<string, unknown>, opt: { kid?: string; header?: Record<string, unknown>; rawSig?: string } = {}): string {
    const key = opt.kid ? this.keys.find((k) => k.kid === opt.kid)! : this.keys[this.keys.length - 1];
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: key.alg, kid: key.kid, typ: 'JWT', ...(opt.header ?? {}) };
    const payload = { iss: this.o.issuer, aud: this.o.clientId, iat: now, exp: now + 3600, email_verified: true, ...claims };
    const h = b64u(Buffer.from(JSON.stringify(header))); const p = b64u(Buffer.from(JSON.stringify(payload)));
    if (opt.rawSig !== undefined) return `${h}.${p}.${opt.rawSig}`;
    const data = Buffer.from(`${h}.${p}`);
    const sig = key.alg === 'RS256' ? cryptoSign('sha256', data, key.priv) : cryptoSign('sha256', data, { key: key.priv, dsaEncoding: 'ieee-p1363' });
    return `${h}.${p}.${b64u(sig)}`;
  }

  /** A FetchLike serving discovery, JWKS and the token endpoint. `publishedKids` limits which keys the JWKS shows. */
  publishedKids: string[] | null = null;
  fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const u = new URL(url);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (u.pathname === '/.well-known/openid-configuration') {
      return json(200, { issuer: this.o.issuer, authorization_endpoint: `${this.o.issuer}/authorize`, token_endpoint: `${this.o.issuer}/token`, jwks_uri: `${this.o.issuer}/jwks` });
    }
    if (u.pathname === '/jwks') {
      this.jwksHits += 1;
      const keys = this.keys.filter((k) => !this.publishedKids || this.publishedKids.includes(k.kid)).map((k) => k.jwk);
      return json(200, { keys });
    }
    if (u.pathname === '/token' && init?.method === 'POST') {
      const form = new URLSearchParams(init.body ?? '');
      this.lastTokenRequest = form;
      const tok = this.codes.get(form.get('code') ?? '');
      if (!tok) return json(400, { error: 'invalid_grant' });
      this.codes.delete(form.get('code') ?? '');
      return json(200, { id_token: tok, access_token: 'x', token_type: 'Bearer' });
    }
    return json(404, {});
  };
}
