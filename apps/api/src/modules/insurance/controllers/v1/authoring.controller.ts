// modules/insurance/controllers/v1/authoring.controller.ts · PC-54 W54-9 (insurance.manage class-gated).
import { Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { InsurancePermissions } from '../../policies/insurance.policies';
import { AuthoringService } from '../../services/authoring.service';
import { z } from 'zod';

const CreateProductSchema = z.object({
  partnerId: z.string().uuid(), productKindId: z.string().uuid(),
  defaultName: z.string().trim().min(3).max(200),
  premiumCalc: z.record(z.unknown()),
  sumInsuredRules: z.record(z.unknown()).optional(),
  govtSubsidyBps: z.number().int().min(0).max(10000).optional(),
  ourCommissionBps: z.number().int().min(0).max(10000).optional(),
  isParametric: z.boolean().optional(),
}).strict();
const UpdateProductSchema = z.object({
  defaultName: z.string().trim().min(3).max(200).optional(),
  premiumCalc: z.record(z.unknown()).optional(),
  sumInsuredRules: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((o) => Object.keys(o).length > 0, { message: 'at least one field' });
const IssueSchema = z.object({ policyNo: z.string().trim().min(3).max(80), parametricTriggers: z.record(z.unknown()).optional() }).strict();

@Controller({ path: 'insurance/authoring', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions(InsurancePermissions.Manage)
export class AuthoringController {
  constructor(private readonly svc: AuthoringService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: true }; } // class-gated

  @Post('products')
  create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateProductSchema) dto: z.infer<typeof CreateProductSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.createProduct(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Patch('products/:id')
  update(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateProductSchema) dto: z.infer<typeof UpdateProductSchema>) {
    return this.svc.updateProduct(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Post('policies/:id/issue')
  issue(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(IssueSchema) dto: z.infer<typeof IssueSchema>) {
    return this.svc.issue(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Get('book')
  book(@CurrentContext() ctx: RequestContext, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.book(ctx.tenantId, this.actor(ctx), status, Number(limit) || 100).then((data) => ({ data }));
  }
  @Get('insights')
  insights(@CurrentContext() ctx: RequestContext) { return this.svc.insights(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
}
