// apps/admin-api/src/modules/support-oversight/support-oversight.controller.ts · god-mode cross-tenant support
// oversight (Law 11). Every route: AdminAuthGuard + OwnerPermissionsGuard. Reads need support.oversight.read; the
// one MUTATION (escalate — a cross-tenant override) needs support.oversight.manage + HardwareKeyGuard (FIDO2) +
// StepUpReauthGuard. validate (zod) → authorize (owner perm) → delegate ONLY. No money path (support is a helpdesk).
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { SlaBreachMonitorService } from './services/sla-breach-monitor.service';
import { TenantHealthAlertsService } from './services/tenant-health-alerts.service';
import { SupportMacrosService } from './services/support-macros.service';
import { SupportInsightsService } from './services/support-insights.service';
import { SupportPolicyService } from './services/support-policy.service';
import { CoachingService } from './services/coaching.service';
import { SupportExportService } from './services/support-export.service';
import { PlatformReplyService } from './services/platform-reply.service';
import { TicketEscalationsService } from './services/ticket-escalations.service';
import {
  QueryTicketsSchema, QueryTicketsDto, QueryBreachesSchema, QueryBreachesDto,
  TenantHealthSchema, TenantHealthDto, EscalateTicketSchema, EscalateTicketDto,
  QueryInsightsSchema, QueryInsightsDto, QueryCsatSchema, QueryCsatDto,
  CreateMacroSchema, CreateMacroDto, ToggleMacroSchema, ToggleMacroDto,
  PublishSupportPolicySchema, PublishSupportPolicyDto, ResolveTicketSchema, ResolveTicketDto,
  ReviewCsatSchema, ReviewCsatDto, CreateCoachingSchema, CreateCoachingDto,
  SettleCoachingSchema, SettleCoachingDto, ReviewQueueSchema, ReviewQueueDto,
  SupportExportSchema, SupportExportDto, QueryVerdictsSchema, QueryVerdictsDto,
  QueryCoachingSchema, QueryCoachingDto, ReplyToFarmerSchema, ReplyToFarmerDto,
} from './dto/support-oversight.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const toBool = (v?: string) => (v === undefined ? undefined : v === 'true');
const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'support', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SupportOversightController {
  constructor(
    private readonly monitor: SlaBreachMonitorService,
    private readonly health: TenantHealthAlertsService,
    private readonly escalations: TicketEscalationsService,
    private readonly macros: SupportMacrosService,
    private readonly insights: SupportInsightsService,
    private readonly policy: SupportPolicyService,
    private readonly coaching: CoachingService,
    private readonly exports: SupportExportService,
    private readonly replies: PlatformReplyService,
  ) {}

  /* ================= PC-56 ADMIN-2 · support-desk depth ================= */
  // AGENT PERFORMANCE (W055) and CSAT (W056) are reads over support_tickets — no new table, because the ticket already
  // records who handled it, when it was answered and what the requester scored it.
  @Get('insights/agents') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  agentInsights(@ZodQuery(QueryInsightsSchema) q: QueryInsightsDto) {
    return this.insights.agents(q).then((data) => ({ data }));
  }
  @Get('insights/csat') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  csatInsights(@ZodQuery(QueryCsatSchema) q: QueryCsatDto) {
    return this.insights.csat(q).then((data) => ({ data }));
  }
  // The SLA matrix the platform ACTUALLY enforces (W054). Served from the code constant, because there is no config
  // table — and the response says so, along with the fact that the escalation chain does not exist yet.
  @Get('sla-matrix') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  slaMatrix() { return { data: this.insights.slaMatrix() }; }

  // PC-56 ADMIN-2b · THE SUPPORT POLICY (W054 + W057 as one object) and what its chain actually did.
  @Get('policy') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  supportPolicy() { return this.policy.current().then((data) => ({ data })); }

  // Publishing a policy changes what the platform PROMISES and who gets woken, so it carries the elevation ceremony —
  // unlike a macro, this one really is consequential.
  @Post('policy') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  publishPolicy(@Req() req: any, @ZodBody(PublishSupportPolicySchema) dto: PublishSupportPolicyDto) {
    return this.policy.publish(admin(req), dto).then((data) => ({ data }));
  }

  // Counts for the queue's filter chips (W005). One grouped query, not one per chip.
  @Get('ticket-counts') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  ticketCounts() { return this.monitor.ticketCounts().then((data) => ({ data })); }

  // -------------------------------------------------------------------------
  // PC-56 ADMIN-2c · CSAT REVIEW (canon W056, W2121-25) and COACHING (W2019-25)
  // -------------------------------------------------------------------------
  // The review QUEUE is low ratings nobody has judged — not all low ratings. A queue that re-shows finished work is a
  // queue people stop trusting.
  @Get('csat/queue') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  csatQueue(@ZodQuery(ReviewQueueSchema) q: ReviewQueueDto) { return this.coaching.reviewQueue(q).then((data) => ({ data })); }

  @Get('csat/verdicts') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  csatVerdicts(@ZodQuery(QueryVerdictsSchema) q: QueryVerdictsDto) {
    return this.coaching.verdictSummary(q.from, q.to).then((data) => ({ data }));
  }

  @Get('csat/:id') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  csatResponse(@Param('id') id: string) { return this.coaching.response(id).then((data) => ({ data })); }

  // Filing a verdict is NOT elevated. It records a judgement and changes nothing about anybody's access or money, and
  // over-gating a control operators use forty times a day trains them to click through elevation prompts.
  @Post('csat/:id/review') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage)
  reviewCsat(@Req() req: any, @Param('id') id: string, @ZodBody(ReviewCsatSchema) dto: ReviewCsatDto) {
    return this.coaching.review(admin(req), id, dto).then((data) => ({ data }));
  }

  @Get('coaching') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  coachingList(@ZodQuery(QueryCoachingSchema) q: QueryCoachingDto) {
    return this.coaching.coachingList({ agentUserId: q.agentUserId, tenantId: q.tenantId }).then((data) => ({ data }));
  }

  // A coaching record IS elevated. It is a written statement about a named person's performance held in a system their
  // employer can be shown — the one place in this module where the hardware key is proportionate.
  @Post('coaching') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  createCoaching(@Req() req: any, @ZodBody(CreateCoachingSchema) dto: CreateCoachingDto) {
    return this.coaching.createCoaching(admin(req), dto).then((data) => ({ data }));
  }

  @Post('coaching/:id/settle') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  settleCoaching(@Req() req: any, @Param('id') id: string, @ZodBody(SettleCoachingSchema) dto: SettleCoachingDto) {
    return this.coaching.settleCoaching(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // PC-56 ADMIN-2d · PLATFORM REPLY TO A FARMER (canon W049, W2298-2304)
  // -------------------------------------------------------------------------
  // ELEVATED. This sends a message to a member of the public about their own money, in the platform's name — the one
  // support write where the hardware key is unarguable.
  //
  // It QUEUES. The response says `queued`, not `sent`, and it means it: delivery is performed by apps/api's
  // PlatformReplyDeliveryCadenceJob, which owns the notification fan-out. This realm cannot and must not claim a
  // delivery it does not perform.
  @Post('tickets/:id/reply') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  replyToFarmer(@Req() req: any, @Param('id') id: string, @ZodBody(ReplyToFarmerSchema) dto: ReplyToFarmerDto) {
    return this.replies.queue(admin(req), id, dto).then((data) => ({ data }));
  }

  @Get('tickets/:id/replies') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  ticketReplies(@Param('id') id: string) { return this.replies.forTicket(id).then((data) => ({ data })); }

  // Replies an operator wrote that never reached anybody. A queue nobody watches is a queue.
  @Get('replies/stuck') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  stuckReplies() { return this.replies.stuck().then((data) => ({ data })); }

  // -------------------------------------------------------------------------
  // PC-56 ADMIN-2c · EXPORTS (canon W1944-45, W2121-22, W2270-71)
  // -------------------------------------------------------------------------
  // POST because it MUTATES THE AUDIT LEDGER — the receipt is a write. Same reasoning as ADMIN-1d's billing export, and
  // it is also what keeps a prefetcher from silently producing export receipts.
  @Post('exports') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  supportExport(@Req() req: any, @ZodBody(SupportExportSchema) dto: SupportExportDto) {
    return this.exports.export(admin(req), dto).then((data) => ({ data }));
  }

  // MACROS (W053)
  @Get('macros') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  listMacros() { return this.macros.list().then((data) => ({ data })); }
  @Get('macros/:id/bodies') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  macroBodies(@Param('id') id: string) { return this.macros.bodies(id).then((data) => ({ data })); }

  // Authoring a macro is not money and touches no tenant record, so it carries the write permission without the
  // hardware-key ceremony — over-gating a harmless control trains people to treat elevation prompts as noise.
  @Post('macros') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage)
  createMacro(@Req() req: any, @ZodBody(CreateMacroSchema) dto: CreateMacroDto) {
    return this.macros.create(admin(req), dto).then((data) => ({ data }));
  }
  @Post('macros/:id/active') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage)
  toggleMacro(@Req() req: any, @Param('id') id: string, @ZodBody(ToggleMacroSchema) dto: ToggleMacroDto) {
    return this.macros.toggle(admin(req), id, dto).then((data) => ({ data }));
  }

  // ---- reads (cross-tenant NOC) ----
  @Get('tickets') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  listTickets(@ZodQuery(QueryTicketsSchema) q: QueryTicketsDto) {
    return this.monitor.listTickets({ tenantId: q.tenantId, status: q.status, severity: q.severity, slaBreached: toBool(q.slaBreached), assigned: toBool(q.assigned), cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('sla-breaches') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  listBreaches(@ZodQuery(QueryBreachesSchema) q: QueryBreachesDto) {
    return this.monitor.listBreaches({ tenantId: q.tenantId, severity: q.severity, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('tenant-health') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  tenantHealth(@ZodQuery(TenantHealthSchema) q: TenantHealthDto) {
    return this.health.health(q).then((res) => ({ data: res.items }));
  }
  @Get('tickets/:id') @RequireOwnerPermission(OwnerPermissions.SupportOversightRead)
  getTicket(@Param('id') id: string) { return this.monitor.getTicket(id).then((data) => ({ data })); }

  // ---- mutation: cross-tenant override → manage perm + FIDO2 + step-up ----
  // PC-56 ADMIN-2b · RESOLVE with a mandatory outcome (W049). A ticket marked done with nothing saying what was done is
  // unanswerable when the farmer comes back.
  @Post('tickets/:id/resolve') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  resolveTicket(@Req() req: any, @Param('id') id: string, @ZodBody(ResolveTicketSchema) dto: ResolveTicketDto) {
    return this.escalations.resolve(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post('tickets/:id/escalate') @RequireOwnerPermission(OwnerPermissions.SupportOversightManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  escalate(@Req() req: any, @Param('id') id: string, @ZodBody(EscalateTicketSchema) dto: EscalateTicketDto) {
    return this.escalations.escalate(admin(req), id, dto).then((data) => ({ data }));
  }
}
