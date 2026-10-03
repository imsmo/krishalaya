// webhook-signature.ts · HOW EVERY OUTBOUND WEBHOOK IS SIGNED — PC-56 TENANT-13a (founder decision 2026-10-03: HMAC-SHA256 SHARED
// SECRET, ENCRYPTED AT REST, SHOWN ONCE). Byte-identical in apps/api/src/modules/tenant-webhooks/domain/webhook-signature.ts and
// apps/worker/src/jobs/webhook/webhook-signature.ts (parity spec): the receiver documentation the console prints and the bytes the
// worker sends come from the same lines.
//
//   signed string  `${t}.${rawBody}`            — t = unix seconds at send time, so a receiver can refuse a stale replay
//   header         `Krishalaya-Signature: t=<t>,v1=<hex hmac-sha256>`
//   rotation       inside the 24 h overlap the header carries TWO v1 values — the new secret's first, then the previous one's —
//                  so a receiver that still holds the old secret verifies, and one that already holds the new one verifies too
//   legacy alias   `X-KV-Signature` carries the identical value (receivers built against migration 0090's partner contract)
//
// `verifySignature` is the receiver's side of the contract, kept here so the platform's own tests verify exactly what a tenant's
// handler is told to verify (constant-time compare, tolerance window).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'Krishalaya-Signature';
export const LEGACY_SIGNATURE_HEADER = 'X-KV-Signature';
export const EVENT_HEADER = 'Krishalaya-Event';
export const DELIVERY_HEADER = 'Krishalaya-Delivery';
export const PAYLOAD_VERSION_HEADER = 'Krishalaya-Payload-Version';
export const DEFAULT_TOLERANCE_SEC = 300;

/** The v1 hex signature over `${timestampSec}.${body}`. */
export function computeSignature(secret: string, body: string, timestampSec: number): string {
  return createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
}

/** The header value: `t=<ts>,v1=<sig>[,v1=<sig of the previous secret>]`. Secrets in order: current first. */
export function signatureHeader(secrets: string | readonly string[], body: string, timestampSec: number): string {
  const list = (typeof secrets === 'string' ? [secrets] : [...secrets]).filter((s) => typeof s === 'string' && s.length > 0);
  if (list.length === 0) throw new Error('signatureHeader: no signing secret');
  return [`t=${timestampSec}`, ...list.map((s) => `v1=${computeSignature(s, body, timestampSec)}`)].join(',');
}

/** Parse `t=…,v1=…,v1=…` into its timestamp and every v1 value. */
export function parseSignatureHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null; const v1: string[] = [];
  for (const part of String(header ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  return { t, v1 };
}

/** The receiver's check: some v1 matches the HMAC of `${t}.${body}` under `secret`, and t is within tolerance of now. */
export function verifySignature(header: string, secret: string, body: string, nowSec: number, toleranceSec = DEFAULT_TOLERANCE_SEC): boolean {
  const { t, v1 } = parseSignatureHeader(header);
  if (t === null || v1.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const want = Buffer.from(computeSignature(secret, body, t), 'hex');
  return v1.some((sig) => {
    const got = Buffer.from(sig, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
