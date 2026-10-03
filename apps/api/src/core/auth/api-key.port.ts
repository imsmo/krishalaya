// core/auth/api-key.port.ts · PC-56 TENANT-13c (F-9) · THE TENANT API KEY AS A CREDENTIAL REALM — the port core reads.
//
// A tenant API key is `Authorization: Bearer kv_live_<prefix 8>_<secret 32>`. It is NOT a JWT, and the most dangerous thing
// the tenant-context middleware could do with one is what it did before this file existed: fail to verify it as a JWT, treat
// the caller as anonymous, and take the TENANT FROM THE `X-Tenant-Id` HEADER. So the middleware asks this port first, for any
// bearer that has the key shape, and the tenant then comes from the KEY ROW — never from a header (`X-Tenant-Id` and
// `X-Tenant-Slug` are ignored on key auth, by construction: the header is never read on that branch).
//
// Core owns the shape and the decorator; the implementation (the DB lookup, the constant-time compare, the plan / flag / owner
// checks) lives in modules/tenant-api-keys and is bound here by a @Global provider. With no implementation bound, a key-shaped
// bearer is REFUSED (fail closed), never anonymous.
import { SetMetadata } from '@nestjs/common';

export const API_KEY_AUTHENTICATOR = Symbol('API_KEY_AUTHENTICATOR');

/** `kv_live_` + 8 [a-z0-9] + `_` + 32 base64url. Fixed positions (base64url may itself contain `_`). `kv_test_` is NOT issued:
 *  this platform has no tenant sandbox mode, so there is only live (the console says so). */
export const TENANT_KEY_RE = /^kv_live_([a-z0-9]{8})_([A-Za-z0-9_-]{32})$/;
/** Anything that STARTS like a tenant key is routed to key auth, well-formed or not — so a malformed key is refused as a key
 *  rather than falling through to anonymous + header tenancy. */
export function looksLikeTenantApiKey(raw: string): boolean {
  return /^kv_(live|test)_/.test(raw);
}

export interface ApiKeyPrincipal {
  keyId: string;
  keyPrefix: string;
  tenantId: string;
  /** The person who created the key: every act is recorded on their behalf (`on_behalf_of`), and the key can never do more
   *  than they can — their current roles and permissions are the key's, and the scope narrows further. */
  onBehalfOf: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  ratePerHour: number;
}

/** A presented key the realm refused. `code` is the stable error the global guard answers with. */
export interface ApiKeyRefusal {
  code: 'API_KEY_INVALID' | 'KEY_REVOKED' | 'KEY_EXPIRED' | 'KEY_PENDING_CHECKER' | 'KEY_OWNER_LOST_ACCESS' | 'PLAN_FEATURE_REQUIRED' | 'API_KEYS_DISABLED';
  keyPrefix?: string;
  revokedReason?: string | null;
}

export type ApiKeyAuthResult = { ok: true; principal: ApiKeyPrincipal } | { ok: false; refusal: ApiKeyRefusal };

export interface ApiKeyAuthenticator {
  authenticate(raw: string): Promise<ApiKeyAuthResult>;
}

/** Route metadata: the ONE scope a tenant key must hold for this route (exact match — no wildcard, no prefix family). A route
 *  without it does not accept key auth at all (the global ApiKeyAuthGuard refuses). The routes that carry it are exactly the
 *  catalogue's (modules/tenant-api-keys/domain/api-scopes.ts — a spec over the real router pins the equality). */
export const API_SCOPES_KEY = 'tenant_api_scope';
export const ApiScopes = (scope: string) => SetMetadata(API_SCOPES_KEY, scope);

/** What a key WITHOUT `members.read.pii` may see of a person: the first name and the initial of the last ("Ramesh Patel" →
 *  "Ramesh P."). The roster read model already masks every phone. */
export function shortName(full: string | null | undefined): string | null {
  if (!full) return null;
  const parts = String(full).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}.`;
}

/** True when this request is a key that may not see member PII (a human console session is never narrowed by this). */
export function keyWithoutPii(rc: { apiKey?: { scopes: string[] } } | undefined): boolean {
  return Boolean(rc?.apiKey) && !rc!.apiKey!.scopes.includes('members.read.pii');
}
