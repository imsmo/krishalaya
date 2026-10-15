// modules/orders/domain/order-no.ts · PC-56 HOTFIX-5 · B2 (survey F-6 / C-3) — ONE ORDER NUMBER, FROM THE RANDOM BITS.
//
// HOTFIX-4 fixed the checkout's order number (the uuidv7 TIMESTAMP prefix `id.slice(0, 8)` is constant for ~65 s, and the unique index is
// `(tenant_id, order_no, created_at)` — 0005:285), but the auction, offer and quote orders kept their own copies of the old rule. The close
// sweep settles every due auction of a tick with ONE `now`, so two auctions of one organisation ending together produced the same
// `KV<year>-<8 hex>`: the second settlement rolled back, was counted `failed`, and retried every tick — the winner never told, the lot left
// `ended`. One helper now, used by every door that writes an order: the LAST 8 hex of the v7 id are its random bits (core/database/uuid.util).
/** `KV<year>-<last 8 hex of the id>` — upper-case. The year is the placement instant's UTC year. */
export function orderNoFor(orderId: string, now: Date = new Date()): string {
  return `KV${now.getUTCFullYear()}-${orderId.replace(/-/g, '').slice(-8).toUpperCase()}`;
}
