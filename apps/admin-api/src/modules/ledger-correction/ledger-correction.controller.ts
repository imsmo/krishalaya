// apps/admin-api/src/modules/ledger-correction/ledger-correction.controller.ts · W068 (PC-56 ADMIN-5e).
//
// TWO PERMISSIONS THAT MUST NOT BE HELD BY ONE PERSON IN PRACTICE, and the canon names both: "Drafting needs
// `ledger.investigate`; posting needs a DIFFERENT user with `ledger.correct`." The routes are split accordingly, and
// even a super_admin holding '*' is refused by `ck_correction_maker_ne_checker` and the shared two-person rule —
// the permission split is the org chart, the constraint is the control.
//
// EVERY WRITE IS HARDWARE-KEY AND STEP-UP GATED, matching recon-monitor's investigation writes. This path moves a
// farmer's money by hand; it gets the strongest ceremony in the console.
import { Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { CorrectionService } from './services/correction.service';
import {
  OpenDraftSchema, OpenDraftDto, SaveLegsSchema, SaveLegsDto, DecideSchema, DecideDto,
  WithdrawSchema, WithdrawDto, QueryDraftsSchema, QueryDraftsDto,
} from './dto/ledger-correction.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeCursor = (c?: string) => {
  if (!c) return undefined;
  const [cc, id] = Buffer.from(c, 'base64').toString().split('|');
  return cc && id ? { c: cc, id } : undefined;
};

@Controller({ path: 'ledger/corrections', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class LedgerCorrectionController {
  constructor(private readonly svc: CorrectionService) {}

  /** Readable by EITHER side. A checker must see the queue to work it, and a maker must see their own drafts. */
  @Get() @RequireOwnerPermission(OwnerPermissions.ReconRead)
  list(@ZodQuery(QueryDraftsSchema) q: QueryDraftsDto, @Req() req: any) {
    const { cursor, ...rest } = q;
    return this.svc.list({ ...rest, cursor: decodeCursor(cursor) }, admin(req)?.userId ?? null)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  @Get(':id') @RequireOwnerPermission(OwnerPermissions.ReconRead)
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, admin(req)?.userId ?? null).then((data) => ({ data }));
  }

  @Post() @RequireOwnerPermission(OwnerPermissions.LedgerInvestigate) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  open(@ZodBody(OpenDraftSchema) dto: OpenDraftDto, @Req() req: any) {
    return this.svc.open(admin(req), dto).then((data) => ({ data }));
  }

  @Patch(':id/legs') @RequireOwnerPermission(OwnerPermissions.LedgerInvestigate) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  saveLegs(@Param('id') id: string, @ZodBody(SaveLegsSchema) dto: SaveLegsDto, @Req() req: any) {
    return this.svc.saveLegs(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post(':id/submit') @RequireOwnerPermission(OwnerPermissions.LedgerInvestigate) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  submit(@Param('id') id: string, @Req() req: any) {
    return this.svc.submit(admin(req), id).then((data) => ({ data }));
  }

  /** THE POST. A different permission, a different person, and the money moves. */
  @Post(':id/approve') @RequireOwnerPermission(OwnerPermissions.LedgerCorrect) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  approve(@Param('id') id: string, @ZodBody(DecideSchema) dto: DecideDto, @Req() req: any) {
    return this.svc.approve(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post(':id/reject') @RequireOwnerPermission(OwnerPermissions.LedgerCorrect) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  reject(@Param('id') id: string, @ZodBody(DecideSchema) dto: DecideDto, @Req() req: any) {
    return this.svc.reject(admin(req), id, dto).then((data) => ({ data }));
  }

  /** Withdrawing needs no step-up: it cancels an unposted intention rather than causing one, and the safe direction
   *  for a control that undoes something is to keep it cheap to reach. A POSTED correction cannot be withdrawn — the
   *  service refuses it, because there is no delete. */
  @Post(':id/withdraw') @RequireOwnerPermission(OwnerPermissions.LedgerInvestigate)
  withdraw(@Param('id') id: string, @ZodBody(WithdrawSchema) dto: WithdrawDto, @Req() req: any) {
    return this.svc.withdraw(admin(req), id, dto.note).then((data) => ({ data }));
  }
}
