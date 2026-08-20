// modules/dairy/controllers/v1/collections.controller.ts · counter milk-collection entry + member reads.
// record needs dairy.manage (the MCC operator); list is the member's own or staff. `dairy` flag.
import { Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { MilkCollectionService } from '../../services/milk-collection.service';
import { RecordCollectionSchema, RecordCollectionDto } from '../../dto/create-milk-collection.dto';
import { QueryCollectionsSchema, QueryCollectionsDto } from '../../dto/query-milk-collection.dto';
import { DairyPermissions, canManageDairy, canCloseSettlement } from '../../policies/dairy.policies';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'dairy/collections', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class CollectionsController {
  constructor(private readonly collections: MilkCollectionService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx), canCloseSettlement: canCloseSettlement(ctx) }; }

  @Post() @RequirePermissions(DairyPermissions.Manage)
  record(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RecordCollectionSchema) dto: RecordCollectionDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.collections.record(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCollectionsSchema) q: QueryCollectionsDto) {
    return this.collections.list(ctx.tenantId, this.actor(ctx), { membershipId: q.membershipId, from: q.from, to: q.to, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
}
