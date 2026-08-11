// apps/admin-api/src/modules/templates-ops/templates-ops.controller.ts · W101/W102 (PC-56 ADMIN-11b).
//
// Reads need `templates.read`; authoring needs `templates.manage`; APPROVING needs `templates.approve`, which is a third
// grant and not a courtesy — approval is the only act on this plane that changes what a recipient receives.
//
// **ELEVATION IS ASYMMETRIC AND THE ASYMMETRY IS THE POINT.** Authoring a draft touches nothing a farmer can see, so it
// takes the ordinary front door. Approving moves the serving pointer for every recipient of that event, in every tenant
// that has not overridden it — the same reach as a platform setting, so the same hardware key and step-up.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { TemplatesOpsService } from './services/templates-ops.service';
import {
  QueryTemplatesSchema, QueryTemplatesDto, QueryCoverageSchema, QueryCoverageDto,
  AuthorVersionSchema, AuthorVersionDto, VersionActionSchema, VersionActionDto,
  ApproveVersionSchema, ApproveVersionDto, RegisterSenderSchema, RegisterSenderDto,
} from './dto/templates-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const ELEVATED = [HardwareKeyGuard, StepUpReauthGuard] as const;

@Controller({ path: 'templates', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class TemplatesOpsController {
  constructor(private readonly templates: TemplatesOpsService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.TemplatesRead)
  list(@ZodQuery(QueryTemplatesSchema) q: QueryTemplatesDto) { return this.templates.list(q); }

  /** W101's "gaps only" view: a default channel with no platform template is a message that will be attempted and
   *  cannot be composed — at send time that is `markFailed('no_template')`, recorded and silent. */
  @Get('coverage') @RequireOwnerPermission(OwnerPermissions.TemplatesRead)
  coverage(@ZodQuery(QueryCoverageSchema) q: QueryCoverageDto) { return this.templates.coverage(q); }

  @Get('senders') @RequireOwnerPermission(OwnerPermissions.TemplatesRead)
  senders() { return this.templates.listSenders(); }

  @Get(':id') @RequireOwnerPermission(OwnerPermissions.TemplatesRead)
  get(@Param('id') id: string) { return this.templates.get(id).then((data) => ({ data })); }

  /** Author a version. Not elevated: a draft changes nothing anybody receives. */
  @Post('versions')
  @RequireOwnerPermission(OwnerPermissions.TemplatesManage)
  author(@Req() req: any, @ZodBody(AuthorVersionSchema) body: AuthorVersionDto) {
    return this.templates.authorVersion(admin(req), body).then((data) => ({ data }));
  }

  @Post('versions/:id/submit')
  @RequireOwnerPermission(OwnerPermissions.TemplatesManage)
  submit(@Req() req: any, @Param('id') id: string, @ZodBody(VersionActionSchema) body: VersionActionDto) {
    return this.templates.submit(admin(req), id, body).then((data) => ({ data }));
  }

  /** **THE ONLY ROUTE THAT CHANGES WHAT A RECIPIENT RECEIVES.** Third grant, hardware key, step-up, and — on security
   *  copy — a different administrator from the one who wrote the words. */
  @Post('versions/:id/approve')
  @RequireOwnerPermission(OwnerPermissions.TemplatesApprove)
  @UseGuards(...ELEVATED)
  approve(@Req() req: any, @Param('id') id: string, @ZodBody(ApproveVersionSchema) body: ApproveVersionDto) {
    return this.templates.approve(admin(req), id, body).then((data) => ({ data }));
  }

  /** Rejecting takes `templates.approve` too: refusing wording is a verdict on it. It is NOT elevated — the restrictive
   *  direction is the safe one and must never be the harder one, which is the asymmetry ADMIN-9 established and
   *  ADMIN-11 applied to kill switches. */
  @Post('versions/:id/reject')
  @RequireOwnerPermission(OwnerPermissions.TemplatesApprove)
  reject(@Req() req: any, @Param('id') id: string, @ZodBody(VersionActionSchema) body: VersionActionDto) {
    return this.templates.reject(admin(req), id, body).then((data) => ({ data }));
  }

  @Post('senders')
  @RequireOwnerPermission(OwnerPermissions.TemplatesManage)
  @UseGuards(...ELEVATED)
  registerSender(@Req() req: any, @ZodBody(RegisterSenderSchema) body: RegisterSenderDto) {
    return this.templates.registerSender(admin(req), body).then((data) => ({ data }));
  }
}
