// apps/admin-api/src/modules/comm-hub/comm-hub.controller.ts · W050 + W2099–W2101 (PC-56 ADMIN-SWEEP-b2).
//
// Everything here needs `support.hub` — W050's own restricted state ("L1+ agents; thread PII masks apply per
// role"), and deliberately not `support.oversight.read`: watching the board and owning a farmer's conversation are
// different acts (see owner-roles.ts). Writes are step-up gated like every other admin write.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { CommHubService } from './services/comm-hub.service';
import { QueryHubSchema, QueryHubDto, TakeNextSchema, TakeNextDto, PresenceSchema, PresenceDto } from './dto/comm-hub.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const twoPart = (c?: string) => {
  if (!c) return undefined;
  const [a, b] = Buffer.from(c, 'base64').toString().split('|');
  return b ? { a: a || null, b } : undefined;
};

@Controller({ path: 'support/hub', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class CommHubController {
  constructor(private readonly svc: CommHubService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.SupportHub)
  inbox(@ZodQuery(QueryHubSchema) q: QueryHubDto, @Req() req: any) {
    const c = twoPart(q.cursor);
    return this.svc.inbox({ cursor: c ? { k: c.a as string, id: c.b } : undefined, limit: q.limit }, admin(req).userId)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, myLoad: r.myLoad, unclaimed: r.unclaimed, orphans: r.orphans, presence: r.presence, presenceSince: r.presenceSince, carriedChannels: r.carriedChannels } }));
  }

  @Get('principal/:userId') @RequireOwnerPermission(OwnerPermissions.SupportHub)
  principal(@Param('userId') userId: string, @Req() req: any) {
    return this.svc.principal(userId, admin(req).userId).then((data) => ({ data }));
  }

  @Post('next') @RequireOwnerPermission(OwnerPermissions.SupportHub) @UseGuards(StepUpReauthGuard)
  next(@ZodBody(TakeNextSchema) _dto: TakeNextDto, @Req() req: any) {
    return this.svc.takeNext(admin(req)).then((data) => ({ data }));
  }

  @Post('presence') @RequireOwnerPermission(OwnerPermissions.SupportHub) @UseGuards(StepUpReauthGuard)
  presence(@ZodBody(PresenceSchema) dto: PresenceDto, @Req() req: any) {
    return this.svc.setPresence(admin(req), dto.status).then((data) => ({ data }));
  }
}
