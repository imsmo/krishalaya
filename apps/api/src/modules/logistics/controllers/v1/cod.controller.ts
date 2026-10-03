// modules/logistics/controllers/v1/cod.controller.ts · PC-56 TENANT-SW-a · W243 — COD as a ledger fact: the board (tiles computed from the
// ledger, riders' cash in hand against the cap, recent cash days), shortfalls against orders, and the cash day (open; close by a second
// person). `logistics` flag + logistics.manage; the money acts also need `cod_ledger` ON (refused by name otherwise). Writes keyed.
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ShipmentPermissions, canManageLogistics } from '../../policies/logistics.policies';
import { CodLedgerService } from '../../services/cod-ledger.service';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const ShortfallQuery = z.object({ status: z.enum(['open', 'collected']).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const CollectShortfall = z.object({ depositRef: z.string().trim().min(3).max(120), note: z.string().trim().max(500).optional() }).strict();
const CloseDay = z.object({ carries: z.array(z.object({ remittanceId: z.string().uuid(), reason: z.string().trim().min(10).max(500) }).strict()).max(500).default([]), note: z.string().trim().min(3).max(500).optional() }).strict();

@Controller({ path: 'logistics/cod', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('logistics')
export class CodController {
  constructor(private readonly cod: CodLedgerService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageLogistics(ctx) }; }

  /** Tiles (collected today · deposited today · in rider hands · unreconciled > 24 h · shortfalls open) — all from the ledger. */
  @Get('board') @RequirePermissions(ShipmentPermissions.Manage)
  board(@CurrentContext() ctx: RequestContext) { return this.cod.board(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('shortfalls') @RequirePermissions(ShipmentPermissions.Manage)
  shortfalls(@CurrentContext() ctx: RequestContext, @ZodQuery(ShortfallQuery) q: z.infer<typeof ShortfallQuery>) {
    return this.cod.shortfalls(ctx.tenantId, this.actor(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Post('shortfalls/:id/collect') @RequirePermissions(ShipmentPermissions.Manage)
  collectShortfall(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(CollectShortfall) dto: z.infer<typeof CollectShortfall>) {
    return this.cod.collectShortfall(ctx.tenantId, this.actor(ctx), reqKey(key), id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('cash-days') @RequirePermissions(ShipmentPermissions.Manage)
  openDay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Body() _b: unknown) {
    return this.cod.openDay(ctx.tenantId, this.actor(ctx), reqKey(key), ipOf(r)).then((data) => ({ data }));
  }
  /** W2531–W2533 "Close today's cash day (checker)" — a different person from the opener; a re-run changes nothing. */
  @Post('cash-days/:date/close') @RequirePermissions(ShipmentPermissions.Manage)
  closeDay(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('date') date: string, @ZodBody(CloseDay) dto: z.infer<typeof CloseDay>) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestError('date must be YYYY-MM-DD');
    return this.cod.closeDay(ctx.tenantId, this.actor(ctx), reqKey(key), date, dto, ipOf(r)).then((data) => ({ data }));
  }
}
