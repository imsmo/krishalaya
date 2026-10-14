// modules/orders/services/cart-item.service.ts
// Canonical cart-item use-cases (add / update qty / remove / clear / list / accept-price). Each item is validated against
// the LIVE listing via ListingService (cross-module public API, Law 11) — purchasable + in stock — and
// the price is SNAPSHOT at add time for drift detection. The cart is always the caller's OWN active cart,
// resolved server-side (anti-IDOR — no cart_id from the client). One ACID tx per write (UoW). CartService
// delegates its item mutations here so there's a single implementation (consolidation).
//
// PC-56 STORE-2b · B1–B4 (founder D1, D3, D4) — WHAT'S IN THE CART IS REAL. Add and update apply the ONE domain rule (domain/cart-rules.ts):
//   • the line's REASON when it cannot be bought, by name — sold_out · paused · expired · withdrawn · suspended (a suspended seller, F-15 cart
//     half) · not_found — and LICENCE_REQUIRED for a product a national `license_required` rule binds (D1: no buyer licence flow exists);
//   • BELOW_MIN_ORDER with the minimum and the unit (D4); LISTING_INSUFFICIENT_STOCK above what is available — both over DECIMAL STRINGS
//     (numeric(14,3); "2.5" is stored and read back as "2.500"), never a float comparison (F-24);
//   • WRONG_STORE (D3, one store per session): a listing that is not this session's organisation's but IS on sale in the store the request came
//     from (`X-Tenant-Slug`, resolved by the controller) is refused naming THAT store's slug — the storefront prints "you are signed in to
//     <org A>; sign in to <org B> to buy here", never "check your entry";
//   • ACCEPT PRICE (B12): the buyer's explicit act re-snapshots `added_price_minor` to the CURRENT price inside the cart's row lock; idempotent
//     (an unchanged price is a no-op); refused PRICE_CHANGED when the price moved again since the buyer was shown it (`expectedPriceMinor`),
//     refused by reason when the line is not purchasable. Recorded in cart_items.updated_at / updated_by + the response (no audit row: a cart
//     writes none — the canon's "audit trail entry" is refused by name; the money decision is frozen on the ORDER at placement).
// Re-adding a line keeps today's behaviour: the quantity is SET and the price re-snapshotted (the buyer is looking at the listing's current
// price when they press Add — the same act as an accept).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { ListingService } from '../../listings/services/listing.service';
import { CartRepository } from '../repositories/cart.repository';
import { CartItemRepository } from '../repositories/cart-item.repository';
import { ListingNotPurchasableError, InsufficientListingStockError, CartNotFoundError, LicenceRequiredError, WrongStoreError, PriceChangedError } from '../domain/orders.errors';
import { assertMinOrder, compareQty, lineReason, milliToDecimal, normaliseQty, priceDrift, toMilli } from '../domain/cart-rules';
import { AddToCartDto } from '../dto/create-cart-item.dto';

/** The listing props the cart reads (ListingService.getById's internal projection). */
interface CartListing { id: string; tenantId: string; status: string; visibility: string; quantityAvailable: number; minOrderQty: number; unitCode: string; priceMinor: bigint; currencyCode: string }

@Injectable()
export class CartItemService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly listings: ListingService,
    private readonly carts: CartRepository,
    private readonly items: CartItemRepository,
  ) {}

  /** D3: the listing is not this session's organisation's — is it on sale in the store the request came from? Then name that store. */
  private async wrongStore(sessionTenantId: string, storeTenantId: string | null | undefined, listingId: string): Promise<WrongStoreError | null> {
    if (!storeTenantId || storeTenantId === sessionTenantId) return null;
    const other = await this.listings.getById(storeTenantId, listingId) as CartListing | null;
    if (!other || other.status !== 'published' || (other.visibility !== 'public' && other.visibility !== 'cross_tenant')) return null;
    const facts = await this.listings.purchaseFacts(storeTenantId, [listingId]);
    const org = facts?.get(listingId)?.organisation ?? null;
    return new WrongStoreError(listingId, org?.slug ?? null, org?.name ?? null);
  }

  /** The one rule at add and update: the line's reason (by name), the licence lock, the minimum order, the stock — decimal strings. */
  private async assertBuyable(tenantId: string, listingId: string, qty: string, storeTenantId?: string | null): Promise<CartListing> {
    const l = await this.listings.getById(tenantId, listingId) as CartListing | null;
    if (!l) {
      const ws = await this.wrongStore(tenantId, storeTenantId, listingId);
      if (ws) { this.metrics.inc('orders.cart_refused', { tenant: tenantId, code: 'WRONG_STORE' }); throw ws; }
      throw new ListingNotPurchasableError(listingId, 'not_found');
    }
    const facts = await this.listings.purchaseFacts(tenantId, [listingId]);
    const f = facts ? facts.get(listingId) : undefined;
    const reason = facts && !f ? 'not_found' : lineReason({
      status: l.status, visibility: f?.visibility ?? l.visibility, quantityAvailable: l.quantityAvailable,
      sellerSuspended: f?.sellerSuspended ?? false, licenceRequired: f?.licenceRequired ?? false,
    });
    if (reason === 'licence_required') { this.metrics.inc('orders.cart_refused', { tenant: tenantId, code: 'LICENCE_REQUIRED' }); throw new LicenceRequiredError(listingId); }
    if (reason) throw new ListingNotPurchasableError(listingId, reason);
    assertMinOrder(listingId, qty, l.minOrderQty, l.unitCode);
    if (compareQty(qty, l.quantityAvailable) > 0) throw new InsufficientListingStockError(listingId, qty, milliToDecimal(toMilli(l.quantityAvailable)));
    return l;
  }

  async addItem(tenantId: string, userId: string, dto: AddToCartDto, storeTenantId?: string | null) {
    const qty = normaliseQty(dto.quantity);
    const l = await this.assertBuyable(tenantId, dto.listingId, qty, storeTenantId);
    await this.uow.run(tenantId, async (tx) => {
      const cartId = await this.carts.getOrCreateActiveId(tx, tenantId, userId);
      await this.items.upsert(tx, cartId, dto.listingId, qty, BigInt(l.priceMinor));
    }, { userId });
    this.metrics.inc('orders.cart_add', { tenant: tenantId });
    return { ok: true };
  }

  async updateItem(tenantId: string, userId: string, listingId: string, quantity: number | string) {
    const qty = normaliseQty(quantity);
    await this.assertBuyable(tenantId, listingId, qty);
    await this.uow.run(tenantId, async (tx) => {
      const cartId = await this.carts.activeIdForUpdate(tx, tenantId, userId);
      if (!cartId) throw new CartNotFoundError();
      const n = await this.items.setQty(tx, cartId, listingId, qty);
      if (n === 0) throw new CartNotFoundError();
    }, { userId });
    return { ok: true };
  }

  /**
   * B12 · ACCEPT THE CURRENT PRICE — the buyer's explicit re-agree. Inside the cart's row lock (the active cart FOR UPDATE, then the line FOR
   * UPDATE): the line must be purchasable (else its reason, by name); when `expectedPriceMinor` is given and the current price differs, the
   * price moved AGAIN since the buyer was shown it → PRICE_CHANGED with the newest two numbers (nothing is accepted unseen); an unchanged price
   * is a no-op (idempotent). Returns what was accepted; the caller re-reads the cart.
   */
  async acceptPrice(tenantId: string, userId: string, listingId: string, expectedPriceMinor?: string | null) {
    const l = await this.listings.getById(tenantId, listingId) as CartListing | null;
    const facts = l ? await this.listings.purchaseFacts(tenantId, [listingId]) : null;
    const f = facts ? facts.get(listingId) : undefined;
    const reason = !l ? 'not_found' : facts && !f ? 'not_found' : lineReason({
      status: l.status, visibility: f?.visibility ?? l.visibility, quantityAvailable: l.quantityAvailable,
      sellerSuspended: f?.sellerSuspended ?? false, licenceRequired: f?.licenceRequired ?? false,
    });
    if (reason) throw new ListingNotPurchasableError(listingId, reason);
    const current = BigInt(l!.priceMinor);
    const result = await this.uow.run(tenantId, async (tx) => {
      const cartId = await this.carts.activeIdForUpdate(tx, tenantId, userId);
      if (!cartId) throw new CartNotFoundError();
      const line = await this.items.lineForUpdate(tx, cartId, listingId);
      if (!line) throw new CartNotFoundError();
      const drift = priceDrift(line.added_price_minor, current);
      if (expectedPriceMinor !== undefined && expectedPriceMinor !== null && BigInt(expectedPriceMinor) !== current) {
        throw new PriceChangedError(listingId, drift.addedPriceMinor, drift.currentPriceMinor, l!.currencyCode ?? null);
      }
      if (!drift.changed) return { changed: false, at: null as string | null, drift };
      const at = await this.items.acceptPrice(tx, cartId, listingId, current, userId);
      return { changed: true, at, drift };
    }, { userId });
    if (result.changed) this.metrics.inc('orders.cart_accept_price', { tenant: tenantId });
    return {
      listingId, changed: result.changed, previousPriceMinor: result.drift.addedPriceMinor, acceptedPriceMinor: result.drift.currentPriceMinor,
      currencyCode: l!.currencyCode ?? null, acceptedAt: result.at,
    };
  }

  async removeItem(tenantId: string, userId: string, listingId: string) {
    await this.uow.run(tenantId, async (tx) => {
      const cartId = await this.carts.activeIdForUpdate(tx, tenantId, userId);
      if (cartId) await this.items.remove(tx, cartId, listingId);
    }, { userId });
    return { ok: true };
  }

  async clear(tenantId: string, userId: string) {
    await this.uow.run(tenantId, async (tx) => { const id = await this.carts.activeIdForUpdate(tx, tenantId, userId); if (id) await this.items.clear(tx, id); }, { userId });
    return { ok: true };
  }

  /** Raw lines of the caller's active cart (replica). The composite priced view is CartService.getCart. */
  async listItems(tenantId: string, userId: string) {
    return timed(this.metrics, 'orders.cart_items', { tenant: tenantId }, async () => {
      const cartId = await this.carts.activeId(tenantId, userId);
      if (!cartId) return { items: [] as Array<Record<string, unknown>> };
      const rows = await this.items.listByCart(tenantId, cartId);
      return { items: rows.map((r) => ({ listingId: r.listing_id, quantity: Number(r.quantity), quantityDecimal: normaliseQty(r.quantity), addedPriceMinor: String(r.added_price_minor) })) };
    });
  }
}
