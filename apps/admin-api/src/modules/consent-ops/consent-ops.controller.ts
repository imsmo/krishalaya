// apps/admin-api/src/modules/consent-ops/consent-ops.controller.ts · the CONSENT plane (W046 / W047).
//
// TWO NEW PERMISSIONS, BOTH NAMED BY THE CANON: `compliance.consent.read` (W046's restricted state) and
// `compliance.consent.write` (W047's). They are separate from `compliance.dsr` and from `compliance.manage` because they
// govern a different thing again: the registry is a cross-tenant list of PEOPLE AND THEIR CHOICES, and the purpose
// registry is the legal text every one of those choices was given against. Somebody who works rights requests has no
// reason to rewrite a consent notice, and somebody who authors notices has no reason to read a named farmer's history.
//
// Reads are not elevated. WRITES ARE — a consent notice is the legal basis for processing, and publishing one is
// checker-gated on top (a DIFFERENT operator, enforced by the shared two-person rule and by
// `ck_cpv_maker_ne_checker`).
import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { ConsentPurposeService } from './services/consent-purpose.service';
import { ConsentRegistryService } from './services/consent-registry.service';
import {
  QueryConsentsSchema, QueryConsentsDto, OpenDraftSchema, OpenDraftDto, SaveNoticeSchema, SaveNoticeDto,
  PublishConsentVersionSchema, PublishConsentVersionDto, DiscardConsentDraftSchema, DiscardConsentDraftDto,
} from './dto/consent-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'consent', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class ConsentOpsController {
  constructor(
    private readonly purposes: ConsentPurposeService,
    private readonly registry: ConsentRegistryService,
  ) {}

  /* ======================= W046 · the registry ======================= */

  /** Declared before `purposes/:code` so 'tiles' is never read as a purpose code. */
  @Get('registry/tiles') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentRead)
  tiles() { return this.registry.tiles().then((data) => ({ data })); }

  @Get('registry') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentRead)
  listConsents(@ZodQuery(QueryConsentsSchema) q: QueryConsentsDto) {
    return this.registry.list({ ...q, cursor: decodeCursor(q.cursor) })
      .then((r) => ({ data: r.items, meta: { ivrEvidence: r.ivrEvidence, nextCursor: r.nextCursor } }));
  }

  /* ======================= W047 · purposes and their notices ======================= */

  @Get('purposes') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentRead)
  listPurposes() { return this.purposes.listPurposes().then((r) => ({ data: r.items, meta: { languages: r.languages } })); }

  @Get('purposes/:code') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentRead)
  getPurpose(@Param('code') code: string) { return this.purposes.getPurpose(code).then((data) => ({ data })); }

  /** MAKER — open a draft of the next version. */
  @Post('purposes/:code/versions') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentWrite) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  openDraft(@Req() req: any, @Param('code') code: string, @ZodBody(OpenDraftSchema) dto: OpenDraftDto) {
    return this.purposes.openDraft(admin(req), code, dto).then((data) => ({ data }));
  }

  /** One language per call. Twelve languages is twelve deliberate acts; a bulk endpoint is how eleven of them end up
   *  machine-translated in one gesture, and a machine-translated consent notice is not a notice. */
  @Post('versions/:versionId/notices') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentWrite) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  saveNotice(@Req() req: any, @Param('versionId') versionId: string, @ZodBody(SaveNoticeSchema) dto: SaveNoticeDto) {
    return this.purposes.saveNotice(admin(req), versionId, dto).then((data) => ({ data }));
  }

  @Delete('versions/:versionId/notices/:languageCode') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentWrite) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  deleteNotice(@Req() req: any, @Param('versionId') versionId: string, @Param('languageCode') languageCode: string) {
    return this.purposes.deleteNotice(admin(req), versionId, languageCode).then((data) => ({ data }));
  }

  /** CHECKER — a DIFFERENT operator makes the notice live. */
  @Post('versions/:versionId/publish') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentWrite) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  publish(@Req() req: any, @Param('versionId') versionId: string, @ZodBody(PublishConsentVersionSchema) dto: PublishConsentVersionDto) {
    return this.purposes.publish(admin(req), versionId, dto.checkerNote ?? null).then((data) => ({ data }));
  }

  @Post('versions/:versionId/discard') @RequireOwnerPermission(OwnerPermissions.ComplianceConsentWrite) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  discard(@Req() req: any, @Param('versionId') versionId: string, @ZodBody(DiscardConsentDraftSchema) dto: DiscardConsentDraftDto) {
    return this.purposes.discardDraft(admin(req), versionId, dto.reason).then((data) => ({ data }));
  }
}
