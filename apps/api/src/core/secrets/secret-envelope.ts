// secret-envelope.ts · ENVELOPE ENCRYPTION FOR SECRETS THE PLATFORM MUST READ BACK — PC-56 TENANT-13a (F-10, founder decision
// 2026-10-03: HMAC-SHA256 shared secret, ENCRYPTED AT REST, shown once). Byte-identical in apps/api/src/core/secrets/
// secret-envelope.ts and apps/worker/src/jobs/webhook/secret-envelope.ts (parity spec), because the API seals and the worker opens.
//
// WHY ENCRYPTED AND NOT HASHED. An HMAC signer must hold the key: the worker reproduces the signature on every delivery. So the
// canon's "stored hashed — even we cannot read them back" cannot be true for this design and the console now says what is true:
// "encrypted at rest, shown once".
//
// THE ENVELOPE. Each secret gets its own random 256-bit data key (DEK). The DEK encrypts the secret (AES-256-GCM, additional data =
// the row it belongs to, so a ciphertext copied onto another endpoint does not open); the KEK (32 bytes, from the environment —
// never the database) encrypts the DEK. Token: `v2.<kekId>.<wrapped DEK>.<sealed secret>` (base64url parts). `kekId` (8 hex of
// sha256(KEK)) names the key that wrapped it, so a deployment with the wrong KEK fails loudly ("sealed under another key") instead
// of with a GCM tag error. Legacy tokens (migration 0090's single-layer base64 iv|tag|ct under the KEK, no AAD) still open — that is
// what partner endpoints and pre-0191 tenant endpoints hold.
//
// THE KEK. `resolveKek(raw, isProduction)`: production with no KEK THROWS (the API refuses to boot, the worker refuses to boot —
// never a silent "delivery disabled"); outside production an absent KEK falls back to the documented development key below, the
// same in both processes so local delivery works. A malformed KEK always throws.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
/** DEVELOPMENT ONLY — never accepted in production (resolveKek throws there before reaching this). */
export const DEV_ONLY_KEK_HEX = '0000000000000000000000000000000000000000000000000000000000000000';

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** Parse a base64/hex 32-byte key. Throws if it is not exactly 256 bits. */
export function parseKek(raw: string): Buffer {
  const s = String(raw ?? '').trim();
  const key = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (key.length !== 32) throw new Error('WEBHOOK_SIGNING_KEK must decode to exactly 32 bytes (256-bit)');
  return key;
}

/** The KEK for this process. Production without one throws; elsewhere the development key stands in. */
export function resolveKek(raw: string | undefined | null, isProduction: boolean): Buffer {
  const s = String(raw ?? '').trim();
  if (!s) {
    if (isProduction) throw new Error('WEBHOOK_SIGNING_KEK must be set in production — refusing to start without the webhook signing key');
    return Buffer.from(DEV_ONLY_KEK_HEX, 'hex');
  }
  return parseKek(s);
}

/** 8 hex characters naming a KEK (never the key itself). */
export function kekId(kek: Buffer): string {
  return createHash('sha256').update(kek).digest('hex').slice(0, 8);
}

function gcmSeal(key: Buffer, plaintext: Buffer, aad: string | null): Buffer {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALG, key, iv);
  if (aad !== null) c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function gcmOpen(key: Buffer, sealed: Buffer, aad: string | null): Buffer {
  if (sealed.length < IV_LEN + TAG_LEN) throw new Error('secret-envelope: malformed token');
  const d = createDecipheriv(ALG, key, sealed.subarray(0, IV_LEN));
  d.setAuthTag(sealed.subarray(IV_LEN, IV_LEN + TAG_LEN));
  if (aad !== null) d.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([d.update(sealed.subarray(IV_LEN + TAG_LEN)), d.final()]);
}

/** Seal `plaintext` for the row named by `aad` (e.g. `webhook_endpoint:<uuid>`). */
export function sealEnvelope(kek: Buffer, plaintext: string, aad: string): string {
  if (!aad) throw new Error('secret-envelope: additional data (the owning row) is required');
  const dek = randomBytes(32);
  try {
    const wrapped = gcmSeal(kek, dek, `dek:${aad}`);
    const body = gcmSeal(dek, Buffer.from(plaintext, 'utf8'), aad);
    return `v2.${kekId(kek)}.${b64u(wrapped)}.${b64u(body)}`;
  } finally { dek.fill(0); }
}

/** True for a v2 envelope token. */
export function isEnvelope(token: string): boolean {
  return /^v2\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(token ?? ''));
}

/** Open a v2 envelope (bound to `aad`) or a legacy single-layer token. Throws on tamper, wrong row, wrong KEK. */
export function openEnvelope(kek: Buffer, token: string, aad: string): string {
  const t = String(token ?? '');
  if (isEnvelope(t)) {
    const [, kid, wrapped, body] = t.split('.');
    if (kid !== kekId(kek)) throw new Error(`secret-envelope: sealed under another key (${kid}), this process holds ${kekId(kek)}`);
    const dek = gcmOpen(kek, fromB64u(wrapped), `dek:${aad}`);
    try { return gcmOpen(dek, fromB64u(body), aad).toString('utf8'); } finally { dek.fill(0); }
  }
  // legacy (migration 0090 / core/crypto/secret-box): base64(iv | tag | ct) directly under the KEK, no additional data
  return gcmOpen(kek, Buffer.from(t, 'base64'), null).toString('utf8');
}
