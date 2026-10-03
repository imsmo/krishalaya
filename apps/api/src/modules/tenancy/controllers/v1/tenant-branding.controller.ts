// modules/tenancy/controllers/v1/tenant-branding.controller.ts · PC-56 TENANT-13d · W191 + W2793–W2799 (validate → authorize → delegate).
// Founder decision: BRAND FOR ALL (no plan gate here — Rule Zero); publish needs a checker; contrast law. Every route needs
// `tenant.settings` (reads included); writes carry an Idempotency-Key; flag `tenant_branding` (default OFF).
//   GET  /tenant-branding                          the console: draft · published · contrast · plan facts · coverage · live proposal
//   POST /tenant-branding/preview                  W2794's review (writes nothing)
//   PUT  /tenant-branding/draft                    save the draft (direct; audited before → after)
//   POST /tenant-branding/logo                     RAW body image/png | image/svg+xml, ≤ 512 KB → judged, sanitised, stored (pending scan)
//   GET  /tenant-branding/logo/:mediaId            the draft logo for the console preview — only once the antivirus scan cleared it
//   GET  /tenant-branding/history | proposals | proposals/:id
//   POST /tenant-branding/proposals                publish (contrast + logo checks blocking; a second administrator)
//   POST /tenant-branding/rollback                 re-publish a history version through the same path
//   POST /tenant-branding/proposals/:id/confirm    a DIFFERENT tenant_admin (0194's trigger is the wall) — publishes in the same tx
//   POST /tenant-branding/proposals/:id/refuse     withdraw / refuse with a reason
import { Controller, Get, Headers, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { TenancyPermissions, tenantActorOf } from '../../policies/tenancy.policies';
import { TenantBrandingService } from '../../services/tenant-branding.service';
import { LOGO_MAX_BYTES } from '../../domain/logo-rules';
import { BrandLogoError } from '../../domain/tenancy.errors';
import {
  BrandDraftSchema, BrandDraftDto, BrandProposeSchema, BrandProposeDto, BrandRollbackSchema, BrandRollbackDto, RefuseSchema, RefuseDto,
  CursorQuerySchema, CursorQueryDto,
} from '../../dto/brand-domains.dto';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

/** Read a raw request body up to `max` bytes; one byte more and it is refused by name (413) without buffering the rest. */
export function readCappedBody(req: Request, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const preParsed = (req as unknown as { body?: unknown }).body;
    if (Buffer.isBuffer(preParsed)) {
      if (preParsed.length > max) { reject(new BrandLogoError('LOGO_TOO_LARGE', { bytes: preParsed.length, max })); return; }
      resolve(preParsed); return;
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) { reject(new BrandLogoError('LOGO_TOO_LARGE', { bytes: declared, max })); req.resume(); return; }
    const chunks: Buffer[] = []; let size = 0; let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) { done = true; reject(new BrandLogoError('LOGO_TOO_LARGE', { bytes: size, max })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

@Controller({ path: 'tenant-branding', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenant_branding')
export class TenantBrandingController {
  constructor(private readonly brand: TenantBrandingService) {}

  @Get() @RequirePermissions(TenancyPermissions.ManageTenant)
  console(@CurrentContext() ctx: RequestContext) { return this.brand.console(ctx.tenantId, tenantActorOf(ctx)).then((data) => ({ data })); }

  @Post('preview') @RequirePermissions(TenancyPermissions.ManageTenant)
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(BrandDraftSchema) dto: BrandDraftDto) {
    return this.brand.preview(ctx.tenantId, tenantActorOf(ctx), dto).then((data) => ({ data }));
  }
  @Put('draft') @RequirePermissions(TenancyPermissions.ManageTenant)
  saveDraft(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(BrandDraftSchema) dto: BrandDraftDto) {
    return this.brand.saveDraft(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('logo') @RequirePermissions(TenancyPermissions.ManageTenant)
  async logo(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Headers('content-type') contentType: string) {
    const body = await readCappedBody(r, LOGO_MAX_BYTES);
    return this.brand.uploadLogo(ctx.tenantId, tenantActorOf(ctx), reqKey(key), body, contentType ?? '', ipOf(r)).then((data) => ({ data }));
  }
  @Get('logo/:mediaId') @RequirePermissions(TenancyPermissions.ManageTenant)
  async draftLogo(@CurrentContext() ctx: RequestContext, @Param('mediaId') mediaId: string, @Res() res: Response) {
    const f = await this.brand.draftLogo(ctx.tenantId, tenantActorOf(ctx), mediaId);
    sendLogo(res, f.bytes, f.mime, 'private, max-age=60');
  }
  @Get('history') @RequirePermissions(TenancyPermissions.ManageTenant)
  history(@CurrentContext() ctx: RequestContext, @ZodQuery(CursorQuerySchema) q: CursorQueryDto) {
    return this.brand.history(ctx.tenantId, tenantActorOf(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('proposals') @RequirePermissions(TenancyPermissions.ManageTenant)
  proposals(@CurrentContext() ctx: RequestContext, @ZodQuery(CursorQuerySchema) q: CursorQueryDto) {
    return this.brand.proposals(ctx.tenantId, tenantActorOf(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('proposals/:id') @RequirePermissions(TenancyPermissions.ManageTenant)
  proposal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.brand.proposal(ctx.tenantId, tenantActorOf(ctx), id).then((data) => ({ data }));
  }
  @Post('proposals') @RequirePermissions(TenancyPermissions.ManageTenant)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(BrandProposeSchema) dto: BrandProposeDto) {
    return this.brand.propose(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('rollback') @RequirePermissions(TenancyPermissions.ManageTenant)
  rollback(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(BrandRollbackSchema) dto: BrandRollbackDto) {
    return this.brand.proposeRollback(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/confirm') @RequirePermissions(TenancyPermissions.ManageTenant)
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.brand.confirm(ctx.tenantId, tenantActorOf(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/refuse') @RequirePermissions(TenancyPermissions.ManageTenant)
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RefuseSchema) dto: RefuseDto) {
    return this.brand.refuse(ctx.tenantId, tenantActorOf(ctx), reqKey(key), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}

/**
 * The CONTENT-TYPE LOCK (brief A3): the type is the one recorded for the file (png | svg, nothing else), the browser is told not to sniff,
 * and an SVG is served under a CSP that runs nothing and loads nothing — even if a sanitiser bug ever let something through, it is inert.
 */
export function sendLogo(res: Response, bytes: Buffer, mime: string, cache: string): void {
  const type = mime === 'image/svg+xml' ? 'image/svg+xml' : 'image/png';
  res.status(200);
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Length', String(bytes.length));
  res.end(bytes);
}
