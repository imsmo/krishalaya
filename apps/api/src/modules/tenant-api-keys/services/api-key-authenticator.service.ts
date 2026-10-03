// modules/tenant-api-keys/services/api-key-authenticator.service.ts · PC-56 TENANT-13c (F-9) · the implementation of core's
// API_KEY_AUTHENTICATOR port — WHO a presented key is. Called by the tenant-context middleware for any key-shaped bearer, BEFORE a
// tenant is resolved from anywhere else. Order, each failing closed:
//   1. shape          — parse with the pure rules; junk never reaches the DB.
//   2. existence      — ONE lookup by exact prefix (`api_key_for_prefix`, definer rights: the tenant is not known yet).
//   3. secret         — sha256 + timingSafeEqual against the stored hash.
//      (1–3 all answer the same opaque API_KEY_INVALID: no prefix oracle. Past this point the caller holds the real secret.)
//   4. tenant         — the key's tenant must be live (trial / active / grace), else the same opaque refusal.
//   5. state          — revoked → KEY_REVOKED (with the re-issue path) · expired → KEY_EXPIRED · waiting → KEY_PENDING_CHECKER.
//                       The row is read on EVERY call (no cache), so a revocation takes effect on the next call.
//   6. flag           — `tenant_api` for this tenant (OFF → the realm is invisible: 404).
//   7. plan           — `api_access` read for real (tenant override, else the subscription's plan) → PLAN_FEATURE_REQUIRED.
//   8. owner          — the key acts ON BEHALF OF its creator with their CURRENT roles and permissions; if they no longer hold
//                       `api.manage` (left the organisation, lost tenant_admin, suspended), the key stops: KEY_OWNER_LOST_ACCESS.
// The scope, the quota and the idempotency rule are the global guard's (they need the route).
import { Inject, Injectable } from '@nestjs/common';
import { ApiKeyAuthenticator, ApiKeyAuthResult, ApiKeyRefusal } from '../../../core/auth/api-key.port';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { guardRefusalFor } from '../domain/api-key.state';
import { parseKey, secretMatches } from '../domain/api-key.rules';
import { ApiAccess, ApiKeyRepository } from '../repositories/api-key.repository';

export const TENANT_API_FLAG = 'tenant_api';
const LIVE_TENANT = new Set(['trial', 'active', 'grace']);
const PLAN_TTL_SEC = 60;

@Injectable()
export class ApiKeyAuthenticatorService implements ApiKeyAuthenticator {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly flags: FlagsService,
    private readonly roles: RoleCacheService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  private refuse(refusal: ApiKeyRefusal, reason: string): ApiKeyAuthResult {
    this.metrics.inc('tenant_api.denied', { reason });
    return { ok: false, refusal };
  }

  async authenticate(raw: string): Promise<ApiKeyAuthResult> {
    const parsed = parseKey(raw);
    if (!parsed) return this.refuse({ code: 'API_KEY_INVALID' }, 'malformed');
    const row = await this.repo.findByPrefix(parsed.prefix);
    if (!row) return this.refuse({ code: 'API_KEY_INVALID' }, 'unknown_prefix');
    if (!secretMatches(parsed.secret, row.keyHash)) return this.refuse({ code: 'API_KEY_INVALID' }, 'bad_secret');
    if (!LIVE_TENANT.has(row.tenantStatus)) return this.refuse({ code: 'API_KEY_INVALID' }, 'tenant_not_live');
    const state = guardRefusalFor(row, Date.now());
    if (state) return this.refuse({ code: state, keyPrefix: parsed.prefix, revokedReason: state === 'KEY_REVOKED' ? row.revokedReason : null }, state.toLowerCase());
    if (!(await this.flags.isEnabled(TENANT_API_FLAG, { tenantId: row.tenantId }))) return this.refuse({ code: 'API_KEYS_DISABLED' }, 'flag_off');
    const access = await this.planAccess(row.tenantId);
    if (!access.enabled) return this.refuse({ code: 'PLAN_FEATURE_REQUIRED', keyPrefix: parsed.prefix }, 'plan');
    if (!row.createdBy) return this.refuse({ code: 'KEY_OWNER_LOST_ACCESS', keyPrefix: parsed.prefix }, 'no_owner');
    const owner = await this.roles.effectiveAccess(row.createdBy, row.tenantId);
    if (!owner.permissions.includes('api.manage') && !owner.permissions.includes('*')) {
      return this.refuse({ code: 'KEY_OWNER_LOST_ACCESS', keyPrefix: parsed.prefix }, 'owner_lost_access');
    }
    this.metrics.inc('tenant_api.authenticated', { tenant: row.tenantId });
    return {
      ok: true,
      principal: {
        keyId: row.id, keyPrefix: parsed.prefix, tenantId: row.tenantId, onBehalfOf: row.createdBy,
        roles: owner.roles, permissions: owner.permissions, scopes: row.scopes, ratePerHour: row.ratePerHour,
      },
    };
  }

  /** `api_access`, cached 60 s per tenant (a plan change reaches keys within a minute); a cache outage reads the DB. */
  private async planAccess(tenantId: string): Promise<ApiAccess> {
    const key = `tk:plan:${tenantId}`;
    try {
      const hit = await this.cache.get<ApiAccess>(key);
      if (hit) return hit;
    } catch { /* read through */ }
    const fresh = await this.repo.apiAccessRead(tenantId);
    try { await this.cache.set(key, fresh, PLAN_TTL_SEC); } catch { /* best effort */ }
    return fresh;
  }
}
