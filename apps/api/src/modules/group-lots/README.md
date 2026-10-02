# group-lots (FPO pooling · P1-12 · PC-56 TENANT-11c)

A coordinator pools many farmers' produce into one large, sale-ready lot — the PRD §7.7 signature feature. **Founder decision
(2026-10-02): settle pays farmers from the REAL sale, maker ≠ checker.**

## Lifecycle (`group_lots.status`, Law 5 — `domain/group-lot.state.ts`; DB wall `trg_gl_moves`, 0188)
`pledging → ready → listed → sold → settled` (+ `cancelled` from pledging / ready / listed). Every edge has a writer:

| Edge | Writer |
|---|---|
| pledging → ready | automatically when a pledge reaches the target; or by hand (coordinator / tenant_admin) at any %, a reason required below target |
| ready → listed | `POST /:id/list` — ONE listing via `ListingService.createForGroupLotInTx`: seller = the coordinator, quantity = the pledged quantity, min order = the whole lot, `listings.group_lot_id` = the lot. It may then be bought, or auctioned (11a) |
| listed → sold | the `orders.order_completed` consumer (two hops, below) — records the sale and HOLDS the seller net |
| sold → settled | `POST /:id/settle/confirm` by a second person |
| → cancelled | `POST /:id/cancel` with a lookup reason (`target_missed`, `coordinator_withdrew`, `quality`, `other` + text); pledges released, the listing withdrawn, members told in their language |

## Who may act (F-23 — per lot, not role-wide)
- open a lot for oneself: `group_lot.coordinate` (tenant_admin, fpo_coordinator — no longer `ambassador`);
- appoint another member as a lot's coordinator: `group_lot.manage` (tenant_admin) + the appointee's recorded consent (`group_lot_consents`);
- ready / list / extend / nudge / cancel / prepare / pledge FOR a member: THIS lot's coordinator, or `group_lot.manage`;
- pledge as oneself, withdraw one's own pledge until the lot lists, read progress + one's own pledge: any member;
- confirm / refuse a prepared settlement: `group_lot.settle_approve` (tenant_admin), never the preparer or the coordinator (DB trigger `trg_gls_moves`).

## Routes (`/v1/group-lots`, `group_lots` flag) — the ONLY owner (the listings duplicate is deleted, F-3)
`POST /` (Idempotency-Key) · `GET /` (`box`, `status`, `sort=recent|deadline`, `counts=1`, µs cursor) · `GET /lookups` · `GET /:id` ·
`POST /:id/pledges` (Idempotency-Key, `{ farmerUserId?, quantity }`) · `DELETE /:id/pledges/me` · `POST /:id/ready` · `POST /:id/list`
(Idempotency-Key, `{ pricePerUnitMinor }`) · `POST /:id/extend` (once, ≤ 48 h) · `POST /:id/nudge` (once per 24 h) · `POST /:id/cancel` ·
`POST /:id/settle/prepare` · `POST /:id/settle/confirm` (Idempotency-Key) · `POST /:id/settle/refuse`.

## The money (WalletPort only; `domain/group-lot-money.ts`)
| Step | Ledger move | Key · txn type | When |
|---|---|---|---|
| Hold | coordinator Main −gross → coordinator Hold +gross | `gl-hold:<lotId>` · `group_lot_hold` | the sale order completed |
| Settle | coordinator Hold −gross → each pledger's Main +share, coordinator Main +fee | `gl-settle:<lotId>` · `group_lot_settle` | the second person's confirm |

`gross` = what the sale order's settlement paid the coordinator as seller: `settlement_lines.net_minor` + the coupon top-up settled to
the seller for it (TENANT-10b), pro-rated by line total if the order also bought other listings. Never typed. Shares come from
`settleShares` (bigint; fee = round(gross × bps / 10000); the net split by pledged quantity, remainder largest-first; Σ = gross).
The fee cap is ONE value: 2000 bps (20 %), DTO + entity + DB CHECK.

### The sale, in two hops (no kv_relay grant)
1. `orders.order_completed` → `GroupLotOrderCompletedHandler`, inside the relay transaction that also runs payments' settlement:
   reads the order's lines in kv_app's unit of work and ENQUEUES `group_lot.sale_settled` on the relay transaction (so it exists
   only if the seller's settlement commits). It touches no wallet account: the relay transaction holds the seller's Main row lock.
2. `group_lot.sale_settled` → `GroupLotSaleSettledHandler` → `GroupLotService.recordSale` in kv_app's unit of work: the sale record
   and the hold in one transaction; idempotent; a missing settlement line throws so the relay retries.

## Reads (F-19)
A member reads the lot's progress and their own pledge; the coordinator and tenant_admin read every pledge — short name, the 1b
masked phone, the producer role's KYC (9a's projection), pledged at. "Why pooling pays" prints a figure only from ≥ 3 confirmed
pooled sales of the product; the solo estimate is refused by name. The nudge's audience is defined from what the database records:
active members with a crop season of the product on their own parcel, or a past listing of it, and no active pledge.

## Security / invariants
tenant_id in every query + RLS; the four 0188 tables ENABLE + FORCE with the 0175 split and REVOKE ALL from kv_relay; kv_relay
keeps SELECT only on `group_lots`. One ACID tx per write; every act audited with actor · reason · before/after · ip; outbox in-tx.
Quantities are integer milli-units (never a float); money is bigint minor units.
