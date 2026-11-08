// modules/warehousing/controllers/v1/nwr.controller.ts · electronic NWR receipts: holder/staff reads + the one hardened act. `warehousing` flag.
// PC-56 OPS-2b (founder Q3-A, Q5-A, Q11-A): issue → 409 ENWR_ISSUE_NOT_ON_PLATFORM and release → 409 ENWR_RELEASE_NOT_STANDALONE, both refused by
// name in the service before anything is read or written; cancel = the warehouse's named operator only, Idempotency-Key (400 without) + a reason
// (400 ENWR_CANCEL_REASON_REQUIRED without), one audit row. list/get = the holder's own or staff (unchanged).
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { NwrReceiptService } from '../../services/nwr-receipt.service';
import { IssueNwrSchema, IssueNwrDto } from '../../dto/create-nwr-receipt.dto';
import { QueryNwrSchema, QueryNwrDto } from '../../dto/query-nwr-receipt.dto';
import { WarehousingPermissions, canManageWarehouse, canStore } from '../../policies/warehousing.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'warehousing/nwr', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('warehousing')
export class NwrController {
  constructor(private readonly svc: NwrReceiptService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageWarehouse(ctx), canStore: canStore(ctx) }; }   // PC-56 OPS-2a: no administrator escape (Q11-A)

  @Post() @RequirePermissions(WarehousingPermissions.Manage)
  issue(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(IssueNwrSchema) dto: IssueNwrDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.issue(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryNwrSchema) q: QueryNwrDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/release') @RequirePermissions(WarehousingPermissions.Manage)
  release(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.release(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/cancel') @RequirePermissions(WarehousingPermissions.Manage)
  cancel(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @Body('reason') reason?: unknown) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.cancel(ctx.tenantId, this.actor(ctx), id, key, typeof reason === 'string' ? reason : null, ipOf(r)).then((data) => ({ data }));
  }
}
