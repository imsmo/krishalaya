// apps/admin-api/src/modules/ai-models-ops/ai-models-ops.controller.ts · god-mode model registry surface.
// Every route: AdminAuthGuard (verified admin JWT) + OwnerPermissionsGuard. MUTATIONS additionally require
// HardwareKeyGuard (FIDO2) + StepUpReauthGuard (recent re-auth) — JIT elevation for consequential changes.
// validate (zod) → authorize (owner perm) → delegate. No business logic here.
import { Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { ModelRegistryService } from './services/model-registry.service';
import { ThresholdTuningService } from './services/threshold-tuning.service';
import { FairnessAuditReportsService } from './services/fairness-audit-reports.service';
import { FairnessGateService } from './services/fairness-gate.service';
import { AiReviewService } from './services/ai-review.service';
import { RegisterModelSchema, RegisterModelDto, PromoteModelSchema, PromoteModelDto, TuneThresholdSchema, TuneThresholdDto, QueryModelsSchema, QueryModelsDto } from './dto/ai-models-ops.dto';
import {
  ProposeTransitionSchema, ProposeTransitionDto, ThresholdImpactSchema, ThresholdImpactDto,
} from './dto/ai-models-ops.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'ai/models', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class AiModelsOpsController {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly tuning: ThresholdTuningService,
    private readonly fairness: FairnessAuditReportsService,
    private readonly gate: FairnessGateService,
    private readonly review: AiReviewService,
  ) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  list(@ZodQuery(QueryModelsSchema) q: QueryModelsDto) {
    return this.registry.list({ code: q.code, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  get(@Param('id') id: string) { return this.registry.getById(id).then((data) => ({ data })); }

  @Get(':id/fairness') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  fairnessReport(@Req() req: any, @Param('id') id: string) { return this.fairness.report(admin(req), id).then((data) => ({ data })); }

  // ---- mutations: hardware-key + step-up elevation required ----
  @Post() @RequireOwnerPermission(OwnerPermissions.AiModelManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  register(@Req() req: any, @ZodBody(RegisterModelSchema) dto: RegisterModelDto) {
    return this.registry.register(admin(req), dto).then((data) => ({ data }));
  }
  @Post(':id/promote') @RequireOwnerPermission(OwnerPermissions.AiModelManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  promote(@Req() req: any, @Param('id') id: string, @ZodBody(PromoteModelSchema) dto: PromoteModelDto) {
    return this.registry.promote(admin(req), id, dto).then((data) => ({ data }));
  }
  @Patch(':id/threshold') @RequireOwnerPermission(OwnerPermissions.AiModelManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  tune(@Req() req: any, @Param('id') id: string, @ZodBody(TuneThresholdSchema) dto: TuneThresholdDto) {
    return this.tuning.tune(admin(req), id, dto).then((data) => ({ data }));
  }

  /* ==================== PC-56 ADMIN-7 · THE GOVERNANCE PLANE ==================== */
  //
  // THE FAIRNESS GATE. `promote()` above is left in place and untouched: it is the only code that has ever written this
  // registry, and replacing it wholesale in the wave that adds a gate would mix two risks. The GATED path is
  // propose → approve below, and 0115's `ck_ai_model_production_needs_audit` is what makes the ungated one unable to
  // reach production regardless of which route is called — the constraint is the guarantee, these routes are the process.

  /** W079. The overview: inferences, review load, override rate, queue depth. */
  @Get('overview') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  overview() {
    return this.review.overview().then((data) => ({ data }));
  }

  /** W085. The fairness board — and the UNAUDITED models are the headline, because that is currently every model. */
  @Get('fairness/board') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  fairnessBoard() {
    return this.gate.board().then((data) => ({ data }));
  }

  /** W085's "was 6.8pp" comparison needs more than one audit, which is why the audit is a table. */
  @Get(':id/fairness/history') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  fairnessHistory(@Param('id') id: string) {
    return this.gate.history(id).then((data) => ({ data }));
  }

  /** W085's "Schedule audit". Hardware key + step-up: an audit record authorises a production promotion, so filing one
   *  is a consequential act even though it changes no model. */
  @Post(':id/fairness/audit')
  @RequireOwnerPermission(OwnerPermissions.AiModelManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  runAudit(@Req() req: any, @Param('id') id: string) {
    return this.gate.runAudit(admin(req), id).then((data) => ({ data }));
  }

  /** The DPO's sign-off on the slice definitions — a SEPARATE act from the audit, on a SEPARATE permission. W085:
   *  "slice definitions are reviewed by the DPO (protected attributes)". Measuring accuracy by gender means processing
   *  gender, so which slices are measured is a privacy decision and `compliance.manage` is who makes it. */
  @Post('fairness/audits/:auditId/approve-slices')
  @RequireOwnerPermission(OwnerPermissions.ComplianceManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  approveSlices(@Req() req: any, @Param('auditId') auditId: string) {
    return this.gate.approveSlices(admin(req), auditId).then((data) => ({ data }));
  }

  /** W088. The rollout: where the model is, which gates pass, and WHICH METRICS NOTHING MEASURES. */
  @Get(':id/rollout') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  rollout(@Req() req: any, @Param('id') id: string) {
    return this.gate.rollout(admin(req), id).then((data) => ({ data }));
  }

  /** Propose a transition (the maker half of the ELEVENTH maker-checker site). */
  @Post(':id/transitions')
  @RequireOwnerPermission(OwnerPermissions.AiModelManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  propose(@Req() req: any, @Param('id') id: string, @ZodBody(ProposeTransitionSchema) body: ProposeTransitionDto) {
    return this.gate.propose(admin(req), id, body.to, body.reason, body.canaryPercent).then((data) => ({ data }));
  }

  /** Approve a transition (the checker half) — where the gate fires. NO BODY: the proposal is on the row, the approver is
   *  in the token, and the audit is re-read inside the transaction. */
  @Post(':id/transitions/approve')
  @RequireOwnerPermission(OwnerPermissions.AiModelManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  approveTransition(@Req() req: any, @Param('id') id: string) {
    return this.gate.approve(admin(req), id).then((data) => ({ data }));
  }

  @Post(':id/transitions/withdraw')
  @RequireOwnerPermission(OwnerPermissions.AiModelManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  withdraw(@Req() req: any, @Param('id') id: string) {
    return this.gate.withdraw(admin(req), id).then((data) => ({ data }));
  }

  /** W087's threshold half. A read that computes: raising a threshold changes WHO GETS HUMAN REVIEW, and an operator who
   *  cannot see that number is choosing blind. The prompt half is DELTA-020 and is reported as absent. */
  @Get(':id/threshold-impact') @RequireOwnerPermission(OwnerPermissions.AiModelRead)
  thresholdImpact(@Param('id') id: string, @ZodQuery(ThresholdImpactSchema) q: ThresholdImpactDto) {
    return this.review.thresholdImpact(id, q.proposed, q.headroomPerDay).then((data) => ({ data }));
  }
}
