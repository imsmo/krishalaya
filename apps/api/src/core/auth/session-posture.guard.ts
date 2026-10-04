// core/auth/session-posture.guard.ts · PC-56 TENANT-SW-c · TWO PER-REQUEST FACTS ABOUT A SESSION THAT A SIGNED TOKEN CANNOT CARRY.
//
// An access token is a signed snapshot (roles + permissions, 15 minutes by default — JWT_ACCESS_TTL_SEC). Two decisions taken
// AFTER it was minted must still bind it:
//
//   1. REMOVED FROM THE TEAM (W184 "Remove from team … sessions end"). Sessions are PERSON-wide in this platform (a refresh token
//      serves any tenant), so removal writes a per-tenant cut-off (`tenant_session_revocations`). Here, an access token for that
//      tenant ISSUED AT OR BEFORE the cut-off answers 401 `SESSION_REVOKED`; the refresh path refuses a session born before it
//      (auth.service). THE REAL BOUND is this guard's cache: the cut-off is read through CACHE_SERVICE for at most
//      SESSION_POSTURE_CACHE_SECONDS (30 s) and the remove act DELETES the key, so with the shared Redis cache it binds on the next
//      request and with the in-memory fallback (one pod per process) within 30 s. The console prints that bound, not the canon's "60s".
//   2. THE TENANT REQUIRES 2FA FOR STAFF (`security.require_staff_2fa`, a 13b security setting). A session whose roles include a
//      staff role (roles.is_staff) and whose person has no CONFIRMED TOTP answers 403 `TWO_FACTOR_REQUIRED` on every route except
//      the ones marked `@TwoFactorExempt()` (the person's own /me/2fa routes and /auth). A member (no staff role) is never asked.
//
// GLOBAL (APP_GUARD) for the reason the auditor and impersonation guards are: a rule remembered per route is forgotten on one.
// It never applies to anonymous requests, API-key principals (13c) or act-as sessions (ADMIN-9b — read-only by their own guard).
// Reads go to the WRITER pool (a removal must not be hidden by replica lag) and are cached; a cache or database failure FAILS OPEN
// for 2FA (never locks a whole organisation out because Redis blinked) and FAILS OPEN for the cut-off too — stated here, because
// the refresh path (which does not depend on this cache) still refuses the removed person's session within the access TTL.
import { CanActivate, ExecutionContext, Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../shared/errors/app-error';
import { tryGetRequestContext } from '../tenancy-context/request-context';
import { CACHE_SERVICE, CacheService } from '../cache/cache.service';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { ShardRouter } from '../sharding/shard-router';

export const TWO_FACTOR_EXEMPT_KEY = 'two_factor_exempt';
/** A route a staff member without 2FA may still reach when their organisation requires it (their own enrolment, sign-in, sign-out). */
export const TwoFactorExempt = () => SetMetadata(TWO_FACTOR_EXEMPT_KEY, true);

export const SESSION_POSTURE_CACHE_SECONDS = 30;
export const REQUIRE_STAFF_2FA_KEY = 'security.require_staff_2fa';

export const postureKeys = {
  cutoff: (tenantId: string, userId: string) => `posture:cutoff:${tenantId}:${userId}`,
  totp: (userId: string) => `posture:totp:${userId}`,
  require2fa: (tenantId: string) => `posture:require2fa:${tenantId}`,
  staffRoles: () => 'posture:staff-roles',
};

export class SessionRevokedError extends AppError {
  constructor() { super('SESSION_REVOKED', 'This session has ended — your access to this organisation was changed. Sign in again.', 401, { rule: 'tenant_session_cutoff' }); }
}
export class TwoFactorRequiredError extends AppError {
  constructor() {
    super('TWO_FACTOR_REQUIRED', 'Your organisation requires two-factor sign-in for staff. Set it up at /me/security with an authenticator app, then continue.', 403,
      { setting: REQUIRE_STAFF_2FA_KEY, enrolAt: '/me/security' });
  }
}

/** The facts, each cached; also the one place that INVALIDATES them (the remove act, the 2FA acts, the setting apply). */
@Injectable()
export class SessionPostureService {
  constructor(
    private readonly pools: PgPoolProvider,
    private readonly shards: ShardRouter,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
  ) {}

  private async q<T>(tenantId: string | null, sql: string, params: unknown[]): Promise<T[]> {
    const pool = this.pools.writer(tenantId ? this.shards.shardFor(tenantId) : 0);
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return r.rows as T[];
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }

  /** The per-tenant cut-off in epoch ms, or null (never removed). */
  async cutoffMs(tenantId: string, userId: string): Promise<number | null> {
    const v = await this.cache.wrap<{ at: number | null }>(postureKeys.cutoff(tenantId, userId), SESSION_POSTURE_CACHE_SECONDS, async () => {
      const rows = await this.q<{ at: string }>(tenantId, `SELECT (extract(epoch from revoked_after) * 1000)::bigint::text AS at FROM tenant_session_revocations WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
      return { at: rows[0] ? Number(rows[0].at) : null };
    });
    return v?.at ?? null;
  }

  async totpConfirmed(userId: string): Promise<boolean> {
    const v = await this.cache.wrap<{ on: boolean }>(postureKeys.totp(userId), SESSION_POSTURE_CACHE_SECONDS, async () => {
      const rows = await this.q<{ on: boolean }>(null, `SELECT (confirmed_at IS NOT NULL AND disabled_at IS NULL) AS on FROM user_totp WHERE user_id = $1`, [userId]);
      return { on: Boolean(rows[0]?.on) };
    });
    return Boolean(v?.on);
  }

  async requireStaff2fa(tenantId: string): Promise<boolean> {
    const v = await this.cache.wrap<{ on: boolean }>(postureKeys.require2fa(tenantId), SESSION_POSTURE_CACHE_SECONDS, async () => {
      const rows = await this.q<{ on: boolean }>(tenantId,
        `SELECT COALESCE((SELECT ts.value FROM tenant_settings ts WHERE ts.tenant_id = $1 AND ts.key = $2 AND ts.deleted_at IS NULL),
                         (SELECT sd.default_value FROM setting_definitions sd WHERE sd.key = $2)) = 'true'::jsonb AS on`, [tenantId, REQUIRE_STAFF_2FA_KEY]);
      return { on: Boolean(rows[0]?.on) };
    });
    return Boolean(v?.on);
  }

  async staffRoleCodes(): Promise<string[]> {
    const v = await this.cache.wrap<{ codes: string[] }>(postureKeys.staffRoles(), 300, async () => {
      const rows = await this.q<{ code: string }>(null, `SELECT code FROM roles WHERE is_staff AND deleted_at IS NULL ORDER BY code`, []);
      return { codes: rows.map((r) => r.code) };
    });
    return v?.codes ?? [];
  }

  async forgetCutoff(tenantId: string, userId: string): Promise<void> { await this.cache.del(postureKeys.cutoff(tenantId, userId)).catch(() => undefined); }
  async forgetTotp(userId: string): Promise<void> { await this.cache.del(postureKeys.totp(userId)).catch(() => undefined); }
  async forgetRequirement(tenantId: string): Promise<void> { await this.cache.del(postureKeys.require2fa(tenantId)).catch(() => undefined); }
}

/** PURE: the guard's decision. */
export function postureVerdict(f: { issuedAtSec?: number; cutoffMs: number | null; isStaff: boolean; required: boolean; confirmed: boolean; exempt: boolean }):
  'pass' | 'SESSION_REVOKED' | 'TWO_FACTOR_REQUIRED' {
  if (f.cutoffMs !== null && f.issuedAtSec !== undefined && f.issuedAtSec * 1000 <= f.cutoffMs) return 'SESSION_REVOKED';
  if (!f.exempt && f.isStaff && f.required && !f.confirmed) return 'TWO_FACTOR_REQUIRED';
  return 'pass';
}

@Injectable()
export class SessionPostureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Optional() private readonly posture?: SessionPostureService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http' || !this.posture) return true;
    const rc = tryGetRequestContext();
    if (!rc || !rc.userId || !rc.tenantId || rc.apiKey || rc.apiKeyRefusal || rc.impersonation) return true;
    const exempt = this.reflector.getAllAndOverride<boolean>(TWO_FACTOR_EXEMPT_KEY, [ctx.getHandler(), ctx.getClass()]) ?? false;
    let cutoffMs: number | null = null;
    try { cutoffMs = await this.posture.cutoffMs(rc.tenantId, rc.userId); } catch { cutoffMs = null; }
    let isStaff = false; let required = false; let confirmed = true;
    if (!exempt) {
      try {
        const staff = await this.posture.staffRoleCodes();
        isStaff = (rc.roles ?? []).some((r) => staff.includes(r));
        if (isStaff) {
          required = await this.posture.requireStaff2fa(rc.tenantId);
          if (required) confirmed = await this.posture.totpConfirmed(rc.userId);
        }
      } catch { required = false; }
    }
    const v = postureVerdict({ issuedAtSec: rc.issuedAtSec, cutoffMs, isStaff, required, confirmed, exempt });
    if (v === 'SESSION_REVOKED') throw new SessionRevokedError();
    if (v === 'TWO_FACTOR_REQUIRED') throw new TwoFactorRequiredError();
    return true;
  }
}
