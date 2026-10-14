// core/tenancy-context/storefront-public.controller.ts · PC-56 STORE-1b · B2 — five `@Public()`, rate-limited, read-only routes for the
// anonymous storefront's two homes (canon W273 platform home, W274 tenant home). Same family as `storefront/tenant` + `storefront/branding`
// (storefront-branding.controller.ts): the tenant, where one is needed, is the REQUEST's context (X-Tenant-Slug / verified Host /
// X-Tenant-Id → TenantContextMiddleware, which already refused an anonymous caller a trial tenant — founder D4), never a parameter.
//
//   GET /v1/storefront/profile        D4 — the context tenant's public profile (404 TENANT_NOT_FOUND when none / not live)
//   GET /v1/storefront/stats          D3 — the PRECOMPUTED platform counts + computedAt (never computed here)
//   GET /v1/storefront/discover       D1 — the cross-tenant feed (cross_tenant listings of live tenants), keyset ?after=&limit=
//   GET /v1/storefront/organisations  D1 — verified live organisations, keyset ?after=&limit=
//   GET /v1/storefront/flags          B2 — ALLOW-LISTED booleans; never rules or percentages. PC-56 STORE-1c (founder D1) adds
//                                     `org_self_signup`, a PLATFORM switch (evaluated with no tenant — the same `{}` the signup gate uses), so
//                                     the platform's own /for-organisations page (no tenant in context) can ask it: with no tenant the answer
//                                     carries ONLY the platform-scoped keys; a tenant-scoped key (`group_lots`) is answered only for a tenant.
//   GET /v1/storefront/plans?country=XX  STORE-1c · D2 — the PUBLIC plan catalogue of a country (a platform table, no RLS — read model header)
//
// No money moves, nothing is written: each is a SELECT through a 0204 SECURITY DEFINER function (storefront-public.read-model.ts), or — for
// the plans — a plain SELECT of the platform catalogue.
import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../http/rate-limit.guard';
import { DomainError } from '../../shared/errors/app-error';
import { FlagsService } from '../feature-flags/flags.service';
import { CurrentContext } from './current-context.decorator';
import { RequestContext } from './request-context';
import { StorefrontPublicReadModel, countryParam } from './storefront-public.read-model';

/** B2: the ONLY flags an anonymous storefront may ask about. Adding one is a reviewed code change, never a query parameter. */
export const STOREFRONT_PUBLIC_FLAGS = Object.freeze(['group_lots', 'org_self_signup'] as const);
export type StorefrontPublicFlag = (typeof STOREFRONT_PUBLIC_FLAGS)[number];
/** STORE-1c: which allow-listed flags are PLATFORM switches (evaluated with no tenant, answered even when no tenant is in context). */
export const PLATFORM_SCOPED_FLAGS: ReadonlySet<StorefrontPublicFlag> = new Set<StorefrontPublicFlag>(['org_self_signup']);

const notFound = () => new DomainError('TENANT_NOT_FOUND', 'No organisation is served here', 404);
const one = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

@Controller({ path: 'storefront', version: '1' })
export class StorefrontPublicController {
  constructor(private readonly reads: StorefrontPublicReadModel, private readonly flags: FlagsService) {}

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get('profile')
  async profile(@CurrentContext() ctx: RequestContext) {
    if (!ctx.tenantId) throw notFound();
    const p = await this.reads.profile(ctx.tenantId);
    if (!p) throw notFound();
    return { data: p };
  }

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get('stats')
  async stats() {
    return { data: await this.reads.stats() };
  }

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get('discover')
  async discover(@Query() q: Record<string, unknown>) {
    const page = await this.reads.discover({ after: one(q.after), limit: q.limit, categoryId: one(q.category), q: one(q.q) });
    return { data: page.items, meta: { nextCursor: page.nextCursor } };
  }

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get('organisations')
  async organisations(@Query() q: Record<string, unknown>) {
    const page = await this.reads.organisations({ after: one(q.after), limit: q.limit });
    return { data: page.items, meta: { nextCursor: page.nextCursor } };
  }

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get('flags')
  async publicFlags(@CurrentContext() ctx: RequestContext): Promise<{ data: Partial<Record<StorefrontPublicFlag, boolean>> }> {
    const out: Partial<Record<StorefrontPublicFlag, boolean>> = {};
    for (const key of STOREFRONT_PUBLIC_FLAGS) {
      const platform = PLATFORM_SCOPED_FLAGS.has(key);
      if (!platform && !ctx.tenantId) continue;            // a tenant-scoped flag with no organisation in context has nothing to be about
      // a flag-store failure reads as OFF (the storefront then says the feature is off — never a 500 on a home page)
      try { out[key] = await this.flags.isEnabled(key, platform ? {} : { tenantId: ctx.tenantId }); } catch { out[key] = false; }
    }
    return { data: out };
  }

  /** STORE-1c · D2: the public plans of `?country=XX` (two letters). A missing / malformed country is refused by name, never defaulted. */
  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get('plans')
  async plans(@Query() q: Record<string, unknown>) {
    const country = countryParam(q.country);
    if (!country) throw new DomainError('COUNTRY_REQUIRED', 'country must be a two-letter ISO 3166-1 code (?country=IN)', 400);
    return { data: await this.reads.plans(country) };
  }
}
