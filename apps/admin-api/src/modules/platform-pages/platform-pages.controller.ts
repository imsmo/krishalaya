// apps/admin-api/src/modules/platform-pages/platform-pages.controller.ts · PC-56 LEGAL-1 (migration 0242) — the four platform POLICY pages.
//
// Reads need `platform.pages.read`; authoring (new draft, save draft, archive a draft) `platform.pages.manage`; PUBLISHING
// `platform.pages.publish` — a third grant, a second person (maker ≠ checker, also 0242's trigger) and ELEVATED (hardware key + step-up, the
// templates-approve precedent): it changes the words every buyer and seller on the platform is bound by. Taking a LIVE version down needs
// `platform.pages.publish` too (checked in the service — the route admits the author so a draft can be abandoned). Every write requires an
// `Idempotency-Key` header (400 IDEMPOTENCY_KEY_REQUIRED without one) and a reason of at least 20 characters.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody } from '../../core/http/zod.pipe';
import { PlatformPagesService } from './services/platform-pages.service';
import {
  ArchiveDto, ArchiveSchema, CreateDraftDto, CreateDraftSchema, EditDraftDto, EditDraftSchema, PublishDto, PublishSchema,
} from './dto/platform-pages.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const ELEVATED = [HardwareKeyGuard, StepUpReauthGuard] as const;

@Controller({ path: 'platform-pages', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PlatformPagesController {
  constructor(private readonly pages: PlatformPagesService) {}

  @Get() @RequireOwnerPermission(OwnerPermissions.PlatformPagesRead)
  list() { return this.pages.list().then((data) => ({ data })); }

  @Get(':slug') @RequireOwnerPermission(OwnerPermissions.PlatformPagesRead)
  detail(@Req() req: any, @Param('slug') slug: string) { return this.pages.detail(slug, admin(req)).then((data) => ({ data })); }

  @Post(':slug/drafts') @RequireOwnerPermission(OwnerPermissions.PlatformPagesManage)
  createDraft(@Req() req: any, @Param('slug') slug: string, @Headers('idempotency-key') key: string | undefined,
    @ZodBody(CreateDraftSchema) body: CreateDraftDto) {
    return this.pages.createDraft(admin(req), slug, body, key).then((data) => ({ data }));
  }

  @Patch('versions/:id') @RequireOwnerPermission(OwnerPermissions.PlatformPagesManage)
  editDraft(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined,
    @ZodBody(EditDraftSchema) body: EditDraftDto) {
    return this.pages.editDraft(admin(req), id, body, key).then((data) => ({ data }));
  }

  /** **THE ONLY ROUTE THAT CHANGES WHAT THE STOREFRONT'S LEGAL PAGES SAY.** Third grant, hardware key, step-up, a second person. */
  @Post('versions/:id/publish') @RequireOwnerPermission(OwnerPermissions.PlatformPagesPublish)
  @UseGuards(...ELEVATED)
  publish(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined,
    @ZodBody(PublishSchema) body: PublishDto) {
    return this.pages.publish(admin(req), id, body, key).then((data) => ({ data }));
  }

  @Post('versions/:id/archive') @RequireOwnerPermission(OwnerPermissions.PlatformPagesManage)
  archive(@Req() req: any, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined,
    @ZodBody(ArchiveSchema) body: ArchiveDto) {
    return this.pages.archive(admin(req), id, body, key).then((data) => ({ data }));
  }
}
