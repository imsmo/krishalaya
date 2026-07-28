// modules/insurance/controllers/v1/insurance-products.controller.ts · read-only IRDAI-partner + product
// catalogue browse (screens 282-285). `insurance` flag. Mirrors fintech's PartnersController exactly.
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { InsuranceProductService } from '../../services/insurance-product.service';
import { QueryInsurancePartnersSchema, QueryInsurancePartnersDto } from '../../dto/query-insurance-partner.dto';
import { QueryInsuranceProductsSchema, QueryInsuranceProductsDto } from '../../dto/query-insurance-product.dto';

@Controller({ path: 'insurance', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('insurance')
export class InsuranceProductsController {
  constructor(private readonly svc: InsuranceProductService) {}

  /** IRDAI-gated insurer list (screen 282's insurer-branded hero references this data implicitly via the
   *  product's partner). Always partnerKind='insurer' — never the full financial_partners panel. */
  @Get('partners')
  listPartners(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInsurancePartnersSchema) q: QueryInsurancePartnersDto) {
    return this.svc.listPartners(ctx.tenantId, { activeOnly: q.activeOnly }).then((data) => ({ data }));
  }
  @Get('partners/:id')
  getPartner(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getPartner(ctx.tenantId, id).then((data) => ({ data }));
  }

  /** Product catalogue (keyset-paginated, Law 11 — screens 283/284/285's product selection). */
  @Get('products')
  listProducts(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInsuranceProductsSchema) q: QueryInsuranceProductsDto) {
    return this.svc.listProducts(ctx.tenantId, {
      partnerId: q.partnerId, productKindId: q.productKindId, activeOnly: q.activeOnly, afterId: q.afterId ?? null, limit: q.limit,
    }).then((res) => ({ data: res.items, meta: { nextAfterId: res.nextAfterId } }));
  }
  @Get('products/:id')
  getProduct(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getProduct(ctx.tenantId, id).then((data) => ({ data }));
  }
}
