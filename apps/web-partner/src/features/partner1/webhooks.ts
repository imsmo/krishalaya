// apps/web-partner/src/features/partner1/webhooks.ts · PC-56 PARTNER-1b · founder D2 — THE PARTNER'S ENDPOINTS AND DELIVERIES, the pure pieces. PURE.
//   • a delivery state → its words (the rail's own vocabulary, `WEBHOOK_CONTRACT.deliveryStates`, parity-pinned to `DELIVERY_STATES`);
//   • the deliveries list's query (state filter from the rail's states only, endpoint id, keyset cursor) and the detail id (`?delivery=`);
//   • the contract block's words come from the constants — no figure is typed into a sentence.
import { WEBHOOK_CONTRACT } from './webhook-contract';

export const deliveryStateKey = (state: string) => ((WEBHOOK_CONTRACT.deliveryStates as readonly string[]).includes(state) ? `partner1.hooks.state.${state}` : 'partner1.hooks.state.unknown');
export const isDeliveryState = (v: unknown): v is string => typeof v === 'string' && (WEBHOOK_CONTRACT.deliveryStates as readonly string[]).includes(v);

type SP = Record<string, string | string[] | undefined> | undefined;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The deliveries list's filters, read defensively from the query: anything unknown is dropped (never echoed to the API). */
export function deliveriesQuery(sp: SP): { state?: string; endpointId?: string; cursor?: string } {
  const state = one(sp?.state); const ep = one(sp?.endpoint); const cursor = one(sp?.cursor);
  return {
    ...(isDeliveryState(state) ? { state } : {}),
    ...(ep && UUID.test(ep) ? { endpointId: ep } : {}),
    ...(cursor && /^[A-Za-z0-9_-]{8,200}$/.test(cursor) ? { cursor } : {}),
  };
}
/** The delivery detail's id (`/account/webhooks?delivery=<uuid>`), or null. */
export function deliveryParam(sp: SP): string | null {
  const v = one(sp?.delivery);
  return v && UUID.test(v) ? v : null;
}
/** The link of a deliveries page with one filter changed (the others kept; the cursor reset). */
export function deliveriesHref(q: { state?: string; endpointId?: string }, change: { state?: string | null; endpointId?: string | null; cursor?: string | null }): string {
  const state = change.state === null ? undefined : change.state ?? q.state;
  const ep = change.endpointId === null ? undefined : change.endpointId ?? q.endpointId;
  const p = new URLSearchParams();
  if (state) p.set('state', state);
  if (ep) p.set('endpoint', ep);
  if (change.cursor) p.set('cursor', change.cursor);
  const s = p.toString();
  return s ? `/account/webhooks?${s}#deliveries` : '/account/webhooks#deliveries';
}
/** Bytes → whole KiB text ("64") — integer arithmetic. */
export const kib = (bytes: number) => String(Math.floor(bytes / 1024));
