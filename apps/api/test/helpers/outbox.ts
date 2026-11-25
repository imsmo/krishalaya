// apps/api/test/helpers/outbox.ts · PC-56 TEST-1.
// `OutboxDispatcher.relayBatch()` relays the ONE cross-tenant FIFO (`outbox_events WHERE status='pending' ORDER BY id`), so a spec
// that drives the relay and asserts on a shared account (the platform escrow, the gateway) also relays every event an EARLIER suite
// left pending — a completed order from another file releases escrow inside this one. That is what made the money suites "order
// movers": green alone, red in a full pass. A spec that drives the relay calls this first, so it relays only its own events —
// exactly what it would see on a fresh database. (Specs should also mark their own leftovers in afterAll; this is the guard for
// the ones that do not.)
import type { Pool } from 'pg';

export async function quarantinePendingOutbox(admin: Pool): Promise<void> {
  await admin.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending'`);
}
