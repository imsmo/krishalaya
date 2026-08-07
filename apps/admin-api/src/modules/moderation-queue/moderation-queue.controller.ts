// apps/admin-api/src/modules/moderation-queue/moderation-queue.controller.ts · W090–W092 (PC-56 ADMIN-5f).
//
// TWO NEW PERMISSIONS, both named by the canon. `moderation.listings` holds, releases, removes and decides;
// `moderation.messages` is what a message BODY needs and is deliberately not required for anything else — an operator
// can work this queue all day without opening anybody's private thread, and the one who needs to has asked for that
// specifically.
//
// WRITES ARE STEP-UP GATED. Archiving a farmer's listing is irreversible and can be worth lakhs.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { ListingModerationService } from './services/listing-moderation.service';
import { ReportQueueService } from './services/report-queue.service';
import {
  HoldSchema, HoldDto, ReleaseSchema, ReleaseDto, RemoveSchema, RemoveDto,
  QueryHeldSchema, QueryHeldDto, QueryReportsSchema, QueryReportsDto, DecideReportSchema, DecideReportDto,
} from './dto/moderation-queue.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const twoPart = (c?: string) => {
  if (!c) return undefined;
  const [a, b] = Buffer.from(c, 'base64').toString().split('|');
  return a && b ? { a, b } : undefined;
};

@Controller({ path: 'moderation', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class ModerationQueueController {
  constructor(
    private readonly listings: ListingModerationService,
    private readonly reports: ReportQueueService,
  ) {}

  /* ======================= W090 · held listings ======================= */

  @Get('listings') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  held(@ZodQuery(QueryHeldSchema) q: QueryHeldDto, @Req() req: any) {
    const c = twoPart(q.cursor);
    return this.listings.queue({ cursor: c ? { d: c.a, id: c.b } : undefined, limit: q.limit }, admin(req)?.userId ?? null)
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, stateSource: r.stateSource } }));
  }

  /* ======================= W091 · one held listing ======================= */

  @Get('listings/:id') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  listing(@Param('id') id: string, @Req() req: any) {
    return this.listings.get(id, admin(req)?.userId ?? null).then((data) => ({ data }));
  }

  @Post('listings/:id/hold') @RequireOwnerPermission(OwnerPermissions.ModerationListings) @UseGuards(StepUpReauthGuard)
  hold(@Param('id') id: string, @ZodBody(HoldSchema) dto: HoldDto, @Req() req: any) {
    return this.listings.hold(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post('listings/:id/release') @RequireOwnerPermission(OwnerPermissions.ModerationListings) @UseGuards(StepUpReauthGuard)
  release(@Param('id') id: string, @ZodBody(ReleaseSchema) dto: ReleaseDto, @Req() req: any) {
    return this.listings.release(admin(req), id, dto).then((data) => ({ data }));
  }

  @Post('listings/:id/remove') @RequireOwnerPermission(OwnerPermissions.ModerationListings) @UseGuards(StepUpReauthGuard)
  remove(@Param('id') id: string, @ZodBody(RemoveSchema) dto: RemoveDto, @Req() req: any) {
    return this.listings.remove(admin(req), id, dto).then((data) => ({ data }));
  }

  /* ======================= W092 · reports ======================= */

  @Get('reports') @RequireOwnerPermission(OwnerPermissions.ModerationRead)
  reportQueue(@ZodQuery(QueryReportsSchema) q: QueryReportsDto) {
    const c = twoPart(q.cursor);
    const { cursor, ...rest } = q;
    void cursor;
    return this.reports.queue({ ...rest, cursor: c ? { c: c.a, id: c.b } : undefined })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, orderedWithinPageOnly: r.orderedWithinPageOnly, slaHours: r.slaHours, subjectTypes: r.subjectTypes, outcomes: r.outcomes, openTotal: r.openTotal } }));
  }

  @Post('reports/:id/decide') @RequireOwnerPermission(OwnerPermissions.ModerationListings) @UseGuards(StepUpReauthGuard)
  decide(@Param('id') id: string, @ZodBody(DecideReportSchema) dto: DecideReportDto, @Req() req: any) {
    return this.reports.decide(admin(req), id, dto).then((data) => ({ data }));
  }
}
