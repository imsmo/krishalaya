// modules/listings/controllers/group-lots.controller.ts · FPO group-lot endpoints.
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../core/http/zod.pipe';
import { CurrentContext } from '../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../core/tenancy-context/request-context';
import { GroupLotService } from '../services/group-lot.service';
import { GroupLotPledgeService } from '../services/group-lot-pledge.service';
import { CreateGroupLotDto, CreateGroupLotSchema } from '../dto/create-group-lot.dto';
import { PledgeDto, PledgeSchema } from '../dto/create-group-lot-pledge.dto';
import { ListingPermissions } from '../listings.policies';

@Controller({ path: 'group-lots', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('group_lots')
export class GroupLotsController {
  constructor(private readonly lots: GroupLotService, private readonly pledges: GroupLotPledgeService) {}

  @Post()
  @RequirePermissions(ListingPermissions.GroupLotManage)
  async create(@CurrentContext() ctx: RequestContext, @ZodBody(CreateGroupLotSchema) dto: CreateGroupLotDto) {
    return { data: await this.lots.create(ctx.tenantId, ctx.userId, dto) };
  }

  @Post(':id/pledges')
  async pledge(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(PledgeSchema) dto: PledgeDto) {
    await this.lots.pledge(ctx.tenantId, ctx.userId, id, dto.quantity);
    return { data: { ok: true } };
  }

  @Get(':id/pledges')
  async listPledges(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.pledges.listByLot(ctx.tenantId, id) };
  }
}
