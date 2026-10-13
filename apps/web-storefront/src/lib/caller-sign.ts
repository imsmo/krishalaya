// apps/web-storefront/src/lib/caller-sign.ts · PC-56 STORE-1a · C2 (founder D3) — the storefront's half of the signed client address.
//
// Every buyer's API call leaves from this server, so without this the API saw ONE client and its per-IP limits became site-wide (survey
// F-1). We forward the buyer's address in `x-kv-client-ip` with `x-kv-client-ts` and `x-kv-client-sig` = hex HMAC-SHA256 over
// `${ip}|${ts}`; the API honours it only when the signature verifies (apps/api/src/core/http/client-ip.ts). `clientIpSignature` below is
// IDENTICAL to the API's (drift spec: src/test/caller-sign.spec.ts reads both files; same known-answer vector in both suites).
//
// WHERE THE BUYER'S ADDRESS COMES FROM (the documented assumption). Next 14 self-hosted does not expose the socket address to a Server
// Component or Action: it only fills `x-forwarded-for` with it WHEN THE CLIENT SENT NONE (`??=`), so a client-sent value is
// indistinguishable from the real one. Therefore:
//   • STOREFRONT_TRUST_PROXY=1 — the storefront runs behind ONE trusted edge proxy / load balancer that OVERWRITES x-forwarded-for with
//     the connecting client's address: the first hop is the buyer. (Deploy note: an appending proxy needs this changed to its hop count.)
//   • unset — no address can be trusted, so NONE is forwarded and the API accounts the call to this server (the pre-STORE-1a behaviour;
//     per-phone OTP limits still hold). Never a client-controlled value signed as if it were true.
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/** Hex HMAC-SHA256 over `${ip}|${ts}` — byte-identical to the API's `clientIpSignature`. */
export function clientIpSignature(ip: string, ts: string, secret: string): string {
  return createHmac('sha256', secret).update(`${ip}|${ts}`).digest('hex');
}

/** The buyer's address from x-forwarded-for, only under a trusted proxy. Null when untrusted, absent or not an IP literal. */
export function clientIpFromForwarded(xff: string | null | undefined, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const first = String(xff ?? '').split(',')[0]?.trim() ?? '';
  return first && first.length <= 45 && isIP(first) !== 0 ? first : null;
}

/** The three headers for one API call (a fresh timestamp each time — the API refuses one older than 300 s). Empty without a secret. */
export function signedClientHeaders(ip: string | null, secret: string, nowSec: number = Math.floor(Date.now() / 1000)): Record<string, string> {
  if (!ip || !secret) return {};
  const ts = String(nowSec);
  return { 'x-kv-client-ip': ip, 'x-kv-client-ts': ts, 'x-kv-client-sig': clientIpSignature(ip, ts, secret) };
}
