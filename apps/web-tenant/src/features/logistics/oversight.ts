// apps/web-tenant/src/features/logistics/oversight.ts · PURE helpers for the tenant shipments-oversight surface
// (PC-25). No IO → unit-tested. The status filter offers only the server's shipment states; the pager href
// preserves the active filter while swapping the cursor (mirrors the storefront discovery convention).

export const SHIPMENT_STATUSES = ['pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled'] as const;

export function isShipmentStatus(v: string | undefined | null): boolean {
  return !!v && (SHIPMENT_STATUSES as readonly string[]).includes(v);
}

/** /logistics href carrying the (validated) status filter + cursor. Unknown statuses are dropped, never sent. */
export function oversightHref(status: string | undefined | null, cursor: string | null | undefined): string {
  const qs = new URLSearchParams();
  if (isShipmentStatus(status)) qs.set('status', String(status));
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `/logistics?${s}` : '/logistics';
}
