// modules/twin/controllers/v1/twin-access.controller.ts · PC-56 TENANT-12 · W420's LOCKED STATE — deliberately NOT behind the
// `digital_twin` flag (a tenant without the Twin must still see the honest pitch and ask the account desk ONCE). `twin.view` only;
// a role without it sees "Twin access needed" (403 → the console's restricted state).
import { Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { TwinAccessService } from '../../services/twin-access.service';
import { EmptySchema } from '../../dto/twin.dto';

@Controller({ path: 'twin', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('twin.view')
export class TwinAccessController {
  constructor(private readonly svc: TwinAccessService) {}

  /** Is the Twin licensed for this tenant (the flag), and has the account desk already been asked (once, ever)? */
  @Get('access')
  state(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.svc.state(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null }).then((data) => ({ data }));
  }
  /** "Ask your account desk" — one idempotent row per tenant; never a repeated nag (F-15). Keyed; the first ask is audited. */
  @Post('access-request')
  request(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(EmptySchema) _dto: Record<string, never>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.request(ctx.tenantId, { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null }, key).then((data) => ({ data }));
  }
}
