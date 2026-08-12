// apps/admin-api/src/modules/safety-desk/safety-desk.controller.ts · W058 + W2151–W2153 (PC-56 ADMIN-SWEEP-b3).
//
// Everything needs `safety.desk` — W058's restricted state ("access limited to safety-team roles"), the narrowest
// support grant there is: who may even SEE that a named person raised a protected-category alert. The clause's
// second half ("even platform owner sees case metadata only, not thread content") is enforced by absence — no code
// in this realm reads `messages`, and the spec pins that. Writes are step-up gated.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { SafetyDeskService } from './services/safety-desk.service';
import { QueryDeskSchema, QueryDeskDto, JoinSchema, JoinDto, RecordStepSchema, RecordStepDto } from './dto/safety-desk.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const twoPart = (c?: string) => {
  if (!c) return undefined;
  const [a, b] = Buffer.from(c, 'base64').toString().split('|');
  return a && b ? { a, b } : undefined;
};

@Controller({ path: 'support/emergency', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class SafetyDeskController {
  constructor(private readonly svc: SafetyDeskService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.SafetyDesk)
  desk(@ZodQuery(QueryDeskSchema) q: QueryDeskDto, @Req() req: any) {
    const c = twoPart(q.cursor);
    return this.svc.desk({ cursor: c ? { c: c.a, id: c.b } : undefined, limit: q.limit }, admin(req).userId)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, protocols: r.protocols } }));
  }

  @Get('cases/:id') @RequireOwnerPermission(OwnerPermissions.SafetyDesk)
  getCase(@Param('id') id: string, @Req() req: any) {
    return this.svc.getCase(id, admin(req).userId).then((data) => ({ data }));
  }

  @Post('cases/:id/join') @RequireOwnerPermission(OwnerPermissions.SafetyDesk) @UseGuards(StepUpReauthGuard)
  join(@Param('id') id: string, @ZodBody(JoinSchema) _dto: JoinDto, @Req() req: any) {
    return this.svc.join(admin(req), id).then((data) => ({ data }));
  }

  @Post('cases/:id/steps') @RequireOwnerPermission(OwnerPermissions.SafetyDesk) @UseGuards(StepUpReauthGuard)
  recordStep(@Param('id') id: string, @ZodBody(RecordStepSchema) dto: RecordStepDto, @Req() req: any) {
    return this.svc.recordStep(admin(req), id, dto).then((data) => ({ data }));
  }
}
