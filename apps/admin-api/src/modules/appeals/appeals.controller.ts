// apps/admin-api/src/modules/appeals/appeals.controller.ts · W097 + W1953–W1955 (PC-56 ADMIN-SWEEP-b1).
//
// `moderation.read` reads the queue (the same boards-and-counts grant the rest of trust & safety reads with);
// `moderation.appeals` — the eighth ungrantable permission, granted for the first time this wave — claims and
// decides. Writes are step-up gated: an overturn republishes a listing, rewrites a risk score and puts a sentence
// in front of a farmer, and an uphold closes their one avenue of contest.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { AppealsQueueService } from './services/appeals-queue.service';
import { AppealDecisionService } from './services/appeal-decision.service';
import {
  QueryAppealsSchema, QueryAppealsDto, DecideAppealSchema, DecideAppealDto, TakeNextSchema, TakeNextDto,
} from './dto/appeals.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const twoPart = (c?: string) => {
  if (!c) return undefined;
  const [a, b] = Buffer.from(c, 'base64').toString().split('|');
  return a && b ? { a, b } : undefined;
};

@Controller({ path: 'moderation/appeals', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class AppealsController {
  constructor(
    private readonly queue: AppealsQueueService,
    private readonly decisions: AppealDecisionService,
  ) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  list(@ZodQuery(QueryAppealsSchema) q: QueryAppealsDto, @Req() req: any) {
    const c = twoPart(q.cursor);
    return this.queue.list({ status: q.status, cursor: c ? { k: c.a, id: c.b } : undefined, limit: q.limit }, admin(req)?.userId ?? null)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, counts: r.counts } }));
  }

  /** "Take next" — which appeal you get is the queue's decision, not a parameter (see dto). */
  @Post('take-next') @RequireOwnerPermission(OwnerPermissions.ModerationAppeals) @UseGuards(StepUpReauthGuard)
  takeNext(@ZodBody(TakeNextSchema) _dto: TakeNextDto, @Req() req: any) {
    return this.queue.takeNext(admin(req)).then((data) => ({ data }));
  }

  @Get(':id') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  get(@Param('id') id: string, @Req() req: any) {
    return this.queue.get(id, admin(req)?.userId ?? null).then((data) => ({ data }));
  }

  @Post(':id/decide') @RequireOwnerPermission(OwnerPermissions.ModerationAppeals) @UseGuards(StepUpReauthGuard)
  decide(@Param('id') id: string, @ZodBody(DecideAppealSchema) dto: DecideAppealDto, @Req() req: any) {
    return this.decisions.decide(admin(req), id, dto).then((data) => ({ data }));
  }
}
