// modules/communication/controllers/v1/templates.controller.ts · PC-56 TENANT-8a · THE OVERRIDE (W180 · W181 + the
// template-form, template-mutate and templates-form chains). `communication` flag; auth; the verbs are judged by the
// review or the verdict (`notification.templates.manage` writes a draft, `notification.templates.approve` is the
// checker), never by a decorator on the writes, so a refused act is a sentence and never a bare 403. Every write takes an
// Idempotency-Key (Law 3).
//
//   GET    /notifications/events                     the catalogue (notification.manage — unchanged; 8b's F-13)
//   GET    /notifications/templates                  W180 — the slots, keyset, with the live summary (F-12's counts)
//   GET    /notifications/templates/catalogue        the form's event choices, each marked locked or not (either verb)
//   GET    /notifications/templates/languages        the languages an override may be written in (tenant's, else registry)
//   POST   /notifications/templates/preview          the form's review (writes nothing — no key)
//   POST   /notifications/templates                  "Save" / "New override" — a DRAFT version; keyed, audited
//   GET    /notifications/templates/:id              W181 — the slot by any template id this tenant can see
//   GET    /notifications/templates/:id/acts         the confirm step's object + verdicts (`?reason=` to judge one)
//   POST   /notifications/templates/:id/acts/:act    submit · approve · reject · withdraw · retire — WITH A REASON
//
// PC-27's `POST /notifications/templates` (an in-place upsert that minted no version and never sent — F-1) is replaced
// by the draft write on the same path. Static segments are declared BEFORE `:id`.
import { Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { NotificationEventRepository } from '../../repositories/notification-event.repository';
import { TemplateOverrideService, decodeSlotCursor } from '../../services/template-override.service';
import { CommPermissions, canApproveTemplates, canAuthorTemplates } from '../../policies/communication.policies';
import { OverrideActSchema, OverrideActDto, OverrideFormSchema, OverrideFormDto } from '../../dto/create-notification-template.dto';
import { QueryTemplatesSchema, QueryTemplatesDto } from '../../dto/query-notification-template.dto';

const ipOf = (r: Request) => r.ip || null;
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class TemplatesController {
  constructor(private readonly svc: TemplateOverrideService, private readonly events: NotificationEventRepository) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthorTemplates(ctx), canApprove: canApproveTemplates(ctx) }; }

  @Get('events') @RequirePermissions(CommPermissions.Manage)
  catalog() { return this.events.list().then((rows) => ({ data: rows.map((e) => e.toJSON()) })); }

  @Get('templates')
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryTemplatesSchema) q: QueryTemplatesDto) {
    return this.svc.index(ctx.tenantId, this.actor(ctx), {
      eventCode: q.eventCode?.trim() || undefined, channel: q.channel?.trim() || undefined, languageCode: q.languageCode?.trim() || undefined,
      only: q.only, cursor: decodeSlotCursor(q.cursor), limit: q.limit,
    }).then(({ items, nextCursor, ...rest }) => ({ data: items, meta: { nextCursor, ...rest } }));
  }
  @Get('templates/catalogue')
  catalogue(@CurrentContext() ctx: RequestContext) { return this.svc.catalogue(this.actor(ctx)).then((data) => ({ data })); }
  @Get('templates/languages')
  languages(@CurrentContext() ctx: RequestContext) { return this.svc.languages(ctx.tenantId).then((data) => ({ data })); }
  @Post('templates/preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(OverrideFormSchema) dto: OverrideFormDto) {
    return this.svc.preview(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  @Post('templates')
  save(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(OverrideFormSchema) dto: OverrideFormDto) {
    return this.svc.saveDraft(ctx.tenantId, this.actor(ctx), needKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get('templates/:id')
  view(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.view(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Get('templates/:id/acts')
  acts(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('reason') reason?: string) {
    return this.svc.acts(ctx.tenantId, this.actor(ctx), id, typeof reason === 'string' ? reason : null).then((data) => ({ data }));
  }
  @Post('templates/:id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @Param('act') act: string, @ZodBody(OverrideActSchema) dto: OverrideActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), needKey(key), id, act, { reason: dto.reason, versionId: dto.versionId }, ipOf(r)).then((data) => ({ data }));
  }
}
