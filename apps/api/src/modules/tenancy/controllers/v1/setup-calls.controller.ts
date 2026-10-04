// modules/tenancy/controllers/v1/setup-calls.controller.ts · PC-56 TENANT-SW-d · W2619–W2625 — "Book a setup call (free)".
// Behind `tenancy` AND `setup_calls` (flags compose — 6d-2). The tenant side only: request (one open per tenant), list its own (µs keyset),
// cancel with a reason. Scheduling and closing are the admin realm's (apps/admin-api `setup-calls-ops`, Law 11).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { tenantActorOf } from '../../policies/tenancy.policies';
import { SetupCallService } from '../../services/setup-call.service';
import { istInstant } from '../../domain/setup-call';
import { swdTenancyRefusal } from '../../domain/swd.errors';
import { CancelSetupCallSchema, SetupCallDto, SetupCallListSchema, SetupCallSchema } from '../../dto/onboarding-governance.dto';
import { z } from 'zod';

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };

@Controller({ path: 'tenancy/setup-calls', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy', 'setup_calls')
export class SetupCallsController {
  constructor(private readonly svc: SetupCallService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(SetupCallListSchema) q: z.infer<typeof SetupCallListSchema>) {
    return this.svc.list(ctx.tenantId, tenantActorOf(ctx), decodeKeyset(q.cursor, UUID_RE), q.limit ?? 20)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, zone: r.zone } }));
  }

  @Post()
  request(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(SetupCallSchema) dto: SetupCallDto) {
    const start = istInstant(dto.date, dto.from); const end = istInstant(dto.date, dto.to);
    if (!start || !end) throw swdTenancyRefusal('SETUP_CALL_SLOT_INVALID');
    return this.svc.request(ctx.tenantId, tenantActorOf(ctx), needKey(key), { slotStart: start, slotEnd: end, languageCode: dto.languageCode, notes: dto.notes ?? null }, r.ip || null)
      .then((data) => ({ data }));
  }

  @Post(':id/cancel')
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(CancelSetupCallSchema) body: { reason: string }) {
    return this.svc.cancel(ctx.tenantId, tenantActorOf(ctx), idOf(id), body.reason, r.ip || null).then((data) => ({ data }));
  }
}
