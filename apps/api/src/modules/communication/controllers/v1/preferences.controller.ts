// modules/communication/controllers/v1/preferences.controller.ts · the caller's notification preferences + quiet
// hours (own userId only). Disabling a mandatory event throws (service, Law 6).
// [PC-56 STORE-4c · founder Q12] NO `communication` flag guard: a person's preferences and quiet hours are never switched off (the guard
// stays on chat, calls and push devices). F-22: audit IPs through `clientIpOf`. `GET matrix?audience=buyer` (B4) lists only the events a
// buyer can receive (`domain/buyer-audience.ts`); no audience → every event (web-tenant's W433, unchanged).
// [PC-56 TENANT-8b] W433 + the notification FORM chain (W2683–W2686):
//   GET  /notifications/matrix                   W433 — the member's OWN catalogue read (F-13: NOT notification.manage)
//   POST /notifications/quiet-hours/preview      the Change-window review (zone registry, window maths, diff) — no key
//   POST /notifications/preferences/preview      the Save-preferences review (locked / not-sent / unknown, diff) — no key
//   POST /notifications/language/preview         the Change-language review (the ACTIVE registry) — no key
//   PUT  /notifications/preferences · /quiet-hours   the writes — keyed when the form sends a key (it does), audited
//   (Change language WRITES through identity's PATCH /users/me — the module that owns `users.language_code`.)
import { Body, Controller, Get, Headers, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { clientIpOf } from '../../../../core/http/client-ip';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { PreferenceService } from '../../services/preference.service';
import { SetPreferencesSchema, SetPreferencesDto } from '../../dto/set-notification-preference.dto';
import { SetQuietHoursSchema, SetQuietHoursDto, PreviewQuietHoursSchema, PreviewQuietHoursDto, PreviewLanguageSchema } from '../../dto/set-quiet-hours.dto';
import { MatrixQuerySchema, MatrixQueryDto } from '../../dto/matrix-query.dto';

const ipOf = (r: Request) => clientIpOf(r);

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class PreferencesController {
  constructor(private readonly svc: PreferenceService) {}

  @Get('matrix')
  matrix(@CurrentContext() ctx: RequestContext, @ZodQuery(MatrixQuerySchema) q: MatrixQueryDto) { return this.svc.matrix(ctx.tenantId, ctx.userId, q.audience).then((data) => ({ data })); }

  @Get('preferences')
  list(@CurrentContext() ctx: RequestContext) { return this.svc.list(ctx.userId).then((data) => ({ data })); }
  @Post('preferences/preview')
  previewPrefs(@CurrentContext() ctx: RequestContext, @ZodBody(SetPreferencesSchema) dto: SetPreferencesDto) {
    return this.svc.previewPreferences(ctx.userId, dto.preferences).then((data) => ({ data }));
  }
  @Put('preferences')
  set(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(SetPreferencesSchema) dto: SetPreferencesDto) {
    return this.svc.setPreferences(ctx.tenantId, ctx.userId, dto.preferences, { idemKey: key ?? null, ip: ipOf(r) }).then((data) => ({ data }));
  }

  @Get('quiet-hours')
  getQuiet(@CurrentContext() ctx: RequestContext) { return this.svc.getQuietHours(ctx.userId).then((data) => ({ data })); }
  @Post('quiet-hours/preview')
  previewQuiet(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewQuietHoursSchema) dto: PreviewQuietHoursDto) {
    return this.svc.previewWindow(ctx.tenantId, ctx.userId, dto).then((data) => ({ data }));
  }
  @Put('quiet-hours')
  setQuiet(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @ZodBody(SetQuietHoursSchema) dto: SetQuietHoursDto) {
    return this.svc.setQuietHours(ctx.tenantId, ctx.userId, dto, { idemKey: key ?? null, ip: ipOf(r) }).then((data) => ({ data }));
  }

  @Post('language/preview')
  previewLanguage(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const p = PreviewLanguageSchema.safeParse(body ?? {});
    return this.svc.previewLanguage(ctx.tenantId, ctx.userId, p.success ? p.data.languageCode : undefined).then((data) => ({ data }));
  }
}
