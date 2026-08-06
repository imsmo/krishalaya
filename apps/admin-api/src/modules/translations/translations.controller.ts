// apps/admin-api/src/modules/translations/translations.controller.ts · the TRANSLATIONS plane
// (PC-56 ADMIN-3b, canon W028 — closes ADMIN-3-Q1 and ADMIN-3-Q2).
//
// TWO PERMISSIONS, AND THE SPLIT IS THE POINT. `translations.review` is NOT `catalogue.manage`: somebody who curates the
// category tree is not thereby entitled to say that a Tamil sentence means what the English means. And holding
// `translations.review` is still not sufficient — `translation_reviewers` decides WHICH LANGUAGES, checked in the service
// against the row's own language rather than against anything the caller sent.
//
// NO HARDWARE KEY ON A REVIEW. Deliberate, and the opposite of the coaching records in ADMIN-2c. A reviewer works through
// a queue of forty drafts in a sitting; a step-up prompt per row would be answered by muscle memory within ten minutes,
// which makes the ceremony worse than absent. The language scope is the real control here, and it cannot be clicked
// through. GRANTING a scope IS elevated — that is the act that decides who may speak for a language.
import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { TranslationsService } from './services/translations.service';
import { TaxonomyExportService } from './services/taxonomy-export.service';
import {
  QueryQueueSchema, QueryQueueDto,
  CreateTranslationSchema, CreateTranslationDto,
  ReviewTranslationSchema, ReviewTranslationDto,
  RevokeTranslationSchema, RevokeTranslationDto,
  GrantReviewerSchema, GrantReviewerDto, RevokeReviewerSchema, RevokeReviewerDto,
  RequestRunSchema, RequestRunDto,
  TaxonomyExportSchema, TaxonomyExportDto,
} from './dto/translations.dto';

const admin = (req: any): AdminRequestContext => req.admin as AdminRequestContext;

@Controller('translations')
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class TranslationsController {
  constructor(
    private readonly svc: TranslationsService,
    private readonly exports: TaxonomyExportService,
  ) {}

  // -------------------------------------------------------------------------
  // COVERAGE + THE REVIEW QUEUE (W028)
  // -------------------------------------------------------------------------
  /** The matrix. Readable with catalogue.read — knowing how much of the product is translated is not a reviewer's
   *  privilege, it is a fact anybody running the platform needs. */
  @Get('coverage') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  coverage() { return this.svc.coverage().then((data) => ({ data })); }

  /** The queue carries the CALLER'S own language scopes, so a console can mark which rows they may act on rather than
   *  offering a button that will 403. */
  @Get('queue') @RequireOwnerPermission(OwnerPermissions.TranslationsReview)
  queue(@Req() req: any, @ZodQuery(QueryQueueSchema) q: QueryQueueDto) {
    return this.svc.queue(admin(req), q).then((data) => ({ data }));
  }

  @Get('entity/:entityType/:entityId') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  forEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.svc.forEntity(entityType, entityId).then((data) => ({ data }));
  }

  @Get(':id/history') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  history(@Param('id') id: string) { return this.svc.history(id).then((data) => ({ data })); }

  // -------------------------------------------------------------------------
  // AUTHORING + REVIEW
  // -------------------------------------------------------------------------
  /** Author a human translation. Live on insert, and language-scoped: somebody who cannot read Tamil should not be
   *  typing Tamil onto a farmer-facing surface any more than they should be approving it. */
  @Post() @RequireOwnerPermission(OwnerPermissions.TranslationsReview)
  create(@Req() req: any, @ZodBody(CreateTranslationSchema) dto: CreateTranslationDto) {
    return this.svc.create(admin(req), dto).then((data) => ({ data }));
  }

  @Post(':id/review') @RequireOwnerPermission(OwnerPermissions.TranslationsReview)
  review(@Req() req: any, @Param('id') id: string, @ZodBody(ReviewTranslationSchema) dto: ReviewTranslationDto) {
    return this.svc.review(admin(req), id, dto).then((data) => ({ data }));
  }

  /** Withdraw a live translation — the entity falls back to its canonical name, which is degraded and readable rather
   *  than wrong and confident. DELETE because that is the operator's intent; the row is soft-deleted. */
  @Delete(':id') @RequireOwnerPermission(OwnerPermissions.TranslationsReview)
  revoke(@Req() req: any, @Param('id') id: string, @ZodBody(RevokeTranslationSchema) dto: RevokeTranslationDto) {
    return this.svc.revoke(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // REVIEWER SCOPES — who may speak for a language
  // -------------------------------------------------------------------------
  @Get('reviewers') @RequireOwnerPermission(OwnerPermissions.TranslationsManage)
  reviewers() { return this.svc.reviewers().then((data) => ({ data })); }

  /** ELEVATED. Granting a language scope decides who may assert that a sentence a farmer will act on says what the
   *  English says — the one act in this module where a hardware key is proportionate. */
  @Post('reviewers') @RequireOwnerPermission(OwnerPermissions.TranslationsManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  grantReviewer(@Req() req: any, @ZodBody(GrantReviewerSchema) dto: GrantReviewerDto) {
    return this.svc.grantReviewer(admin(req), dto).then((data) => ({ data }));
  }

  @Delete('reviewers/:id') @RequireOwnerPermission(OwnerPermissions.TranslationsManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  revokeReviewer(@Req() req: any, @Param('id') id: string, @ZodBody(RevokeReviewerSchema) dto: RevokeReviewerDto) {
    return this.svc.revokeReviewer(admin(req), id, dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // MACHINE-TRANSLATION RUNS — recorded, and honest that nothing runs
  // -------------------------------------------------------------------------
  @Get('runs') @RequireOwnerPermission(OwnerPermissions.TranslationsManage)
  runs() { return this.svc.runs().then((data) => ({ data })); }

  /** Records a request and translates NOTHING: no engine is configured in this platform. The response says so, and so
   *  does every surface — a spinner over work nothing can perform is the failure ADMIN-1e and ADMIN-2b both refused. */
  @Post('runs') @RequireOwnerPermission(OwnerPermissions.TranslationsManage)
  requestRun(@Req() req: any, @ZodBody(RequestRunSchema) dto: RequestRunDto) {
    return this.svc.requestRun(admin(req), dto).then((data) => ({ data }));
  }

  // -------------------------------------------------------------------------
  // TAXONOMY EXPORTS (ADMIN-3-Q2) — W019's "Export tree", W028's "Export missing"
  // -------------------------------------------------------------------------
  /** POST because it MUTATES THE AUDIT LEDGER: the receipt is a write. Same reasoning as every other export in this
   *  realm, and it is also what stops a prefetcher producing receipts. */
  @Post('exports') @RequireOwnerPermission(OwnerPermissions.CatalogueRead)
  taxonomyExport(@Req() req: any, @ZodBody(TaxonomyExportSchema) dto: TaxonomyExportDto) {
    return this.exports.export(admin(req), dto).then((data) => ({ data }));
  }
}
