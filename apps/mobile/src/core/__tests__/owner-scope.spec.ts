// apps/mobile/src/core/__tests__/owner-scope.spec.ts · PC-56 HOTFIX-8 · D2 (founder Q11, survey STORE-6 F-2 / B11) — THE OFFLINE QUEUE IS
// OWNER-SCOPED; ANOTHER PERSON'S OPS ARE HELD UNSEEN. On a shared phone, farmer A queues a listing in a dead zone, signs out, and farmer B
// signs in: A's listing must never be created as B, never shown to B, never dead-lettered for being A's — and it is sent when A signs in
// again. Pure (an in-memory KV; core/api/offline-queue.ts + core/offline/owner.ts). Mutant M4 (`flush` replays every owner's ops) turns
// this red.
import { OfflineQueue, MAX_AGE_MS, QueueOwnerRequiredError, isOwner, ownedBy, type KvPort, type QueuedOp } from '../api/offline-queue';
import { ownerOfAccessToken, decodeBase64Url } from '../offline/owner';

function memKv(): KvPort & { raw: Map<string, string> } {
  const m = new Map<string, string>();
  return { raw: m, get: async (k) => (m.has(k) ? m.get(k)! : null), set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } };
}
const NOW = Date.UTC(2026, 9, 17, 6, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const A = { ownerId: 'user-a', tenantId: 'tenant-t' };
const B = { ownerId: 'user-b', tenantId: 'tenant-t' };
const A_OTHER_ORG = { ownerId: 'user-a', tenantId: 'tenant-u' };
const q = (o: { ownerId: string; tenantId: string | null }, n: string, at = NOW - 60_000) =>
  ({ type: 'listing.create', payload: { title: n }, idempotencyKey: `idem-${n}`, id: `idem-${n}`, now: at, ...o });
const titles = (ops: QueuedOp[]) => ops.map((o) => (o.payload as { title: string }).title);
const recorder = () => { const seen: Array<{ title: string; owner?: string; tenant?: string | null }> = []; return { seen, h: async (o: QueuedOp) => { seen.push({ title: (o.payload as { title: string }).title, owner: o.ownerId, tenant: o.tenantId }); return 'ok' as const; } }; };

describe('HOTFIX-8 · D2 · the offline queue is owner-scoped', () => {
  it('enqueue stamps the owner and the organisation; signed out (anon / empty) is REFUSED — a signed-out person cannot queue', async () => {
    const queue = new OfflineQueue(memKv());
    const op = await queue.enqueue(q(A, 'a1'));
    expect(op).toMatchObject({ ownerId: 'user-a', tenantId: 'tenant-t', attempts: 0 });
    await expect(queue.enqueue(q({ ownerId: 'anon', tenantId: null }, 'x'))).rejects.toBeInstanceOf(QueueOwnerRequiredError);
    await expect(queue.enqueue(q({ ownerId: '', tenantId: null }, 'y'))).rejects.toMatchObject({ code: 'QUEUE_OWNER_REQUIRED' });
    expect(isOwner('anon')).toBe(false); expect(isOwner('user-a')).toBe(true);
  });

  it('two owners interleaved: A\'s flush replays ONLY A\'s ops, in A\'s order; B\'s stay in place, untouched; then B\'s flush sends B\'s', async () => {
    const kv = memKv(); const queue = new OfflineQueue(kv);
    await queue.enqueue(q(A, 'a1')); await queue.enqueue(q(B, 'b1')); await queue.enqueue(q(A, 'a2')); await queue.enqueue(q(B, 'b2'));
    const ra = recorder();
    const resA = await queue.flush({ ...A, now: NOW }, ra.h);
    expect(ra.seen.map((s) => s.title)).toEqual(['a1', 'a2']);
    expect(ra.seen.every((s) => s.owner === 'user-a')).toBe(true);
    expect(resA).toEqual({ sent: 2, dead: 0, remaining: 0 });
    expect(titles(await queue.pending(B))).toEqual(['b1', 'b2']);
    expect((await queue.pending(B)).every((o) => o.attempts === 0)).toBe(true);   // never attempted under A
    const rb = recorder();
    expect(await queue.flush({ ...B, now: NOW }, rb.h)).toEqual({ sent: 2, dead: 0, remaining: 0 });
    expect(rb.seen.map((s) => s.title)).toEqual(['b1', 'b2']);
  });

  it('the same key from two people is two ops (dedupe is per owner); the counts and lists answer ONE owner', async () => {
    const queue = new OfflineQueue(memKv());
    await queue.enqueue({ ...q(A, 'same'), idempotencyKey: 'k' }); await queue.enqueue({ ...q(B, 'same-b'), idempotencyKey: 'k' });
    await queue.enqueue({ ...q(A, 'same-again'), idempotencyKey: 'k' });      // A's double-tap → deduped
    expect(await queue.size(A)).toBe(1); expect(await queue.size(B)).toBe(1);
    expect(titles(await queue.pending(A))).toEqual(['same']);
    expect(await queue.size({ ownerId: 'user-c', tenantId: 'tenant-t' })).toBe(0);
  });

  it('sign-out HOLDS: with nobody signed in nothing replays and nothing is shown; A signs in again → A\'s op is sent', async () => {
    const queue = new OfflineQueue(memKv());
    await queue.enqueue(q(A, 'a1'));
    const r = recorder();
    expect(await queue.flush({ ownerId: 'anon', tenantId: null, now: NOW }, r.h)).toEqual({ sent: 0, dead: 0, remaining: 0 });
    expect(r.seen).toEqual([]);
    expect(await queue.size({ ownerId: 'anon', tenantId: null })).toBe(0);
    expect(await queue.size(A)).toBe(1);                                        // still there, for A
    expect((await queue.flush({ ...A, now: NOW }, r.h)).sent).toBe(1);
    expect(r.seen.map((s) => s.title)).toEqual(['a1']);
  });

  it('the other owner\'s ops never flush, never show, never dead-letter — even when the flushing owner\'s handler fails every op', async () => {
    const queue = new OfflineQueue(memKv(), 2);
    await queue.enqueue(q(A, 'a1')); await queue.enqueue(q(B, 'b1'));
    const dropped: string[] = [];
    await queue.flush({ ...B, now: NOW }, async () => 'permanent-fail', (o) => dropped.push(o.ownerId ?? '?'));
    expect(dropped).toEqual(['user-b']);
    expect(titles(await queue.dead(B))).toEqual(['b1']);
    expect(await queue.dead(A)).toEqual([]);                                    // A's dead letters are A's only — and A has none
    expect(titles(await queue.pending(A))).toEqual(['a1']);
    expect((await queue.pending(A))[0].attempts).toBe(0);
    await queue.flush({ ...B, now: NOW }, async () => 'retry'); await queue.flush({ ...B, now: NOW }, async () => 'retry');
    expect(titles(await queue.pending(A))).toEqual(['a1']);                     // B's retries never touch A's op
  });

  it('the same person in ANOTHER organisation is another owner: held until the session is that organisation again', async () => {
    const queue = new OfflineQueue(memKv());
    await queue.enqueue(q(A, 'a-in-t'));
    const r = recorder();
    expect((await queue.flush({ ...A_OTHER_ORG, now: NOW }, r.h)).sent).toBe(0);
    expect(r.seen).toEqual([]);
    expect((await queue.flush({ ...A, now: NOW }, r.h)).sent).toBe(1);
    expect(ownedBy({ id: '1', type: 't', payload: null, idempotencyKey: 'k', createdAt: 0, attempts: 0, ownerId: 'user-a', tenantId: 'tenant-t' }, A_OTHER_ORG)).toBe(false);
  });

  it('expiry: an op older than 30 days is dropped at ITS OWNER\'s flush with onDropped(op, "expired") — never sent, never dead-lettered; another owner\'s old op is not touched by A', async () => {
    expect(MAX_AGE_MS).toBe(30 * DAY);
    const queue = new OfflineQueue(memKv());
    await queue.enqueue(q(A, 'a-old', NOW - 31 * DAY)); await queue.enqueue(q(A, 'a-fresh', NOW - 29 * DAY)); await queue.enqueue(q(B, 'b-old', NOW - 40 * DAY));
    const r = recorder(); const dropped: Array<[string, string]> = [];
    const res = await queue.flush({ ...A, now: NOW }, r.h, (o, reason) => dropped.push([(o.payload as { title: string }).title, reason]));
    expect(r.seen.map((s) => s.title)).toEqual(['a-fresh']);
    expect(dropped).toEqual([['a-old', 'expired']]);
    expect(res).toEqual({ sent: 1, dead: 0, remaining: 0 });
    expect(await queue.dead(A)).toEqual([]);
    expect(titles(await queue.pending(B))).toEqual(['b-old']);                  // B is told about B's, at B's flush
    const toB: Array<[string, string]> = [];
    await queue.flush({ ...B, now: NOW }, r.h, (o, reason) => toB.push([(o.payload as { title: string }).title, reason]));
    expect(toB).toEqual([['b-old', 'expired']]);
    expect(r.seen.map((s) => s.title)).toEqual(['a-fresh']);
  });

  it('pre-HOTFIX-8 ops (no ownerId) are HELD — never replayed, never shown, never announced — and dropped silently at 30 days', async () => {
    const kv = memKv(); const queue = new OfflineQueue(kv);
    const legacy = (n: string, at: number) => ({ id: n, type: 'listing.create', payload: { title: n }, idempotencyKey: n, createdAt: at, attempts: 0 });
    kv.raw.set('kv.offline.queue', JSON.stringify([legacy('old-unowned', NOW - 31 * DAY), legacy('young-unowned', NOW - DAY)]));
    await queue.enqueue(q(A, 'a1'));
    const r = recorder(); const dropped: string[] = [];
    await queue.flush({ ...A, now: NOW }, r.h, (o) => dropped.push(o.id));
    expect(r.seen.map((s) => s.title)).toEqual(['a1']);
    expect(dropped).toEqual([]);                                                // never announced to whoever is signed in
    expect(await queue.size(A)).toBe(0);
    const stored = JSON.parse(kv.raw.get('kv.offline.queue')!) as QueuedOp[];
    expect(stored.map((o) => o.id)).toEqual(['young-unowned']);                  // held (30-day-old one gone)
    expect(await queue.pending({ ownerId: 'user-b', tenantId: 'tenant-t' })).toEqual([]);
  });

  it('the owner changes MID-FLUSH (sign-out, another sign-in) → the flush stops; a failure answered after the switch dead-letters nothing', async () => {
    const queue = new OfflineQueue(memKv());
    await queue.enqueue(q(A, 'a1')); await queue.enqueue(q(A, 'a2')); await queue.enqueue(q(A, 'a3'));
    let current = 'user-a'; const seen: string[] = [];
    const res = await queue.flush({ ...A, now: NOW, isCurrent: () => current === 'user-a' }, async (o) => {
      seen.push((o.payload as { title: string }).title);
      if (seen.length === 2) { current = 'anon'; return 'permanent-fail'; }   // A signed out while a2 was in flight: a 401 comes back
      return 'ok';
    });
    expect(seen).toEqual(['a1', 'a2']);
    expect(res).toEqual({ sent: 1, dead: 0, remaining: 2 });
    expect(await queue.dead(A)).toEqual([]);
    expect(titles(await queue.pending(A))).toEqual(['a2', 'a3']);
  });

  it('the session\'s owner comes from its access token (sub + tid), Hermes-safe; malformed → null', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
    expect(ownerOfAccessToken(`h.${b64({ sub: 'user-a', tid: 'tenant-t', roles: ['farmer'] })}.s`)).toEqual({ userId: 'user-a', tenantId: 'tenant-t' });
    expect(ownerOfAccessToken(`h.${b64({ sub: 'user-a' })}.s`)).toEqual({ userId: 'user-a', tenantId: null });
    expect(ownerOfAccessToken(`h.${b64({ sub: 'anon' })}.s`)).toBeNull();
    expect(ownerOfAccessToken('garbage')).toBeNull(); expect(ownerOfAccessToken(undefined)).toBeNull(); expect(ownerOfAccessToken('h.!!!.s')).toBeNull();
    expect(decodeBase64Url(Buffer.from('नमस्ते ✓', 'utf8').toString('base64url'))).toBe('नमस्ते ✓');
  });
});
