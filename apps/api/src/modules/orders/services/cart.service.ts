// modules/orders/services/cart.service.ts · the buyer's cart. Validates each item against the
// LIVE listing via ListingService (cross-module public API, Law 11) — purchasable + in stock.
//
// PC-56 STORE-2b · B1 (survey F-13 / F-14 / F-18 / F-24, founder D4) — THE CART READ SAYS WHAT IS TRUE, PER LINE:
//   • BOTH prices — `addedPriceMinor` (what the buyer agreed: added at, or explicitly accepted) and `currentPriceMinor` (the listing's price
//     now) — `priceChanged` derived from them and `priceDeltaMinor` (current − added, signed) computed HERE in bigint, so the storefront only
//     formats money and never subtracts it;
//   • the quantity as a DECIMAL STRING (`quantityDecimal` "2.500"), `minOrderQty`, `quantityAvailable` (decimal strings) and `unitCode`;
//     `belowMin` / `overAvailable` flags from the one rule (domain/cart-rules.ts) — no float (F-24: the `Math.round(qty * 1000)` site is gone);
//   • `reason` for a line that cannot be bought — sold_out · paused · expired · withdrawn · suspended · licence_required · not_found — never
//     a bare boolean (`purchasable` stays, derived, for the older clients);
//   • who sells: the ORGANISATION (slug + name) and the district — never a person (HOTFIX-4 D3);
//   • the subtotal = the purchasable lines at the CURRENT price (a line that cannot be bought is not a sum the buyer can pay; delivery, fees
//     and taxes are quoted at checkout). Lines in a drifted state are included at the current price — the price placement would charge
//     once accepted; placement refuses until they are.
// `quantity` (number) and `available` (number) remain on the wire, DEPRECATED, for mobile's compiled baseline (the 2a precedent).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { ListingService } from '../../listings/services/listing.service';
import { CartRepository } from '../repositories/cart.repository';
import { CartItemService } from './cart-item.service';
import { AddToCartDto } from '../dto/create-cart-item.dto';
import { isBelowMin, lineReason, lineTotalFromMilli, milliToDecimal, priceDrift, toMilli } from '../domain/cart-rules';

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
  addItem(tenantId: string, userId: string, dto: AddToCartDto, storeTenantId?: string | null) { return this.items.addItem(tenantId, userId, dto, storeTenantId); }
  updateItem(tenantId: string, userId: string, listingId: string, quantity: number | string) { return this.items.updateItem(tenantId, userId, listingId, quantity); }
  removeItem(tenantId: string, userId: string, listingId: string) { return this.items.removeItem(tenantId, userId, listingId); }
  clear(tenantId: string, userId: string) { return this.items.clear(tenantId, userId); }
  /** B12: the explicit accept of the current price; answers what was accepted AND the re-read cart. */
  async acceptPrice(tenantId: string, userId: string, listingId: string, expectedPriceMinor?: string | null) {
    const accepted = await this.items.acceptPrice(tenantId, userId, listingId, expectedPriceMinor);
    return { accepted, cart: await this.getCart(tenantId, userId) };
  }

  /** Cart view with the CURRENT listing snapshot, both prices, the line's reason and the minimum (STORE-2b). */
  async getCart(tenantId: string, userId: string) {
    return timed(this.metrics, 'orders.cart_get', { tenant: tenantId }, async () => {
      const cartId = await this.carts.activeId(tenantId, userId);
      // PC-56 HOTFIX-4 · C4 (survey C-7): the cart says its CURRENCY (each line's listing currency; the cart's = the one all lines share, null
      // when empty or mixed) so the storefront prints money from the data, never an 'INR' literal.
      if (!cartId) return { items: [], subtotalMinor: '0', currencyCode: null };
      const rows = await this.carts.items(tenantId, cartId);
      const facts = await this.listings.purchaseFacts(tenantId, rows.map((r) => r.listing_id));
      let subtotal = 0n;
      const items: Array<Record<string, unknown>> = [];
      const currencies = new Set<string>();
      for (const r of rows) {
        const l: any = await this.listings.getById(tenantId, r.listing_id);   // eslint-disable-line @typescript-eslint/no-explicit-any -- the internal listing projection
        const f = facts ? facts.get(r.listing_id) : undefined;
        const qtyMilli = toMilli(r.quantity);
        const reason = !l || (facts && !f) ? 'not_found' : lineReason({
          status: l.status, visibility: f?.visibility ?? l.visibility, quantityAvailable: l.quantityAvailable,
          sellerSuspended: f?.sellerSuspended ?? false, licenceRequired: f?.licenceRequired ?? false,
        });
        const added = BigInt(r.added_price_minor);
        const current = l ? BigInt(l.priceMinor) : null;
        const drift = current !== null ? priceDrift(added, current) : null;
        const unit = current ?? added;
        const line = lineTotalFromMilli(unit, qtyMilli);
        const purchasable = reason === null;
        const availableMilli = l ? toMilli(l.quantityAvailable) : 0n;
        if (purchasable) subtotal += line;
        const currencyCode: string | null = l?.currencyCode ?? null;
        if (currencyCode && purchasable) currencies.add(currencyCode);
        items.push({
          listingId: r.listing_id, title: l?.title ?? null,
          quantity: Number(milliToDecimal(qtyMilli)), quantityDecimal: milliToDecimal(qtyMilli),
          unitCode: l?.unitCode ?? null,
          minOrderQty: l ? milliToDecimal(toMilli(l.minOrderQty ?? 0)) : null,
          quantityAvailable: l ? milliToDecimal(availableMilli) : null,
          available: l ? Number(l.quantityAvailable) : 0,
          addedPriceMinor: added.toString(), currentPriceMinor: current !== null ? current.toString() : null,
          priceChanged: drift ? drift.changed : false, priceDeltaMinor: drift && drift.changed ? drift.deltaMinor : null,
          unitPriceMinor: unit.toString(), lineTotalMinor: line.toString(), currencyCode,
          purchasable, reason,
          belowMin: l ? isBelowMin(milliToDecimal(qtyMilli), l.minOrderQty) : false,
          overAvailable: l ? qtyMilli > availableMilli : false,
          organisation: f?.organisation ?? null, district: f?.district ?? null,
        });
      }
      return { items, subtotalMinor: subtotal.toString(), currencyCode: currencies.size === 1 ? [...currencies][0] : null };
    });
  }
}
