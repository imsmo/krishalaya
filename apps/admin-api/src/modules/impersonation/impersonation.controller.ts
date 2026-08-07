// apps/admin-api/src/modules/impersonation/impersonation.controller.ts · god-mode act-as surface (Law 11) — the
// highest-sensitivity control. Every route: AdminAuthGuard + OwnerPermissionsGuard. STARTING a grant additionally
// requires HardwareKeyGuard (FIDO2) + StepUpReauthGuard — minting an act-as token is the most consequential
// action in the platform. validate (zod) → authorize (owner perm) → delegate ONLY. Reads are audit views. No money
// path. The act-as TOKEN is returned ONCE from POST /grants and never re-exposed.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { StartImpersonationService } from './services/start-impersonation.service';
import { EndImpersonationService } from './services/end-impersonation.service';
import { ImpersonationHistoryService } from './services/impersonation-history.service';
import {
  QueryGrantsSchema, QueryGrantsDto, QueryActionsSchema, QueryActionsDto,
  StartGrantSchema, StartGrantDto, EndGrantSchema, EndGrantDto, RecordActionSchema, RecordActionDto,
} from './dto/impersonation.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'impersonation', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class ImpersonationController {
  constructor(
    private readonly start: StartImpersonationService,
    private readonly end: EndImpersonationService,
    private readonly history: ImpersonationHistoryService,
  ) {}

  // ---- reads (audit) ----
  @Get('grants') @RequireOwnerPermission(OwnerPermissions.ImpersonationRead)
  listGrants(@ZodQuery(QueryGrantsSchema) q: QueryGrantsDto) {
    return this.history.listGrants({ adminUserId: q.adminUserId, targetTenantId: q.targetTenantId, targetUserId: q.targetUserId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  /** PC-56 ADMIN-9b: the elapsed-but-unreconciled backlog. A count, on its own route, because it is a property of the
   *  TABLE rather than of any one grant. */
  @Get('stale-active') @RequireOwnerPermission(OwnerPermissions.ImpersonationRead)
  staleActive() {
    return this.history.staleActive().then((data) => ({ data }));
  }

  @Get('grants/:id') @RequireOwnerPermission(OwnerPermissions.ImpersonationRead)
  getGrant(@Param('id') id: string) { return this.history.getGrant(id).then((data) => ({ data })); }

  @Get('grants/:id/actions') @RequireOwnerPermission(OwnerPermissions.ImpersonationRead)
  listActions(@Param('id') id: string, @ZodQuery(QueryActionsSchema) q: QueryActionsDto) {
    return this.history.listActions({ grantId: id, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // ---- mutations ----
  // Start: the most consequential action → owner perm + FIDO2 hardware-key + step-up. Returns the act-as token ONCE.
  @Post('grants') @RequireOwnerPermission(OwnerPermissions.ImpersonationGrant) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  startGrant(@Req() req: any, @ZodBody(StartGrantSchema) dto: StartGrantDto) {
    return this.start.start(admin(req), dto).then((data) => ({ data }));
  }
  @Post('grants/:id/end') @RequireOwnerPermission(OwnerPermissions.ImpersonationGrant) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  endGrant(@Req() req: any, @Param('id') id: string, @ZodBody(EndGrantSchema) dto: EndGrantDto) {
    return this.end.end(admin(req), id, dto.reason).then((data) => ({ data }));
  }
  @Post('grants/:id/revoke') @RequireOwnerPermission(OwnerPermissions.ImpersonationGrant) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  revokeGrant(@Req() req: any, @Param('id') id: string, @ZodBody(EndGrantSchema) dto: EndGrantDto) {
    return this.end.revoke(admin(req), id, dto.reason).then((data) => ({ data }));
  }
  // Record one action taken under the operator's OWN active grant (the honouring API reports each request here).
  @Post('grants/:id/actions') @RequireOwnerPermission(OwnerPermissions.ImpersonationGrant)
  recordAction(@Req() req: any, @Param('id') id: string, @ZodBody(RecordActionSchema) dto: RecordActionDto) {
    return this.history.recordAction(admin(req), id, dto).then((data) => ({ data }));
  }
}
