// modules/memberships/controllers/v1/governance.controller.ts · PC-54 W54-7 `governance-agm`, PC-56 TENANT-1e, TENANT-9b.
//
// [PC-56 TENANT-9b] W198 (`/governance/resolutions`) + the form chain W2741–W2744 + the mutate chain W2745–W2747:
//   • behind the `memberships` flag (Law 10) — before 9b the API answered with the flag OFF and only the sidebar hid it;
//   • drafting, editing a draft, open / close / withdraw need `governance.manage` (0182 — no board role exists; named) and
//     are judged by the SERVICE so a refusal is a sentence (`GOVERNANCE_REFUSED`, every code by name), never a bare 403;
//   • every write takes the Idempotency-Key its review / confirm page minted (Law 3); open/close used to take none;
//   • the old `:id/open` / `:id/close` routes are GONE — one write path, through the confirm (6d-4's rule);
//   • reads (`list`, `results`, `catalogue`) need no verb: W198 — "Live tally visible to every member";
//   • an auditor session is refused every route here that is not a GET by 9c's global guard, with nothing to add.
import { Controller, Get, Headers, Param, Patch, Post, Query, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ForbiddenError } from '../../../../shared/errors/app-error';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { GovernanceService, GovActor } from '../../services/governance.service';
import { CoopPayoutService } from '../../services/coop-payout.service';
import { ShareRegisterReadModel } from '../../read-models/share-register.read-model';
import { DRAFT_FIELDS, isResolutionAct, RESOLUTION_ACTS, ResolutionAct } from '../../domain/resolution-rules';
import { z } from 'zod';

/** Every draft field as a string — the REVIEW judges them (lengths included), so the schema only bounds transport. */
const DraftSchema = z.object(Object.fromEntries(DRAFT_FIELDS.map((f) => [f, z.string().max(f === 'body' ? 20_000 : 600).optional()])) as Record<string, z.ZodOptional<z.ZodString>>).strict();
const PreviewSchema = DraftSchema.extend({ id: z.string().regex(UUID_RE).optional() }).strict();
const ActSchema = z.object({ reasonCode: z.string().max(60).optional(), note: z.string().max(1000).optional() }).strict();
const ListSchema = z.object({
  status: z.enum(['draft', 'open', 'closed', 'withdrawn']).optional(),
  type: z.string().max(30).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();
const CancelRunSchema = z.object({ reason: z.string().min(3).max(300) }).strict();
const VoteSchema = z.object({ choice: z.string().trim().min(1).max(20) }).strict();

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const actOf = (a: string): ResolutionAct => { if (!isResolutionAct(a)) throw new BadRequestError(`'${a}' is not a resolution act (${RESOLUTION_ACTS.join(', ')})`); return a; };

@Controller({ path: 'governance/resolutions', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('memberships')
export class GovernanceController {
  constructor(private readonly svc: GovernanceService, private readonly payouts: CoopPayoutService,
              private readonly register_: ShareRegisterReadModel) {}
  private gov(ctx: RequestContext, req: Request): GovActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null }; }
  /** The payout run keeps the gate it always had (tenant.settings) — a money desk's code is not this wave's to move. */
  private payer(ctx: RequestContext) { return { userId: ctx.userId, canManage: ctx.permissions.has('tenant.settings') || ctx.permissions.has('*') }; }

  /** W198: the list — keyset (µs), GET-form filters status / type / year; each row's result from its snapshot. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(ListSchema) q: z.infer<typeof ListSchema>) {
    return this.svc.list(ctx.tenantId, { status: q.status, type: q.type, year: q.year }, decodeKeyset(q.cursor, UUID_RE), q.limit ?? 20)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, zone: r.zone } }));
  }

  /** The form's vocabulary: types, declared choices per type, act reasons, today's rules, zone, currency, fiscal year. */
  @Get('catalogue')
  catalogue(@CurrentContext() ctx: RequestContext) { return this.svc.catalogue(ctx.tenantId).then((data) => ({ data })); }

  /** W2742: the review the API computes (read-only). */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(PreviewSchema) dto: z.infer<typeof PreviewSchema>) {
    const { id, ...input } = dto as Record<string, string | undefined>;
    return this.svc.previewDraft(ctx.tenantId, this.gov(ctx, req), input, id).then((data) => ({ data }));
  }

  /** W2743: create (keyed). */
  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(DraftSchema) dto: z.infer<typeof DraftSchema>) {
    return this.svc.create(ctx.tenantId, this.gov(ctx, req), needKey(key), dto as Record<string, string>).then((data) => ({ data }));
  }

  /** The edit chain's prefill (a draft's values in the form's own shape — civil times in the cooperative's zone). */
  @Get(':id/draft')
  draft(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.draftValues(ctx.tenantId, idOf(id)).then((data) => ({ data })); }

  /** Edit while a draft (keyed). */
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(DraftSchema) dto: z.infer<typeof DraftSchema>) {
    return this.svc.update(ctx.tenantId, this.gov(ctx, req), idOf(id), needKey(key), dto as Record<string, string>).then((data) => ({ data }));
  }

  /** W2745: the verdict at confirm (read-only) — open · close · withdraw. */
  @Post(':id/acts/:act/preview')
  previewAct(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @Param('act') act: string, @ZodBody(ActSchema) dto: z.infer<typeof ActSchema>) {
    return this.svc.previewAct(ctx.tenantId, this.gov(ctx, req), idOf(id), actOf(act), dto).then((data) => ({ data }));
  }

  /** W2746: the act (keyed) — recorded with actor · time · reason · before/after; the members told on open and close. */
  @Post(':id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('act') act: string, @ZodBody(ActSchema) dto: z.infer<typeof ActSchema>) {
    return this.svc.transition(ctx.tenantId, this.gov(ctx, req), idOf(id), actOf(act), dto, needKey(key)).then((data) => ({ data }));
  }

  /**
   * Cast or CHANGE this member's own vote.
   *
   * **NO PERMISSION DECORATOR, AND THAT IS CORRECT — BUT IT WAS NOT SUFFICIENT.** W198 is explicit: "the vote itself belongs
   * to every eligible member — this console never casts votes for anyone." The right gate is ELIGIBILITY, decided from the
   * tenant's bylaws (TENANT-1e), and — since 9b — a choice DECLARED for the resolution's type.
   *
   * `ctx.userId` and never a body parameter: the console cannot vote on somebody else's behalf because there is nowhere to
   * say whose behalf.
   */
  @Post(':id/vote')
  vote(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(VoteSchema) dto: { choice: string }) {
    return this.svc.vote(ctx.tenantId, ctx.userId, idOf(id), dto.choice).then((data) => ({ data }));
  }

  /**
   * W197's share register, tiles and bylaw panel.
   *
   * **`report.view`, THE SAME GRANT AS THE MEMBER ROSTER, AND NOT `tenant.settings`.** W197's restricted state reads
   * "Register edits are board + checker; members see their own holding in their app" — so READING the register is a member-desk
   * capability while EDITING it is not, and the two must not share a permission.
   */
  // [PC-56 TENANT-9c · F-18] `governance.read` (0181) OR the `report.view` it always took. Either code, not both.
  @Get('register')
  register(@CurrentContext() ctx: RequestContext, @Query('cursor') cursor?: string) {
    const ok = ['governance.read', 'report.view', '*'].some((p) => ctx.permissions.has(p));
    if (!ok) throw new ForbiddenError('Missing permission(s): governance.read or report.view', { required: ['governance.read', 'report.view'] });
    return this.register_.view(ctx.tenantId, cursor).then((data) => ({ data }));
  }

  /** May I vote, and if not, what would I need? Read-only, about the CALLER only. */
  @Get('me/eligibility')
  eligibility(@CurrentContext() ctx: RequestContext) {
    return this.svc.eligibilityFor(ctx.tenantId, ctx.userId).then((data) => ({ data }));
  }

  // --- PC-55 A8 `coop-payout-runs`, PC-56 TENANT-9b: a PASSED dividend-class vote becomes queued payouts, in TWO acts. ---
  @Get(':id/payout-preview') @RequirePermissions('tenant.settings')
  payoutPreview(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.payouts.preview(ctx.tenantId, this.payer(ctx), idOf(id)).then((data) => ({ data }));
  }
  /** The MAKER prepares (keyed). Before 9b this one call ALSO "confirmed" with a uuid in its own body. */
  @Post(':id/payout-run') @RequirePermissions('tenant.settings')
  payoutPrepare(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.payouts.prepare(ctx.tenantId, this.payer(ctx), idOf(id), needKey(key), r.ip || null).then((data) => ({ data }));
  }
  /** The CHECKER confirms — the caller IS the checker, and may not be the maker. */
  @Post('payout-runs/:runId/confirm') @RequirePermissions('tenant.settings')
  payoutConfirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('runId') runId: string, @Headers('idempotency-key') key: string) {
    needKey(key);
    return this.payouts.confirm(ctx.tenantId, this.payer(ctx), idOf(runId), r.ip || null).then((data) => ({ data }));
  }
  @Post('payout-runs/:runId/cancel') @RequirePermissions('tenant.settings')
  payoutCancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('runId') runId: string, @Headers('idempotency-key') key: string, @ZodBody(CancelRunSchema) dto: { reason: string }) {
    needKey(key);
    return this.payouts.cancel(ctx.tenantId, this.payer(ctx), idOf(runId), dto.reason, r.ip || null).then((data) => ({ data }));
  }
  @Get('payout-runs/list') @RequirePermissions('tenant.settings')
  payoutRuns(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.payouts.runs(ctx.tenantId, this.payer(ctx), Number(limit) || 50).then((data) => ({ data }));
  }
  @Get('payout-runs/:runId') @RequirePermissions('tenant.settings')
  payoutRunDetail(@CurrentContext() ctx: RequestContext, @Param('runId') runId: string) {
    return this.payouts.getRun(ctx.tenantId, this.payer(ctx), idOf(runId)).then((data) => ({ data }));
  }

  /** The tally — for a CLOSED resolution, its snapshot only (9b, F-13). */
  @Get(':id/results')
  results(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.results(ctx.tenantId, idOf(id)).then((data) => ({ data })); }
}
