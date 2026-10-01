// modules/communication/controllers/v1/whatsapp.controller.ts · PC-56 TENANT-8e · W425 (the hub) and W430 (the one record a
// cooperative can write about WhatsApp today: its opt-in policy). `communication` flag + authentication; the verbs are the
// service's (a refusal is a sentence). There is no connect, disconnect, toggle, number, webhook or send route here, by
// design: no provider exists (F-15) and a route that pretended otherwise would be the fake this wave refuses.
import { Controller, Get, Headers, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { canManageWhatsAppPolicy, canReadBroadcasts } from '../../policies/communication.policies';
import { WhatsAppService } from '../../services/whatsapp.service';
import { OptinPolicySchema, OptinPolicyDto } from '../../dto/create-broadcast.dto';

@Controller({ path: 'channels/whatsapp', version: '1' })
@UseGuards(AuthGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class WhatsAppController {
  constructor(private readonly svc: WhatsAppService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canRead: canReadBroadcasts(ctx), canManagePolicy: canManageWhatsAppPolicy(ctx) }; }

  @Get()
  hub(@CurrentContext() ctx: RequestContext) { return this.svc.hub(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('optin-policy')
  policy(@CurrentContext() ctx: RequestContext) { return this.svc.policy(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Post('optin-policy/preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(OptinPolicySchema) dto: OptinPolicyDto) {
    return this.svc.previewPolicy(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  @Put('optin-policy')
  save(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(OptinPolicySchema) dto: OptinPolicyDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.savePolicy(ctx.tenantId, this.actor(ctx), key, dto, { ip: r.ip || null, requestId: ctx.requestId ?? null }).then((data) => ({ data }));
  }
}
