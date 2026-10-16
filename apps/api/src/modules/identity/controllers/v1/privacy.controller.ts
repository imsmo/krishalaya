// modules/identity/controllers/v1/privacy.controller.ts · DPDP data-subject rights (export / deletion / status).
// All scoped to the CALLER's own userId (re-resolved from the token — no client id, zero IDOR). The platform is
// the data controller (Law 11): these endpoints only REGISTER a request; fulfilment is server-owned. No feature
// flag — exercising your DPDP rights is a core self-service. Requests are idempotent (Law 3).
// PC-56 STORE-4a (founder D1 / D2): the export request enqueues the PERSONAL dataset on the export plane (its job joins `GET requests`); the
// deletion request is REFUSED (`DSR_BLOCKED`, 409, with the figures) while orders, escrow or a wallet balance are open; `GET commitments` serves
// the confirm page the same figures + the retention years + the cooling days (a read — nothing moves). Both acts are audited `dsr.requested`.
import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpOf } from '../../../../core/http/client-ip';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PrivacyService } from '../../services/privacy.service';

@Controller({ path: 'privacy', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  private key(k: string) { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; }

  @Post('export-requests')
  export(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @Req() req: Request) {
    return this.privacy.requestExport(ctx.tenantId, ctx.userId, this.key(key), clientIpOf(req)).then((data) => ({ data }));
  }
  @Post('deletion-requests')
  deletion(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @Req() req: Request, @Body('reason') reason?: string) {
    return this.privacy.requestDeletion(ctx.tenantId, ctx.userId, this.key(key), typeof reason === 'string' ? reason : undefined, clientIpOf(req)).then((data) => ({ data }));
  }
  /** The deletion confirm's figures — the caller's own, across every organisation (0214 `kv_person_open_commitments`). Read-only. */
  @Get('commitments')
  commitments(@CurrentContext() ctx: RequestContext) {
    return this.privacy.commitments(ctx.tenantId, ctx.userId).then((data) => ({ data }));
  }
  @Get('requests')
  mine(@CurrentContext() ctx: RequestContext) {
    return this.privacy.listMine(ctx.tenantId, ctx.userId).then((res) => ({ data: res.items }));
  }
}
