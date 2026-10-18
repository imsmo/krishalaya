// apps/web-partner/src/features/partner1/readiness.ts · PC-56 PARTNER-1b · founder D3 — THE READINESS PAGE'S SIX FACTS, as rows. PURE.
// The server answers six facts (`GET /v1/partner/readiness`); this turns each into one row: ready or not, the words, the figures the words
// carry. A fact that is not ready is "with the platform's partner operations" — the page prints the partners mailbox beside it. Nothing is
// ticked, stored or promised here.
import type { PartnerReadiness } from '@krishalaya/sdk-js';

export type ReadinessFactId = 'organisation' | 'administrators' | 'keys' | 'endpoints' | 'deliveries' | 'sla';
export interface ReadinessRow { id: ReadinessFactId; ready: boolean; key: string; vars: Record<string, string | number> }

export const READINESS_FACTS: readonly ReadinessFactId[] = Object.freeze(['organisation', 'administrators', 'keys', 'endpoints', 'deliveries', 'sla']);

/** The six rows, in the page's order. `lastDelivered` is the formatted last delivery time (or ''), computed by the caller in India time. */
export function readinessRows(r: PartnerReadiness, lastDelivered = ''): ReadinessRow[] {
  const row = (id: ReadinessFactId, ready: boolean, vars: Record<string, string | number> = {}): ReadinessRow =>
    ({ id, ready, key: `partner1.readiness.${id}.${ready ? 'yes' : 'no'}`, vars });
  return [
    row('organisation', r.organisation.ready),
    row('administrators', r.administrators.ready, { count: r.administrators.count, withTwoFactor: r.administrators.withTwoFactor }),
    row('keys', r.keys.ready, { count: r.keys.active }),
    row('endpoints', r.endpoints.ready, { count: r.endpoints.active }),
    row('deliveries', r.deliveries.ready, { days: r.deliveries.windowDays, time: lastDelivered }),
    row('sla', r.sla.ready, { hours: r.sla.decisionHours ?? '' }),
  ];
}
/** How many of the six are set up. */
export const readyCount = (rows: readonly ReadinessRow[]) => rows.filter((x) => x.ready).length;
