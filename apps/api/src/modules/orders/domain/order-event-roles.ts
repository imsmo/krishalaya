// modules/orders/domain/order-event-roles.ts · PC-56 HOTFIX-5 · B3 (survey F-7; HOTFIX-4 D3 "the organisation only, everywhere") — WHO DID
// IT, SAID AS A ROLE. PURE.
//
// `GET /v1/orders/:id/events` is party-scoped, so the BUYER can call it — and it answered `actorName = users.full_name` and the actor's
// user uuid on every hop (order-console.read-model.ts). The storefront's order page would have printed the farmer's name the moment it used
// the route. ONE read model, two shapes, decided by the CALLER's role on THIS order:
//   • the buyer   → `{ fromStatus, toStatus, actorRole, at }` — `seller` / `buyer` / `system` / `moderator`, never an id, a name or a note;
//   • the seller and staff (the console, W134) → the full row they already had, plus `actorRole`.
export type OrderViewerRole = 'buyer' | 'seller' | 'moderator';
export type OrderActorRole = 'buyer' | 'seller' | 'system' | 'moderator';
export const ORDER_ACTOR_ROLES: readonly OrderActorRole[] = Object.freeze(['buyer', 'seller', 'system', 'moderator'] as OrderActorRole[]);

/** The caller's role on this order. A moderator who is ALSO the buyer reads as staff (the console is theirs); a plain buyer reads as the buyer. */
export function viewerRoleOf(actor: { userId: string; canModerate: boolean }, order: { buyerUserId: string; sellerUserId: string }): OrderViewerRole {
  if (actor.userId === order.sellerUserId) return 'seller';
  if (actor.canModerate) return 'moderator';
  return 'buyer';
}

/** Who acted on one hop: no person (NULL actor — the system's acts are stored with no person, order.repository personOrNull) → `system`;
 *  the order's buyer or seller by id; anyone else (a moderator, a dispute desk) → `moderator`. */
export function actorRoleOf(actorUserId: string | null, order: { buyerUserId: string; sellerUserId: string }): OrderActorRole {
  if (!actorUserId) return 'system';
  if (actorUserId === order.buyerUserId) return 'buyer';
  if (actorUserId === order.sellerUserId) return 'seller';
  return 'moderator';
}

export interface StaffTimelineRow { fromStatus: string | null; toStatus: string; note: string | null; actorUserId: string | null; actorName: string | null; at: string | Date }

/** The buyer's timeline: role labels only. */
export function buyerTimeline(rows: StaffTimelineRow[], order: { buyerUserId: string; sellerUserId: string }) {
  return rows.map((r) => ({ fromStatus: r.fromStatus, toStatus: r.toStatus, actorRole: actorRoleOf(r.actorUserId, order), at: r.at }));
}

/** The seller's / staff's timeline: unchanged, plus the role. */
export function staffTimeline(rows: StaffTimelineRow[], order: { buyerUserId: string; sellerUserId: string }) {
  return rows.map((r) => ({ ...r, actorRole: actorRoleOf(r.actorUserId, order) }));
}
