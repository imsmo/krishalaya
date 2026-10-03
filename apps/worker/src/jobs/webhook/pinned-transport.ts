// apps/worker/src/jobs/webhook/pinned-transport.ts · THE ONE WAY A WEBHOOK LEAVES THE PLATFORM — PC-56 TENANT-13a (F-3).
//
//   • PINNED: the connection goes to the ONE address the guard vetted (webhook-ssrf.vetWebhookTarget). `lookup` is overridden to answer
//     with that address and nothing else, so the socket never re-resolves — a DNS answer that changes between the check and the connect
//     (rebinding) cannot be reached. SNI (`servername`) and the Host header carry the real name, so TLS verifies the real certificate;
//     certificate verification is never relaxed.
//   • NO REDIRECTS: node's https.request does not follow them, and this file does not either — a 3xx is returned as a 3xx and the job
//     records it as a failure ("redirect: 307 refused"). The Location is never fetched (the old worker's fetch() followed it from inside
//     the VPC).
//   • BOUNDED: 10 s for the whole exchange (connect + TLS + request + response), and at most 64 KiB of the response body is read —
//     the rest is discarded and the socket destroyed. The body is not stored either way; only the status code is.
//   • Port 443 only (the guard already refused any other).
// The request function is injectable so the spec can prove each property without a network.
import https from 'node:https';
import type { IncomingMessage, ClientRequest, RequestOptions } from 'node:http';
import type { ResolvedAddress } from './webhook-ssrf';
import { RESPONSE_BODY_CAP_BYTES, SEND_TIMEOUT_MS } from './webhook-rail.state';

export interface PinnedTarget { host: string; port: 443; path: string; pinned: ResolvedAddress }
export type TransportResult =
  | { kind: 'response'; status: number; durationMs: number; bodyBytes: number; truncated: boolean }
  | { kind: 'error'; error: string; durationMs: number };
export type Transport = (target: PinnedTarget, body: string, headers: Record<string, string>) => Promise<TransportResult>;
export type RequestFn = (options: RequestOptions & { servername?: string }, cb: (res: IncomingMessage) => void) => ClientRequest;

/** Classify a socket / TLS error into the prefix the delivery log groups by (never the URL). */
export function classifyError(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? '');
  const msg = String((e as Error)?.message ?? e ?? '').slice(0, 160);
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) return `timeout: no answer within ${SEND_TIMEOUT_MS / 1000}s`;
  if (/^ERR_TLS|CERT|SSL/i.test(code) || /certificate|tls|ssl/i.test(msg)) return `tls: ${code || msg}`;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EPIPE') return `connect: ${code}`;
  return `network: ${code || msg || 'unknown'}`;
}

export function makePinnedTransport(request: RequestFn = https.request as unknown as RequestFn, timeoutMs = SEND_TIMEOUT_MS, capBytes = RESPONSE_BODY_CAP_BYTES): Transport {
  return (target, body, headers) => new Promise<TransportResult>((resolve) => {
    const t0 = Date.now();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (r: TransportResult) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(r); } };
    const payload = Buffer.from(body, 'utf8');
    let req: ClientRequest;
    try {
      req = request({
        host: target.host, port: 443, path: target.path, method: 'POST', servername: target.host,
        headers: { ...headers, host: target.host, 'content-length': String(payload.length) },
        // the pin: whatever the name, the socket connects to the vetted address
        lookup: ((_h: string, _o: unknown, cb: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void) => {
          const all = (_o as { all?: boolean } | undefined)?.all;
          if (all) cb(null, [{ address: target.pinned.address, family: target.pinned.family }]);
          else cb(null, target.pinned.address, target.pinned.family);
        }) as unknown as RequestOptions['lookup'],
        agent: false,
      }, (res) => {
        const status = res.statusCode ?? 0;
        let bytes = 0; let truncated = false;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > capBytes && !truncated) { truncated = true; res.destroy(); done({ kind: 'response', status, durationMs: Date.now() - t0, bodyBytes: capBytes, truncated: true }); }
        });
        res.on('end', () => done({ kind: 'response', status, durationMs: Date.now() - t0, bodyBytes: Math.min(bytes, capBytes), truncated }));
        res.on('error', () => done({ kind: 'response', status, durationMs: Date.now() - t0, bodyBytes: Math.min(bytes, capBytes), truncated }));
        // a 3xx is answered as itself: the Location is never followed
      });
    } catch (e) {
      done({ kind: 'error', error: classifyError(e), durationMs: Date.now() - t0 });
      return;
    }
    timer = setTimeout(() => { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); done({ kind: 'error', error: classifyError({ code: 'ETIMEDOUT' }), durationMs: Date.now() - t0 }); }, timeoutMs);
    req.on('error', (e) => done({ kind: 'error', error: classifyError(e), durationMs: Date.now() - t0 }));
    req.end(payload);
  });
}
