// apps/admin-api/src/modules/operator-auth/services/oidc-client.ts · PC-56 ADMIN-AUTH-1 — the IdP, behind a timeout.
//
// Three outbound calls, each bounded by ADMIN_OIDC_HTTP_TIMEOUT_MS (Law 12: wrap every external dependency): discovery
// (`/.well-known/openid-configuration`, cached 1 h), the JWKS (cached 1 h; refetched on an unknown kid, at most once per
// 30 s), and the authorization-code exchange (never cached, never retried — a code is single-use at the IdP).
//
// DEGRADE, NEVER DIE does not mean "let them in": when the IdP is unreachable, sign-in FAILS (a generic error page) and
// every already-signed-in operator carries on, because their admin JWT is verified locally and never touches the IdP.
import { AdminConfig } from '../../../core/config/admin-config';
import { Jwk, KeyResolver } from '../domain/oidc';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface DiscoveryDoc { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }

export class OidcUnavailableError extends Error {
  constructor(public readonly reason: string) { super(`identity provider unavailable: ${reason}`); this.name = 'OidcUnavailableError'; }
}

const DISCOVERY_TTL_MS = 3_600_000;
const JWKS_TTL_MS = 3_600_000;
export const JWKS_MIN_REFETCH_MS = 30_000;

/** Constructed by a factory in OperatorAuthModule (production: Node's global fetch). Tests pass a fake IdP's fetch. */
export class OidcClient implements KeyResolver {
  private discovery: { doc: DiscoveryDoc; atMs: number } | null = null;
  private jwks: { keys: Jwk[]; atMs: number } | null = null;
  /** Exposed for tests (the "unknown kid triggers exactly one refetch" proof). */
  jwksFetchCount = 0;

  constructor(private readonly config: AdminConfig, private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now) {}

  private async getJson(url: string, init?: Parameters<FetchLike>[1]): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.config.oidc.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...(init ?? {}), signal: ctl.signal });
      if (!res.ok) throw new OidcUnavailableError(`HTTP ${res.status} from ${new URL(url).host}`);
      return await res.json();
    } catch (e) {
      if (e instanceof OidcUnavailableError) throw e;
      throw new OidcUnavailableError(ctl.signal.aborted ? 'timeout' : 'network');
    } finally { clearTimeout(timer); }
  }

  async discover(): Promise<DiscoveryDoc> {
    if (this.discovery && this.now() - this.discovery.atMs < DISCOVERY_TTL_MS) return this.discovery.doc;
    const issuer = this.config.oidc.issuer;
    const doc = await this.getJson(`${issuer}/.well-known/openid-configuration`) as Partial<DiscoveryDoc>;
    // The discovery document must describe THIS issuer (OIDC Discovery §4.3) — a mismatch is a misconfiguration or worse.
    if (!doc || doc.issuer !== issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new OidcUnavailableError('discovery document does not match the configured issuer');
    }
    if (this.config.isProd) {
      for (const u of [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri]) {
        if (!String(u).startsWith('https://')) throw new OidcUnavailableError('discovery endpoints must be https');
      }
    }
    this.discovery = { doc: doc as DiscoveryDoc, atMs: this.now() };
    return this.discovery.doc;
  }

  private async loadJwks(): Promise<void> {
    const { jwks_uri } = await this.discover();
    this.jwksFetchCount += 1;
    const body = await this.getJson(jwks_uri) as { keys?: unknown };
    const keys = Array.isArray(body?.keys) ? (body.keys as Jwk[]).filter((k) => k && typeof k.kty === 'string') : [];
    this.jwks = { keys, atMs: this.now() };
  }

  /** KeyResolver. `refresh` = the token named a kid we do not hold; refetch only if the last fetch is ≥ 30 s old. */
  async keyFor(kid: string | undefined, refresh: boolean): Promise<Jwk | null> {
    const stale = !this.jwks || this.now() - this.jwks.atMs >= JWKS_TTL_MS;
    const mayRefetch = refresh && (!this.jwks || this.now() - this.jwks.atMs >= JWKS_MIN_REFETCH_MS);
    if (stale || mayRefetch) await this.loadJwks();
    const keys = this.jwks?.keys ?? [];
    if (kid) return keys.find((k) => k.kid === kid) ?? null;
    return keys.length === 1 ? keys[0] : null;   // no kid: only unambiguous when the set holds exactly one key
  }

  /** The authorization URL for a new flow (Authorization Code + PKCE S256 + state + nonce). */
  async authorizationUrl(v: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
    const { authorization_endpoint } = await this.discover();
    const o = this.config.oidc;
    const u = new URL(authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', o.clientId);
    u.searchParams.set('redirect_uri', o.redirectUri);
    u.searchParams.set('scope', 'openid email');
    u.searchParams.set('state', v.state);
    u.searchParams.set('nonce', v.nonce);
    u.searchParams.set('code_challenge', v.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('prompt', 'select_account');
    // Google's `hd` request parameter is a UI hint only (the server re-checks the claim); sent when it is unambiguous.
    if (o.allowedDomains.length === 1) u.searchParams.set('hd', o.allowedDomains[0]);
    return u.toString();
  }

  /** Exchange the code (client_secret_post + the PKCE verifier). Returns the raw id_token; verification is the caller's. */
  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const { token_endpoint } = await this.discover();
    const o = this.config.oidc;
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: o.redirectUri,
      client_id: o.clientId, client_secret: o.clientSecret, code_verifier: codeVerifier,
    }).toString();
    const res = await this.getJson(token_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body,
    }) as { id_token?: unknown };
    if (typeof res?.id_token !== 'string') throw new OidcUnavailableError('token response carried no id_token');
    return res.id_token;
  }
}
