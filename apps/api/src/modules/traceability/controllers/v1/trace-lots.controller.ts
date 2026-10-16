// modules/traceability/controllers/v1/trace-lots.controller.ts · create lots + append the journey (authed).
// create/append need trace.manage (Idempotency-Key on create); reads are owner-or-manager (404, no IDOR).
// `traceability` flag. validate→authorize→delegate only.
import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE, BIGINT_RE } from '../../../../shared/pagination/us-keyset';
import { TraceLotService } from '../../services/trace-lot.service';
import { TracePermissions, canManageTrace } from '../../policies/traceability.policies';
import { CreateTraceLotSchema, CreateTraceLotDto } from '../../dto/create-trace-lot.dto';
import { AppendEventSchema, AppendEventDto } from '../../dto/create-trace-event.dto';
import { QueryLotsSchema, QueryLotsDto } from '../../dto/query-trace-lot.dto';
import { QueryEventsSchema, QueryEventsDto } from '../../dto/query-trace-event.dto';
import { TraceStep } from '../../domain/traceability.events';

// PC-56 HOTFIX-7 · B24: µs keysets (shared/pagination/us-keyset.ts) — lots by (created_at, uuid), a lot's events by (created_at, the bigserial id).
// A pre-HOTFIX-7 cursor (milliseconds, or the event hash) reads as page one, never a guess.
const decodeLotCursor = (c?: string) => { const k = decodeKeyset(c, UUID_RE); return k ? { c: k.ts, id: k.id } : undefined; };
const decodeEventCursor = (c?: string) => { const k = decodeKeyset(c, BIGINT_RE); return k ? { c: k.ts, id: k.id } : undefined; };

@Controller({ path: 'traceability/lots', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('traceability')
export class TraceLotsController {
  constructor(private readonly svc: TraceLotService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageTrace(ctx) }; }

  @Post() @RequirePermissions(TracePermissions.Manage)
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateTraceLotSchema) dto: CreateTraceLotDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryLotsSchema) q: QueryLotsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, listingId: q.listingId, cursor: decodeLotCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/events') @RequirePermissions(TracePermissions.Manage)
  append(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(AppendEventSchema) dto: AppendEventDto) {
    return this.svc.appendEvent(ctx.tenantId, this.actor(ctx), id, dto.eventCode as TraceStep, dto.meta).then((data) => ({ data }));
  }
  @Get(':id/events')
  events(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryEventsSchema) q: QueryEventsDto) {
    return this.svc.listEvents(ctx.tenantId, this.actor(ctx), id, { cursor: decodeEventCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
}
