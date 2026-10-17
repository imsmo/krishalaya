// Unit tests for the offline write queue. Uses an in-memory KvPort (no AsyncStorage). Covers dedupe by
// idempotency key, sequential replay, transient retry (stops + bumps attempts), permanent-fail dead-lettering,
// and dead-lettering after the attempt cap.
// PC-56 HOTFIX-8 · D2: the queue is OWNER-SCOPED — every op here is enqueued by one owner (A, organisation T) with a creation time just
// before NOW, and every flush / count is asked AS that owner (`flush({ ownerId, tenantId, now }, handler, onDropped)`,
// `size(owner)`, `pending(owner)`, `dead(owner)`); the behaviour for a single owner is exactly what it was. Two owners interleaved,
// sign-out, expiry and the pre-HOTFIX-8 (unowned) ops are __tests__/owner-scope.spec.ts.
import { OfflineQueue, type KvPort, type ReplayResult } from '../api/offline-queue';

function memKv(): KvPort {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    set: async (k, v) => { m.set(k, v); },
    remove: async (k) => { m.delete(k); },
  };
}

const NOW = Date.UTC(2026, 9, 17, 6, 0, 0);
const A = { ownerId: 'user-a', tenantId: 'tenant-t' };
const AT = { ...A, now: NOW };
const op = (i: number) => ({ type: 'listing.create', payload: { i }, idempotencyKey: `idem-${i}`, id: `idem-${i}`, now: NOW - 1000 + i, ...A });

describe('OfflineQueue', () => {
  it('enqueues and dedupes by idempotency key', async () => {
    const q = new OfflineQueue(memKv());
    await q.enqueue(op(1));
    await q.enqueue(op(1)); // same key → no duplicate
    await q.enqueue(op(2));
    expect(await q.size(A)).toBe(2);
  });

  it('flushes all on success, in order', async () => {
    const q = new OfflineQueue(memKv());
    await q.enqueue(op(1)); await q.enqueue(op(2)); await q.enqueue(op(3));
    const seen: number[] = [];
    const res = await q.flush(AT, async (o) => { seen.push((o.payload as { i: number }).i); return 'ok'; });
    expect(res.sent).toBe(3);
    expect(res.remaining).toBe(0);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('stops at the first transient retry and keeps order', async () => {
    const q = new OfflineQueue(memKv());
    await q.enqueue(op(1)); await q.enqueue(op(2));
    const res = await q.flush(AT, async (o) => ((o.payload as { i: number }).i === 1 ? 'retry' : 'ok'));
    expect(res.sent).toBe(0);
    expect(res.remaining).toBe(2);
    const pending = await q.pending(A);
    expect(pending[0].attempts).toBe(1); // attempt bumped, still at head
  });

  it('dead-letters a permanent failure and continues', async () => {
    const q = new OfflineQueue(memKv());
    await q.enqueue(op(1)); await q.enqueue(op(2));
    const res = await q.flush(AT, async (o) => ((o.payload as { i: number }).i === 1 ? 'permanent-fail' : 'ok'));
    expect(res.dead).toBe(1);
    expect(res.sent).toBe(1);
    expect((await q.dead(A)).length).toBe(1);
    expect(await q.size(A)).toBe(0);
  });

  it('dead-letters after exceeding the attempt cap', async () => {
    const q = new OfflineQueue(memKv(), 3); // maxAttempts = 3
    await q.enqueue(op(1));
    const always: ReplayResult = 'retry';
    await q.flush(AT, async () => always); // 1
    await q.flush(AT, async () => always); // 2
    const res = await q.flush(AT, async () => always); // 3 → dead-letter
    expect(res.dead).toBe(1);
    expect(await q.size(A)).toBe(0);
    expect((await q.dead(A)).length).toBe(1);
  });

  it('treats a thrown handler as transient', async () => {
    const q = new OfflineQueue(memKv());
    await q.enqueue(op(1));
    const res = await q.flush(AT, async () => { throw new Error('network'); });
    expect(res.remaining).toBe(1);
  });

  // KV-MF-02: a poison op (one that will fail identically forever — a real 4xx/5xx, not a connectivity blip)
  // must (a) drop on the FIRST 'permanent-fail', not linger, and (b) tell the app via `onDropped` so the farmer
  // can be told, instead of the item just vanishing into the dead-letter list unannounced.
  describe('onDropped notification (poison-op handling)', () => {
    it('fires once, with reason "permanent-fail", for an immediate non-network failure', async () => {
      const q = new OfflineQueue(memKv());
      await q.enqueue(op(1)); await q.enqueue(op(2));
      const dropped: Array<{ id: string; reason: string }> = [];
      const res = await q.flush(
        AT,
        async (o) => ((o.payload as { i: number }).i === 1 ? 'permanent-fail' : 'ok'),
        (o, reason) => dropped.push({ id: o.id, reason }),
      );
      expect(res.dead).toBe(1);
      expect(dropped).toEqual([{ id: 'idem-1', reason: 'permanent-fail' }]);
    });

    it('fires with reason "attempt-cap" once a transient-looking op exhausts maxAttempts', async () => {
      const q = new OfflineQueue(memKv(), 2); // maxAttempts = 2
      await q.enqueue(op(1));
      const dropped: Array<{ reason: string }> = [];
      await q.flush(AT, async () => 'retry', (_o, reason) => dropped.push({ reason })); // attempt 1
      await q.flush(AT, async () => 'retry', (_o, reason) => dropped.push({ reason })); // attempt 2 → cap
      expect(dropped).toEqual([{ reason: 'attempt-cap' }]);
    });

    it('never fires for a plain successful flush', async () => {
      const q = new OfflineQueue(memKv());
      await q.enqueue(op(1));
      const dropped: unknown[] = [];
      await q.flush(AT, async () => 'ok', (o, reason) => dropped.push({ o, reason }));
      expect(dropped).toEqual([]);
    });

    it('a throwing onDropped listener never breaks the drain (defensive — Law 12)', async () => {
      const q = new OfflineQueue(memKv());
      await q.enqueue(op(1)); await q.enqueue(op(2));
      const res = await q.flush(AT, async () => 'permanent-fail', () => { throw new Error('listener bug'); });
      expect(res.dead).toBe(2);
      expect(await q.size(A)).toBe(0);
    });
  });
});
