// modules/communication/controllers/v1/masked-calls.controller.ts · privacy-proxy calling + own call log.
// initiate requires an Idempotency-Key (it places a real telephony bridge — Law 3). Reads are the caller's own
// log (caller OR callee). `communication` flag.
// PC-56 HOTFIX-6 · B1 (founder D2): the body names a CONVERSATION (`{ conversationId }`, `.strict()` — a `calleeUserId` is refused); the
// service resolves the callee and checks participant, tenant membership and `user_blocks` before the provider is asked. Per-user rate limit
// 5 / 60 s (the module had no limit of its own; the brief's default) through the global RateLimitGuard. The gate is AuthGuard + the server's
// membership check (an active role in this tenant, read from user_tenant_roles) — no seeded permission verb fits a call (`messages.send`
// does not exist; `message.moderate` would make calling a moderator act): named as a HOTFIX-6 deviation, `message.call` owed with Q2.
import { Controller, Get, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { MaskedCallService } from '../../services/masked-call.service';
import { InitiateMaskedCallSchema, InitiateMaskedCallDto } from '../../dto/initiate-masked-call.dto';
import { QueryMaskedCallsSchema, QueryMaskedCallsDto } from '../../dto/query-masked-call.dto';

import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';

// PC-56 STORE-4b · B4: the µs keyset (a pre-4b millisecond cursor reads as page one); D3: the list's buyer shape names no person (the service).
const decodeCursor = (c?: string) => { const k = decodeKeyset(c, UUID_RE); return k ? { c: k.ts, id: k.id } : undefined; };

@Controller({ path: 'masked-calls', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class MaskedCallsController {
  constructor(private readonly svc: MaskedCallService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, isModerator: false }; }

  @RateLimit({ limit: 5, windowSec: 60, by: 'user' })
  @Post()
  initiate(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') header: string, @ZodBody(InitiateMaskedCallSchema) dto: InitiateMaskedCallDto, @Ip() ip: string) {
    const key = header || dto.idempotencyKey;
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.initiateForConversation(ctx.tenantId, this.actor(ctx), key, dto, ip || null).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryMaskedCallsSchema) q: QueryMaskedCallsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
}
