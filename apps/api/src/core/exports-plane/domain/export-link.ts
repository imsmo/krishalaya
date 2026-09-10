// core/exports-plane/domain/export-link.ts · W2554's *"delivery via 15-min signed URL"* — the token, minted and verified
// (PC-56 TENANT-6e-2). Pure: no clock of its own, no I/O.
//
// WHAT THE LINK IS. A compact HMAC-SHA256 token `<payload-b64url>.<sig-b64url>` whose payload names ONE job in ONE tenant,
// who minted it, when it stops working, and a `jti` that the download log records on every fetch. It is presented to
// `GET /exports/:id/download?token=…` BESIDE the caller's ordinary session: the link authorises the FILE, the session
// says WHO fetched it. A link pasted into a chat therefore does not hand the file to whoever finds it, which is the
// decision 0120's admin plane made and the reason this plane serves its own bytes rather than a presigned object URL.
//
// WHAT IT IS NOT. Not a JWT: no header, no `alg` field to confuse, one fixed algorithm. Not revocable: it lives fifteen
// minutes and nothing about the file changes inside them; a job that is `expired` refuses the download whatever the
// token says, because the job's state is checked at the fetch as well.
//
// THE KEY is derived (HKDF-SHA256) from a server secret the platform already holds and already asserts strong at boot,
// with a fixed info string — so a leak of THIS key does not leak the session secret, and no new secret has to be
// provisioned, rotated and forgotten. `ExportLinkKeys` in the service does the derivation once.
import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto';

/** W2554's number, in seconds. Fifteen minutes is long enough to click and short enough that a link left in a browser
 *  history or a chat is dead by the time anybody finds it. */
export const EXPORT_LINK_TTL_SEC = 15 * 60;

export const EXPORT_LINK_HKDF_INFO = 'krishalaya/exports-plane/link/v1';

export interface ExportLinkClaims {
  jti: string;
  jobId: string;
  tenantId: string;
  mintedBy: string;
  issuedAtSec: number;
  expSec: number;
}

export type LinkVerdict =
  | { ok: true; claims: ExportLinkClaims }
  /** The refusal, named so the download log can record it. `jti` is carried when the payload could be read at all, so
   *  even a refused fetch names the link it tried — an expired link that keeps being tried is a link that leaked. */
  | { ok: false; outcome: 'refused_no_token' | 'refused_bad_signature' | 'refused_expired' | 'refused_wrong_job'; jti: string | null };

const toB64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Derive the link key from a server secret. Refuses an empty secret: an HMAC over an empty key still verifies. */
export function deriveLinkKey(serverSecret: string): Buffer {
  if (!serverSecret || serverSecret.length < 16) throw new Error('export link key: server secret missing or too short');
  return Buffer.from(hkdfSync('sha256', serverSecret, '', EXPORT_LINK_HKDF_INFO, 32));
}

export function mintExportLink(key: Buffer, input: { jobId: string; tenantId: string; mintedBy: string; nowSec: number; ttlSec?: number; jti?: string }): { token: string; claims: ExportLinkClaims } {
  const ttl = input.ttlSec ?? EXPORT_LINK_TTL_SEC;
  const claims: ExportLinkClaims = {
    jti: input.jti ?? randomUUID(), jobId: input.jobId, tenantId: input.tenantId, mintedBy: input.mintedBy,
    issuedAtSec: input.nowSec, expSec: input.nowSec + ttl,
  };
  const p = toB64url(Buffer.from(JSON.stringify({ v: 1, jti: claims.jti, job: claims.jobId, tid: claims.tenantId, sub: claims.mintedBy, iat: claims.issuedAtSec, exp: claims.expSec }), 'utf8'));
  const sig = toB64url(createHmac('sha256', key).update(p).digest());
  return { token: `${p}.${sig}`, claims };
}

/**
 * Verify a token AGAINST the job and tenant the request is for. Order matters and is deliberate: signature first (an
 * unsigned payload's contents are attacker-controlled and must decide nothing — not even which refusal to log), then
 * expiry, then binding. A token for another job in the same tenant is `refused_wrong_job`, not "ok, but redirected".
 */
export function verifyExportLink(key: Buffer, token: string | null | undefined, expect: { jobId: string; tenantId: string; nowSec: number }): LinkVerdict {
  if (!token) return { ok: false, outcome: 'refused_no_token', jti: null };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, outcome: 'refused_bad_signature', jti: null };
  const [p, s] = parts;
  const expected = createHmac('sha256', key).update(p).digest();
  const given = fromB64url(s);
  // Length first: `timingSafeEqual` throws on a length mismatch and a thrown TypeError would become a 500.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, outcome: 'refused_bad_signature', jti: null };

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(fromB64url(p).toString('utf8')) as Record<string, unknown>; }
  catch { return { ok: false, outcome: 'refused_bad_signature', jti: null }; }
  if (payload.v !== 1) return { ok: false, outcome: 'refused_bad_signature', jti: null };
  const jti = typeof payload.jti === 'string' ? payload.jti : null;
  const jobId = typeof payload.job === 'string' ? payload.job : '';
  const tenantId = typeof payload.tid === 'string' ? payload.tid : '';
  const mintedBy = typeof payload.sub === 'string' ? payload.sub : '';
  const iat = typeof payload.iat === 'number' ? payload.iat : NaN;
  const exp = typeof payload.exp === 'number' ? payload.exp : NaN;
  if (!jti || !jobId || !tenantId || !mintedBy || !Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, outcome: 'refused_bad_signature', jti };
  // `<=`: a link expiring at second N is dead AT second N. The canon says fifteen minutes, not fifteen minutes and a bit.
  if (exp <= expect.nowSec) return { ok: false, outcome: 'refused_expired', jti };
  if (jobId !== expect.jobId || tenantId !== expect.tenantId) return { ok: false, outcome: 'refused_wrong_job', jti };
  return { ok: true, claims: { jti, jobId, tenantId, mintedBy, issuedAtSec: iat, expSec: exp } };
}
