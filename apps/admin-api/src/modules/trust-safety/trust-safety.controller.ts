// apps/admin-api/src/modules/trust-safety/trust-safety.controller.ts · the TRUST & SAFETY plane (PC-56 ADMIN-5d).
//
// FOUR NEW PERMISSIONS, all named by the canon's own restricted states and all previously non-existent — before this
// wave `moderation.*` and `risk.*` appeared nowhere in the codebase except inside migration 0067's rationale comment,
// describing an access model for three tables no code could reach. The reasoning for the split is in owner-roles.ts.
//
// WRITES ARE STEP-UP GATED. Adding a platform block or moving somebody to `blocked` takes away a person's ability to
// trade; a weight change does it to a few hundred people at once. That is the same class of act as publishing a
// consent notice or signing off a breach, and it gets the same treatment.
//
// READS SPLIT ON WHETHER A NAMED PERSON IS IN THE RESPONSE. The boards, the rules and the insights are
// `moderation.read`; anything that returns an account — even masked — is `risk.read`.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { BlocklistService } from './services/blocklist.service';
import { RiskRulesService } from './services/risk-rules.service';
import { RiskBoardService } from './services/risk-board.service';
import { TrustOverviewService } from './services/trust-overview.service';
import {
  QueryBlocksSchema, QueryBlocksDto, AddBlockSchema, AddBlockDto, LiftBlockSchema, LiftBlockDto,
  CountersignBlockSchema, CountersignBlockDto, ProposeWeightSchema, ProposeWeightDto,
  ApproveWeightSchema, ApproveWeightDto, WithdrawProposalSchema, WithdrawProposalDto,
  QueryRiskBoardSchema, QueryRiskBoardDto, ChangeBandSchema, ChangeBandDto,
  QueryInsightsSchema, QueryInsightsDto,
} from './dto/trust-safety.dto';

const admin = (req: any): AdminRequestContext => req.admin;

const decodeBlockCursor = (c?: string) => {
  if (!c) return undefined;
  const [cc, id] = Buffer.from(c, 'base64').toString().split('|');
  return cc && id ? { c: cc, id } : undefined;
};
/** The risk board's cursor is (score, user_id) and the score half must be a NUMBER. A cursor whose score does not
 *  parse is DROPPED rather than coerced: `Number('')` is 0, and a silently-zero cursor restarts the page at the
 *  bottom of the ladder — which on this board is the blocked accounts. */
const decodeRiskCursor = (c?: string) => {
  if (!c) return undefined;
  const [s, id] = Buffer.from(c, 'base64').toString().split('|');
  const n = Number(s);
  return id && s !== '' && s !== undefined && Number.isFinite(n) ? { s: n, id } : undefined;
};

@Controller({ path: 'trust', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class TrustSafetyController {
  constructor(
    private readonly blocklist: BlocklistService,
    private readonly rules: RiskRulesService,
    private readonly board: RiskBoardService,
    private readonly overview: TrustOverviewService,
  ) {}

  /* ======================= W089 · overview ======================= */

  @Get('overview') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  getOverview() { return this.overview.overview().then((data) => ({ data })); }

  /* ======================= W098 · insights ======================= */

  @Get('insights') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  getInsights(@ZodQuery(QueryInsightsSchema) q: QueryInsightsDto) {
    return this.overview.insights(q.days).then((data) => ({ data }));
  }

  /* ======================= W096 · blocklists ======================= */

  @Get('blocklists') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  listBlocks(@ZodQuery(QueryBlocksSchema) q: QueryBlocksDto) {
    const { cursor, ...rest } = q;
    return this.blocklist.list({ ...rest, cursor: decodeBlockCursor(cursor) })
      .then((r) => ({ data: r.items, meta: { counts: r.counts, userBlockCount: r.userBlockCount, nextCursor: r.nextCursor } }));
  }

  @Get('blocklists/:id') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  getBlock(@Param('id') id: string) { return this.blocklist.get(id).then((data) => ({ data })); }

  @Post('blocklists') @RequireOwnerPermission(OwnerPermissions.RiskAct) @UseGuards(StepUpReauthGuard)
  addBlock(@ZodBody(AddBlockSchema) dto: AddBlockDto, @Req() req: any) {
    return this.blocklist.add(admin(req), dto).then((data) => ({ data }));
  }

  @Post('blocklists/:id/countersign') @RequireOwnerPermission(OwnerPermissions.RiskAct) @UseGuards(StepUpReauthGuard)
  countersignBlock(@Param('id') id: string, @ZodBody(CountersignBlockSchema) dto: CountersignBlockDto, @Req() req: any) {
    return this.blocklist.countersign(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post('blocklists/:id/lift') @RequireOwnerPermission(OwnerPermissions.RiskAct) @UseGuards(StepUpReauthGuard)
  liftBlock(@Param('id') id: string, @ZodBody(LiftBlockSchema) dto: LiftBlockDto, @Req() req: any) {
    return this.blocklist.lift(admin(req), id, dto).then((data) => ({ data }));
  }

  /* ======================= W095 · risk rules ======================= */

  @Get('risk/rules') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  rulesBoard(@Req() req: any) { return this.rules.board(admin(req)?.userId ?? null).then((data) => ({ data })); }

  @Post('risk/rules/:code/propose') @RequireOwnerPermission(OwnerPermissions.RiskRules) @UseGuards(StepUpReauthGuard)
  propose(@Param('code') code: string, @ZodBody(ProposeWeightSchema) dto: ProposeWeightDto, @Req() req: any) {
    return this.rules.propose(admin(req), code, dto).then((data) => ({ data }));
  }

  @Post('risk/rules/:code/approve') @RequireOwnerPermission(OwnerPermissions.RiskRules) @UseGuards(StepUpReauthGuard)
  approve(@Param('code') code: string, @ZodBody(ApproveWeightSchema) dto: ApproveWeightDto, @Req() req: any) {
    return this.rules.approve(admin(req), code, dto).then((data) => ({ data }));
  }

  /** Withdrawing is NOT step-up gated: it removes a pending change rather than applying one, and the safe direction
   *  for a control that undoes something is to keep it cheap to reach. */
  @Post('risk/rules/:code/withdraw') @RequireOwnerPermission(OwnerPermissions.RiskRules)
  withdraw(@Param('code') code: string, @ZodBody(WithdrawProposalSchema) dto: WithdrawProposalDto, @Req() req: any) {
    return this.rules.withdraw(admin(req), code, dto).then((data) => ({ data }));
  }

  /* ======================= W093 · risk board ======================= */

  /** Declared before `risk/accounts/:userId` so 'board' is never read as a user id. */
  @Get('risk/board') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  riskBoard() { return this.board.board().then((data) => ({ data })); }

  @Get('risk/accounts') @RequireOwnerPermission(OwnerPermissions.RiskRead)
  riskAccounts(@ZodQuery(QueryRiskBoardSchema) q: QueryRiskBoardDto) {
    const { cursor, ...rest } = q;
    return this.board.list({ ...rest, cursor: decodeRiskCursor(cursor) })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  /* ======================= W094 · risk profile ======================= */

  @Get('risk/accounts/:userId') @RequireOwnerPermission(OwnerPermissions.RiskRead)
  riskProfile(@Param('userId') userId: string, @Req() req: any) {
    return this.board.profile(admin(req), userId).then((data) => ({ data }));
  }

  @Post('risk/accounts/:userId/band') @RequireOwnerPermission(OwnerPermissions.RiskAct) @UseGuards(StepUpReauthGuard)
  changeBand(@Param('userId') userId: string, @ZodBody(ChangeBandSchema) dto: ChangeBandDto, @Req() req: any) {
    return this.board.changeBand(admin(req), userId, dto).then((data) => ({ data }));
  }
}
