// core/feature-flags/flags.service.ts
// DB-backed feature flags (Law 10: every feature behind a flag, default OFF, kill-switch).
// Resolution for a flag `key` given the caller's tenant/user:
//   • unknown flag → OFF (fail-closed — a typo can't silently enable a feature);
//   • is_enabled=false → OFF for everyone (the KILL-SWITCH);
//   • rules.tenant_ids includes the tenant → ON (explicit allowlist, e.g. demo/anchor tenant);
//   • rules.plans / rules.countries exclude the caller → OFF (PC-56 ADMIN-11 — see below);
//   • otherwise deterministic percentage rollout by hash(key + tenant|user) < rollout_pct.
// Cached briefly so a toggle propagates within seconds without hammering the DB.
//
// ---------------------------------------------------------------------------------------------------------------
// PC-56 ADMIN-11 · THREE DEFECTS FIXED HERE, EACH VERIFIED BEFORE IT WAS TOUCHED
// ---------------------------------------------------------------------------------------------------------------
// 1. **`rules.plans` AND `rules.countries` WERE STORED, DISPLAYED AND IGNORED.** This file typed them in `FlagRow` and
//    read neither. A flag targeted at `countries: ['IN']` served every country while the console listed it as bounded —
//    the shape Rule Zero exists to catch, and worse than an absent feature because the console taught the operator that
//    the bound was in force. Now enforced via `targeting.ts`, with the tenant's plan and country resolved from
//    `tenant_flag_context` (0121).
// 2. **`deleted_at IS NULL` WAS MISSING.** The admin plane soft-deletes and filters; this read did not, so a deleted
//    flag kept evaluating. A flag nobody can see in the console and that still turns a feature on is the worst possible
//    version of a flag.
// 3. **THERE WAS NO FAIL-SAFE, THOUGH W004's ERROR STATE PROMISES ONE**: "Flags continue serving last-known values
//    (fail-safe)." `cache.wrap` has no error path, so after the 30s TTL expired a replica outage made `isEnabled` throw
//    and `FeatureFlagGuard` return 500 — a database blip turning every flagged feature into an error rather than into
//    its last known state. Now a load failure falls back to the last value this process saw.
import { Inject, Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { CACHE_SERVICE, CacheService } from '../cache/cache.service';
import { TargetingRules, passesTargeting } from './targeting';

export interface FlagContext { tenantId?: string; userId?: string }
interface FlagRow { is_enabled: boolean; rollout_pct: number; rules: TargetingRules }
const TTL = 30; // seconds — fast kill-switch propagation
/** How long a last-known value may serve after the database stopped answering. Ten minutes: long enough to ride out a
 *  failover, short enough that a flag flipped during an outage is not honoured for an afternoon. A kill-switch FIRED
 *  during an outage is the case this trades against, and the trade is stated rather than assumed — a stale ON is
 *  recoverable by the operator retrying; a 500 on every flagged read is not. */
const STALE_TTL = 600;

@Injectable()
export class FlagsService {
  constructor(private readonly pools: PgPoolProvider, @Inject(CACHE_SERVICE) private readonly cache: CacheService) {}

  async isEnabled(key: string, ctx: FlagContext = {}): Promise<boolean> {
    const flag = await this.load(key);
    if (!flag || !flag.is_enabled) return false;                 // unknown OR kill-switched ⇒ OFF

    const rules = flag.rules ?? {};
    // The allowlist is checked FIRST and wins over the percentage and over every other rule — a named pilot tenant must
    // not be dropped by somebody later adding a plan rule (see targeting.ts for the argument).
    const allow = rules.tenant_ids ?? [];
    if (ctx.tenantId && allow.includes(ctx.tenantId)) return true;

    // PLAN + COUNTRY. Resolved only when a rule needs them, so an untargeted flag — the common case — costs no extra
    // read at all.
    if ((rules.plans?.length ?? 0) > 0 || (rules.countries?.length ?? 0) > 0) {
      const subject = await this.subjectFor(ctx);
      if (!passesTargeting(rules, subject)) return false;
    }

    if (flag.rollout_pct >= 100) return true;
    if (flag.rollout_pct <= 0) return false;
    const subject = `${key}:${ctx.tenantId ?? ctx.userId ?? 'anon'}`;
    return this.bucket(subject) < flag.rollout_pct;
  }

  /** The tenant's plan and country, cached per tenant. Undefined fields are a real state — a tenant between
   *  subscriptions, or an anonymous storefront read — and `targeting.ts` treats unknown as EXCLUDED rather than as a
   *  match, because a flag limited to one country must not serve a caller whose country cannot be established. */
  private async subjectFor(ctx: FlagContext): Promise<{ tenantId?: string; userId?: string; planCode?: string; countryCode?: string }> {
    if (!ctx.tenantId) return { ...ctx };
    const row = await this.cache.wrap(`flagctx:${ctx.tenantId}`, TTL, async () => {
      const r = await this.pools.replica(0).query<{ plan_code: string | null; country_code: string | null }>(
        'SELECT plan_code, country_code FROM tenant_flag_context WHERE tenant_id = $1', [ctx.tenantId]);
      // `null` rather than `undefined` in the cache: a JSON round-trip drops undefined keys, and a cached `{}` would be
      // indistinguishable from "not cached" to the next reader.
      return r.rows[0] ?? { plan_code: null, country_code: null };
    }).catch(() => ({ plan_code: null, country_code: null }));
    return {
      ...ctx,
      planCode: row.plan_code ?? undefined,
      countryCode: row.country_code ?? undefined,
    };
  }

  async assertEnabled(key: string, ctx: FlagContext = {}): Promise<boolean> { return this.isEnabled(key, ctx); }

  /** The full flag map for the mobile remote-config endpoint (GET /v1/config/flags — core/feature-flags/
   *  flags.controller.ts). Deliberately SIMPLE: raw `is_enabled` (the kill-switch) only — no rollout_pct/
   *  tenant-allowlist evaluation, because that needs a caller identity (isEnabled's rollout hash keys on
   *  tenantId|userId) and this endpoint is called pre-login/anonymously at app boot, before any such identity
   *  exists. LIMITATION: a flag mid-percentage-rollout (is_enabled=true, rollout_pct<100) reads as globally "on"
   *  here even though isEnabled() would say "off" for most callers — acceptable because the client only ever
   *  treats this as a best-effort hint (hydrateFlags degrades to its built-in defaults on any failure/mismatch),
   *  and the kill-switch (is_enabled=false) — the actually load-bearing case — is exact. */
  async allEnabled(): Promise<Record<string, boolean>> {
    return this.cache.wrap('flags:all', TTL, async () => {
      const r = await this.pools.replica(0).query<{ key: string; is_enabled: boolean }>(
        `SELECT key, is_enabled FROM feature_flags WHERE deleted_at IS NULL`);
      const out: Record<string, boolean> = {};
      for (const row of r.rows) out[row.key] = row.is_enabled;
      return out;
    });
  }

  private async load(key: string): Promise<FlagRow | null> {
    try {
      const row = await this.cache.wrap(`flag:${key}`, TTL, async () => {
        const r = await this.pools.replica(0).query<FlagRow>(
          // `deleted_at IS NULL` — the admin plane soft-deletes and filters, and this read did not.
          `SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key=$1 AND deleted_at IS NULL`, [key]);
        const found = r.rows[0] ?? null;
        // Kept under a longer key so a later failure has something to serve. Written on the way out of a SUCCESSFUL
        // read only — a stale entry must never be refreshed from another stale entry.
        //
        // **WRAPPED IN ITS OWN TRY, NOT JUST `.catch()`** — and this cost a test failure before it was written. A cache
        // implementation without `set` throws SYNCHRONOUSLY, before any promise exists to catch, so `.catch()` never
        // runs and the exception escapes into the outer handler: the fail-safe would then swallow a perfectly good read
        // and return OFF. **A resilience feature must never make the normal path worse**, which is the same rule the
        // impersonation action log had to follow in the other direction.
        if (found) await this.trySet(`flagstale:${key}`, found);
        return found;
      });
      return row;
    } catch {
      // **W004's PROMISE, KEPT**: "Flags continue serving last-known values (fail-safe)." A miss here returns null,
      // which is OFF — fail-closed for a flag this process has never successfully read, which is the right default for
      // an unknown flag and the same answer the caller would have got before this wave.
      return await this.tryGetStale(key);
    }
  }

  /** Best-effort stale write. Swallows a missing method as well as a rejected promise — see the note above. */
  private async trySet(key: string, row: FlagRow): Promise<void> {
    try { await this.cache.set(key, row, STALE_TTL); } catch { /* the stale copy is an optimisation, never a requirement */ }
  }

  /** Best-effort stale read. Returns null — which is OFF — when there is nothing to serve, because a flag this process
   *  has never successfully read is an unknown flag and unknown has always meant off (fail-closed). */
  private async tryGetStale(key: string): Promise<FlagRow | null> {
    try { return (await this.cache.get<FlagRow>(`flagstale:${key}`)) ?? null; } catch { return null; }
  }
  /** Stable 0–99 bucket from a string (deterministic rollout). */
  private bucket(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 100;
  }
}
export const FLAGS_SERVICE = Symbol('FLAGS_SERVICE');
