// modules/orders/controllers/v1/carts.controller.ts · the buyer's cart (owner-scoped).
// PC-56 STORE-2b:
//   • B5 (founder D2) — every route sits behind `StorefrontCartGuard` (buying's one kill-switch, 503 STOREFRONT_CART_OFF), AFTER the auth
//     guards (an anonymous / role-less caller still meets 401 / 403 first);
//   • B2 (founder D4) — `POST /v1/cart/items/:listingId/accept-price` {expectedPriceMinor?}: the buyer's explicit re-agree of a changed price;
//     answers { accepted, cart };
//   • B4 (founder D3) — the add reads the STORE the request came from (`X-Tenant-Slug`, which a signed-in request otherwise ignores: the JWT's
//     tenant wins in the middleware) only to NAME the other store when the listing is not this session's organisation's (WRONG_STORE).
import { Controller, Delete, Get, Headers, HttpCode, Optional, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { TenantSlugResolver } from '../../../../core/tenancy-context/tenant-slug-resolver';
import { CartService } from '../../services/cart.service';
import { AddToCartSchema, AddToCartDto, UpdateCartItemSchema, UpdateCartItemDto, AcceptPriceSchema, AcceptPriceDto } from '../../dto/create-cart-item.dto';
import { OrderPermissions } from '../../policies/orders.policies';
import { StorefrontCartGuard } from '../../storefront-cart.guard';
import { ValidationError } from '../../../../shared/errors/app-error';
import { UUID_RE } from '../../../../shared/pagination/us-keyset';

@Controller({ path: 'cart', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, StorefrontCartGuard)
@RequirePermissions(OrderPermissions.Create)
export class CartsController {
  constructor(private readonly cart: CartService, @Optional() private readonly slugs?: TenantSlugResolver) {}

  /** D3: the organisation whose store the request came from (the storefront sends its slug), or null. Never used to choose WHOSE cart. */
  private async storeTenant(slug: string | undefined): Promise<string | null> {
    if (!slug || !this.slugs) return null;
    try { return await this.slugs.resolve(slug); } catch { return null; }
  }

  @Get() get(@CurrentContext() ctx: RequestContext) { return this.cart.getCart(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post('items') async add(@CurrentContext() ctx: RequestContext, @ZodBody(AddToCartSchema) dto: AddToCartDto, @Headers('x-tenant-slug') slug?: string) {
    return this.cart.addItem(ctx.tenantId, ctx.userId, dto, await this.storeTenant(slug)).then((data) => ({ data }));
  }
  @Patch('items/:listingId') update(@CurrentContext() ctx: RequestContext, @Param('listingId') listingId: string, @ZodBody(UpdateCartItemSchema) dto: UpdateCartItemDto) { return this.cart.updateItem(ctx.tenantId, ctx.userId, listingId, dto.quantity).then((data) => ({ data })); }
  @Post('items/:listingId/accept-price') @HttpCode(200) acceptPrice(@CurrentContext() ctx: RequestContext, @Param('listingId') listingId: string, @ZodBody(AcceptPriceSchema) dto: AcceptPriceDto) {
    if (!UUID_RE.test(listingId)) throw new ValidationError('listingId must be a uuid');
    return this.cart.acceptPrice(ctx.tenantId, ctx.userId, listingId, dto.expectedPriceMinor ?? null).then((data) => ({ data }));
  }
  @Delete('items/:listingId') remove(@CurrentContext() ctx: RequestContext, @Param('listingId') listingId: string) { return this.cart.removeItem(ctx.tenantId, ctx.userId, listingId).then((data) => ({ data })); }
  @Delete() clear(@CurrentContext() ctx: RequestContext) { return this.cart.clear(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
}
