// modules/support/controllers/v1/tickets.controller.ts · open + handle support tickets.
// open/csat are the requester's own (open needs an Idempotency-Key); assign/respond/transition need
// support.handle. Reads are owner-or-agent (404 for a stranger — no IDOR). `support` flag.
import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { SupportTicketService } from '../../services/support-ticket.service';
import { SupportThreadService } from '../../services/support-thread.service';
import { SupportPermissions, canHandleSupport } from '../../policies/support.policies';
import { OpenTicketSchema, OpenTicketDto } from '../../dto/create-support-ticket.dto';
import { AssignTicketSchema, AssignTicketDto, TransitionTicketSchema, TransitionTicketDto, CsatSchema, CsatDto } from '../../dto/update-support-ticket.dto';
import { QueryTicketsSchema, QueryTicketsDto } from '../../dto/query-support-ticket.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'support/tickets', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('support')
export class TicketsController {
  constructor(private readonly svc: SupportTicketService, private readonly threads: SupportThreadService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, isAgent: canHandleSupport(ctx) }; }

  @Post()
  open(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(OpenTicketSchema) dto: OpenTicketDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.open(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryTicketsSchema) q: QueryTicketsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, severity: q.severity, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  /** 03_API_CONTRACT_DELTA.md §520 (screen 520, PILOT-BLOCKING): lazily creates (first call) or returns the
   *  conversation linked to this ticket. Requester-or-agent-only (404 anti-IDOR, same convention as GET :id).
   *  The client then drives the actual chat via the EXISTING communication conversations/:id/messages GET/POST. */
  @Get(':id/thread')
  thread(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.threads.getOrCreateThread(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  @Post(':id/assign') @RequirePermissions(SupportPermissions.Handle)
  assign(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(AssignTicketSchema) dto: AssignTicketDto) { return this.svc.assign(ctx.tenantId, this.actor(ctx), id, dto.assigneeUserId, ctx.requestId).then((data) => ({ data })); }
  @Post(':id/respond') @RequirePermissions(SupportPermissions.Handle)
  respond(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.respond(ctx.tenantId, this.actor(ctx), id, ctx.requestId).then((data) => ({ data })); }
  @Post(':id/transition') @RequirePermissions(SupportPermissions.Handle)
  transition(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(TransitionTicketSchema) dto: TransitionTicketDto) { return this.svc.transition(ctx.tenantId, this.actor(ctx), id, dto, ctx.requestId).then((data) => ({ data })); }

  // PC-56 ADMIN-2c · every rating this ticket has ever had (0099). Before that migration a reopen DELETED the
  // previous rating, so this endpoint had nothing it could have returned.
  @Get(':id/csat')
  csatHistory(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.csatHistory(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  @Post(':id/csat')
  csat(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(CsatSchema) dto: CsatDto) { return this.svc.submitCsat(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
}
