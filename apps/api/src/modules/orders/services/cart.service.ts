// modules/orders/services/cart.service.ts · the buyer's cart. Validates each item against the
// LIVE listing via ListingService (cross-module public API, Law 11) — purchasable + in stock.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { ListingService } from '../../listings/services/listing.service';
import { CartRepository } from '../repositories/cart.repository';
import { CartItemService } from './cart-item.service';
import { AddToCartDto } from '../dto/create-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly listings: ListingService,
    private readonly carts: CartRepository,
    private readonly items: CartItemService,
  ) {}

  // Item mutations are owned by CartItemService (single implementation). CartService keeps the composite
  // priced cart view (getCart), which joins the live listing snapshot + price-drift flag.
  addItem(tenantId: string, userId: string, dto: AddToCartDto) { return this.items.addItem(tenantId, userId, dto); }
  updateItem(tenantId: string, userId: string, listingId: string, quantity: number) { return this.items.updateItem(tenantId, userId, listingId, quantity); }
  removeItem(tenantId: string, userId: string, listingId: string) { return this.items.removeItem(tenantId, userId, listingId); }
  clear(tenantId: string, userId: string) { return this.items.clear(tenantId, userId); }
  /** Cart view with the CURRENT listing snapshot + a price-drift flag. */
  async getCart(tenantId: string, userId: string) {
    return timed(this.metrics, 'orders.cart_get', { tenant: tenantId }, async () => {
      const cartId = await this.carts.activeId(tenantId, userId);
      // PC-56 HOTFIX-4 · C4 (survey C-7): the cart says its CURRENCY (each line's listing currency; the cart's = the one all lines share, null
      // when empty or mixed) so the storefront prints money from the data, never an 'INR' literal.
      if (!cartId) return { items: [], subtotalMinor: '0', currencyCode: null };
      const rows = await this.carts.items(tenantId, cartId);
      let subtotal = 0n;
      const items: Array<Record<string, unknown>> = [];
      const currencies = new Set<string>();
      for (const r of rows) {
        const l: any = await this.listings.getById(tenantId, r.listing_id);
        const qty = Number(r.quantity);
        const current = l ? BigInt(l.priceMinor) : BigInt(r.added_price_minor);
        const line = (current * BigInt(Math.round(qty * 1000))) / 1000n;
        subtotal += line;
        const currencyCode: string | null = l?.currencyCode ?? null;
        if (currencyCode) currencies.add(currencyCode);
        items.push({ listingId: r.listing_id, title: l?.title ?? null, quantity: qty, unitPriceMinor: current.toString(), currencyCode,
          lineTotalMinor: line.toString(), priceChanged: l ? BigInt(l.priceMinor) !== BigInt(r.added_price_minor) : false,
          available: l ? Number(l.quantityAvailable) : 0, purchasable: !!l && l.status === 'published' });
      }
      return { items, subtotalMinor: subtotal.toString(), currencyCode: currencies.size === 1 ? [...currencies][0] : null };
    });
  }
}
