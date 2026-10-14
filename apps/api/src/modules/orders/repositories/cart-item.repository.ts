// modules/orders/repositories/cart-item.repository.ts
// Canonical SQL for cart_items (a line in the buyer's cart). cart_items has NO tenant_id column — it is
// reachable ONLY through carts(id), which IS tenant-scoped + RLS-protected; so isolation is enforced by
// always resolving the cart within the caller's tenant first (CartService/CheckoutService do this) and
// passing the resolved cart_id here. Writes run in the caller's tx; reads on the replica. Bounded reads.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';

export interface CartItemRow { id: string; listing_id: string; quantity: string; added_price_minor: string }
const MAX_ITEMS = 200;   // a cart is bounded; never return an unbounded set

@Injectable()
export class CartItemRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Insert-or-update a line (idempotent on (cart_id, listing_id)); snapshots the price at add time. */
  // PC-56 STORE-2b · F-24: quantities are DECIMAL STRINGS ("2.500", numeric(14,3)) end to end — a number is still accepted from the older callers.
  async upsert(tx: TxContext, cartId: string, listingId: string, quantity: number | string, addedPriceMinor: bigint): Promise<void> {
    await tx.query(
      `INSERT INTO cart_items (id, cart_id, listing_id, quantity, added_price_minor) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (cart_id, listing_id) DO UPDATE SET quantity = EXCLUDED.quantity, added_price_minor = EXCLUDED.added_price_minor`,
      [uuidv7(), cartId, listingId, quantity, addedPriceMinor.toString()]);
  }
  async setQty(tx: TxContext, cartId: string, listingId: string, quantity: number | string): Promise<number> {
    const r = await tx.query(`UPDATE cart_items SET quantity=$3 WHERE cart_id=$1 AND listing_id=$2`, [cartId, listingId, quantity]);
    return r.rowCount ?? 0;
  }
  /** PC-56 STORE-2b · B12: ONE line locked for the accept-price act (inside the active cart's row lock the caller already holds). */
  async lineForUpdate(tx: TxContext, cartId: string, listingId: string): Promise<CartItemRow | null> {
    const r = await tx.query<CartItemRow>(`SELECT id, listing_id, quantity, added_price_minor FROM cart_items WHERE cart_id=$1 AND listing_id=$2 FOR UPDATE`, [cartId, listingId]);
    return r.rows[0] ?? null;
  }
  /** PC-56 STORE-2b · B12: re-snapshot the agreed price to the CURRENT one — the buyer's explicit act, stamped by `updated_at` (trigger) and
   *  `updated_by`. Returns the instant it was recorded. */
  async acceptPrice(tx: TxContext, cartId: string, listingId: string, currentPriceMinor: bigint, userId: string): Promise<string | null> {
    const r = await tx.query<{ updated_at: Date | string }>(
      `UPDATE cart_items SET added_price_minor = $3, updated_by = $4 WHERE cart_id = $1 AND listing_id = $2 RETURNING updated_at`,
      [cartId, listingId, currentPriceMinor.toString(), userId]);
    const at = r.rows[0]?.updated_at;
    return at ? new Date(at).toISOString() : null;
  }
  async remove(tx: TxContext, cartId: string, listingId: string): Promise<void> {
    await tx.query(`DELETE FROM cart_items WHERE cart_id=$1 AND listing_id=$2`, [cartId, listingId]);
  }
  async clear(tx: TxContext, cartId: string): Promise<void> { await tx.query(`DELETE FROM cart_items WHERE cart_id=$1`, [cartId]); }
  /** Lock the cart's lines for a checkout/mutation (consistent snapshot under the active-cart lock). */
  async itemsForUpdate(tx: TxContext, cartId: string): Promise<CartItemRow[]> {
    const r = await tx.query<CartItemRow>(`SELECT id, listing_id, quantity, added_price_minor FROM cart_items WHERE cart_id=$1 FOR UPDATE`, [cartId]);
    return r.rows;
  }
  /** Replica read of a cart's lines (bounded). `tenantId` sets the RLS context for the reachable cart. */
  async listByCart(tenantId: string, cartId: string): Promise<CartItemRow[]> {
    const r = await this.replica.forTenant(tenantId).query<CartItemRow>(
      `SELECT id, listing_id, quantity, added_price_minor FROM cart_items WHERE cart_id=$1 ORDER BY id LIMIT ${MAX_ITEMS}`, [cartId]);
    return r.rows;
  }
  async count(tenantId: string, cartId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query<{ n: string }>(`SELECT count(*)::text n FROM cart_items WHERE cart_id=$1`, [cartId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}
