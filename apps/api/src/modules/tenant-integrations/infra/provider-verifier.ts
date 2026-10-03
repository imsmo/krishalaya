// modules/tenant-integrations/infra/provider-verifier.ts · PC-56 TENANT-13c (F-8) · VERIFY A CREDENTIAL AGAINST ITS PROVIDER, IN SHADOW.
//
// "Verifies in shadow before anything is stored" (canon W2644) is now a call, not a sentence:
//   • razorpay  (account_fetch)    GET https://api.razorpay.com/v1/payments?count=1 with HTTP Basic keyId:keySecret — the cheapest
//                                  authenticated read Razorpay offers; 200 = the key pair is live, 401 = it is not;
//   • gupshup   (balance_profile)  GET https://api.gupshup.io/sm/api/v2/wallet/balance with the `apikey` header;
//   • inaph     (token_check)      NO endpoint is configured on this platform (integration_providers.verify_url IS NULL), so an INAPH
//                                  token cannot be verified and is therefore NEVER stored — refused by name ("unknown: no verification
//                                  endpoint is configured"). The day NDDB's endpoint is configured (admin-api, kv_admin), it verifies.
// THE TRANSPORT is the 13a discipline, in the API process: the URL passes the same SSRF guard the webhook worker uses (https, port 443,
// every resolved address public) and the socket is PINNED to the vetted address (no re-resolution: no rebinding); redirects are NEVER
// followed (a 3xx is an `unknown` result); 10 s for the whole exchange; at most 64 KiB of the body is read and none of it is stored.
// Wrapped in core/resilience (breaker + bulkhead per provider, no retry — a verification is a question, asked once).
// THE CREDENTIAL never appears in a result, a log line or a metric label: `detail` carries the HTTP status or the network class only.
// In tests the port is bound to a fake (no network); production binds this class.
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { Resolver, ResolvedAddress, vetWebhookTarget } from '../../tenant-webhooks/domain/webhook-ssrf';
import { VerifyResult, classifyStatus } from '../domain/provider-rules';

export const PROVIDER_VERIFIER = Symbol('PROVIDER_VERIFIER');
export interface ProviderRef { code: string; verifyMethod: string | null; verifyUrl: string | null }
export interface ProviderVerifier {
  verify(provider: ProviderRef, credential: Record<string, string>): Promise<VerifyResult>;
}

export const VERIFY_TIMEOUT_MS = 10_000;
export const VERIFY_BODY_CAP = 64 * 1024;
export type GetFn = (options: RequestOptions & { servername?: string }, cb: (res: IncomingMessage) => void) => ClientRequest;

/** The request headers a provider's verification needs (pure — the spec checks them without a network). */
export function verificationHeaders(p: ProviderRef, c: Record<string, string>): Record<string, string> | null {
  switch (p.verifyMethod) {
    case 'account_fetch':   return c.keyId && c.keySecret ? { authorization: `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64')}` } : null;
    case 'balance_profile': return c.apiKey ? { apikey: c.apiKey } : null;
    case 'token_check':     return c.token ? { authorization: `Bearer ${c.token}` } : null;
    default:                return null;
  }
}

export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** One pinned GET: connects only to `pinned`, never follows a redirect, bounded in time and bytes. */
export function pinnedGet(request: GetFn, target: { host: string; path: string; pinned: ResolvedAddress }, headers: Record<string, string>, timeoutMs = VERIFY_TIMEOUT_MS):
  Promise<{ kind: 'response'; status: number; durationMs: number } | { kind: 'error'; error: string; durationMs: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (r: { kind: 'response'; status: number; durationMs: number } | { kind: 'error'; error: string; durationMs: number }) => {
      if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(r); }
    };
    let req: ClientRequest;
    try {
      req = request({
        host: target.host, port: 443, path: target.path, method: 'GET', servername: target.host, agent: false,
        headers: { ...headers, host: target.host, accept: 'application/json', 'user-agent': 'krishalaya-verify/1' },
        lookup: ((_h: string, o: unknown, cb: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void) => {
          if ((o as { all?: boolean } | undefined)?.all) cb(null, [{ address: target.pinned.address, family: target.pinned.family }]);
          else cb(null, target.pinned.address, target.pinned.family);
        }) as unknown as RequestOptions['lookup'],
      }, (res) => {
        const status = res.statusCode ?? 0; let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > VERIFY_BODY_CAP) { res.destroy(); done({ kind: 'response', status, durationMs: Date.now() - t0 }); } });
        res.on('end', () => done({ kind: 'response', status, durationMs: Date.now() - t0 }));
        res.on('error', () => done({ kind: 'response', status, durationMs: Date.now() - t0 }));
      });
    } catch (e) { done({ kind: 'error', error: String((e as { code?: string })?.code ?? 'request'), durationMs: Date.now() - t0 }); return; }
    timer = setTimeout(() => { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); done({ kind: 'error', error: 'ETIMEDOUT', durationMs: Date.now() - t0 }); }, timeoutMs);
    req.on('error', (e) => done({ kind: 'error', error: String((e as { code?: string })?.code ?? 'network'), durationMs: Date.now() - t0 }));
    req.end();
  });
}

export class HttpProviderVerifier implements ProviderVerifier {
  private readonly configured = new Set<string>();
  constructor(private readonly resilience: ResilienceService, private readonly resolve: Resolver = systemResolver, private readonly request: GetFn = https.request as unknown as GetFn) {}

  async verify(p: ProviderRef, credential: Record<string, string>): Promise<VerifyResult> {
    if (!p.verifyUrl) return { ok: false, errorClass: 'unknown', detail: `no verification endpoint is configured for ${p.code} on this platform`, httpStatus: null, durationMs: 0 };
    const headers = verificationHeaders(p, credential);
    if (!headers) return { ok: false, errorClass: 'auth', detail: 'the credential is incomplete for this provider', httpStatus: null, durationMs: 0 };
    const target = await vetWebhookTarget(p.verifyUrl, this.resolve);
    if (!target.ok) return { ok: false, errorClass: 'network', detail: `the verification endpoint was refused by the transport guard (${target.reason})`, httpStatus: null, durationMs: 0 };
    const dep = `provider.verify.${p.code}`;
    // the transport's own 10 s bound decides; the resilience timeout sits just above it so it never cuts an answer short
    if (!this.configured.has(dep)) { this.resilience.configure(dep, { timeoutMs: VERIFY_TIMEOUT_MS + 1_000, retries: 0 }); this.configured.add(dep); }
    try {
      const r = await this.resilience.run(dep, () => pinnedGet(this.request, target, headers), { retries: 0 });
      if (r.kind === 'error') return { ok: false, errorClass: 'network', detail: `no answer (${r.error})`, httpStatus: null, durationMs: r.durationMs };
      if (r.status >= 300 && r.status < 400) return { ok: false, errorClass: 'unknown', detail: `redirect ${r.status} refused — the Location is never followed`, httpStatus: r.status, durationMs: r.durationMs };
      const cls = classifyStatus(r.status);
      return { ok: cls === null, errorClass: cls, detail: `HTTP ${r.status}`, httpStatus: r.status, durationMs: r.durationMs };
    } catch (e) {
      return { ok: false, errorClass: 'network', detail: `provider unavailable (${String((e as { code?: string })?.code ?? 'circuit')})`, httpStatus: null, durationMs: 0 };
    }
  }
}
