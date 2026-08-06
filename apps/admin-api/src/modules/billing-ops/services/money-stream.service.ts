// apps/admin-api/src/modules/billing-ops/services/money-stream.service.ts · the LIVE money stream behind canon W112
// (PC-56 ADMIN-1e, closes ADMIN-1-Q8).
//
// THE TRANSPORT DECISION, WRITTEN DOWN BECAUSE IT IS THE WHOLE WAVE.
// The monorepo already has a real push rail: `apps/realtime-gateway` (WebSockets, Redis Pub/Sub, per-socket auth,
// backpressure, replay). It was the obvious candidate and it is the WRONG one here, for one reason: its channels are
// TENANT-SCOPED (`t:{tenant}:…`) and it authenticates sockets with the tenant API's access JWT. A platform revenue
// stream is cross-tenant and admin-only, so using it would mean teaching a tenant-facing gateway to verify ADMIN
// tokens and to carry a channel no tenant may ever read. A bug in that authorization leaks every tenant's money data
// to a tenant socket. admin-api exists as a separate security realm precisely so that class of mistake is impossible;
// spending that isolation on a ticker would be a bad trade.
//
// So the stream is SERVER-SENT EVENTS from admin-api itself: same realm, same JWT issuer, same IP allowlist, no new
// dependency, no change to the tenant rail. SSE is one-way (server → browser), which is exactly the shape of a ticker.
//
// AND IT IS A CURSOR STREAM, NOT A POLLED ROLLUP. This is the distinction ADMIN-1d refused to blur:
//   • a polled rollup re-reads one number on a timer — it looks live, it is stale by up to the interval, and two
//     payments between polls COLLAPSE into a single changed figure, so events are silently lost;
//   • this reads events AFTER a cursor of (created_at, id). Every event is delivered exactly once, in order, and a
//     reconnect resumes from the client's last id. Nothing is missed, and the console can say how far behind it is.
// The server still asks the database on an interval — that is unavoidable without a message bus in this realm — but
// the interval bounds LATENCY, never completeness, and the payload says what the interval is so the UI can be honest.
import { Injectable } from '@nestjs/common';
import { Observable, concat, defer, interval, of } from 'rxjs';
import { concatMap, map, takeWhile } from 'rxjs/operators';
import { BillingRepository } from '../repositories/billing.repository';

/** How often the server looks for new events. Two seconds is a ticker; anything faster is a load test against our own
 *  primary for no human benefit. Stated in the first frame so the UI can display the real latency bound. */
export const STREAM_POLL_MS = 2000;
/** Events per frame. A burst (a billing run issuing 500 invoices) is delivered over several frames rather than one
 *  enormous message that a slow consumer cannot drain. */
export const STREAM_BATCH = 50;
/** Hard lifetime per connection. SSE connections are cheap but not free, and a tab left open for a week holding a
 *  database-polling loop is a leak with a friendly face. The client reconnects with its cursor — no events are lost. */
export const STREAM_MAX_FRAMES = 1800;   // 1800 × 2s = one hour

export interface MoneyEventFrame {
  type: 'hello' | 'events' | 'heartbeat';
  pollMs?: number;
  cursor?: { at: string; id: string } | null;
  events?: Array<Record<string, unknown>>;
}

@Injectable()
export class MoneyStreamService {
  constructor(private readonly repo: BillingRepository) {}

  /**
   * The event stream. Emits:
   *   • one `hello` frame stating the poll interval (so the UI never has to guess its own staleness bound);
   *   • `events` frames carrying new money events after the cursor;
   *   • `heartbeat` frames when nothing happened — which is what lets the browser distinguish "quiet" from "the
   *     connection died", the single most important thing a live screen must get right.
   *
   * `from` lets a reconnecting client resume: it is the last event id + timestamp it actually rendered.
   */
  stream(from: { at: string; id: string } | null): Observable<MoneyEventFrame> {
    let cursor = from;
    let frames = 0;

    const hello: Observable<MoneyEventFrame> = of({ type: 'hello', pollMs: STREAM_POLL_MS, cursor });

    const ticks: Observable<MoneyEventFrame> = interval(STREAM_POLL_MS).pipe(
      takeWhile(() => frames < STREAM_MAX_FRAMES),
      concatMap(() => defer(async () => {
        frames += 1;
        const events = await this.repo.moneyEventsSince(cursor, STREAM_BATCH);
        if (events.length === 0) {
          // A heartbeat is not filler: without it a silent hour is indistinguishable from a dead socket, and the
          // operator would trust a screen that had stopped updating.
          return { type: 'heartbeat' as const, cursor };
        }
        const last = events[events.length - 1];
        cursor = { at: last.at, id: last.id };
        return { type: 'events' as const, cursor, events };
      })),
      map((f) => f as MoneyEventFrame),
    );

    return concat(hello, ticks);
  }

  /** Today's per-hour buckets (the chart beside the feed). A plain read — the feed carries the live part. */
  async todayByHour(currency: string, tzOffsetMinutes: number) {
    const rows = await this.repo.todayByHour(currency, tzOffsetMinutes);
    return { currency, tzOffsetMinutes, hours: rows };
  }
}
