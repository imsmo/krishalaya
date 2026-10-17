// apps/mobile/src/core/api/offline-queue.ts · the offline-first write queue. On a flaky/absent network, a farmer's seller writes are
// ENQUEUED durably and replayed in order when connectivity returns — the farmer never loses work mid-field (the core Phase-1 promise).
// (PC-56 HOTFIX-8 — survey STORE-6 C-5: exactly two op types queue today, `listing.create` and `media.upload`; NO bid and no money act
// ever queues — money never queues.) Design notes:
//   • Each op carries a stable idempotency key so a replay can never double-apply server-side (Law 3).
//   • Storage is INJECTED (a tiny get/set/remove KV port), so this class is 100% framework-free and unit-tested
//     (see __tests__/offline-queue.spec.ts and __tests__/owner-scope.spec.ts). The app wires it to AsyncStorage; tests an in-memory map.
//   • Replay is sequential and stops on the first transient failure (keeps order; avoids hammering a down API).
//     A permanent failure (a handler-classified 'permanent-fail' — a real, non-network error that will never
//     resolve on its own, e.g. a validation/4xx or a genuine server bug) drops the op to a dead-letter list
//     immediately, on the FIRST failed attempt — a poison op is never retried "just in case".
//   • Bounded: a max attempt count per op; the queue never grows unboundedly from one failing op.
//   • CLASSIFICATION IS THE HANDLER'S JOB, NOT THE QUEUE'S: a handler must return 'retry' ONLY for TRUE
//     connectivity failures (SdkNetworkError/SdkTimeoutError) — never for a real server response (any status),
//     which must be 'permanent-fail' instead. Getting this wrong is exactly the S6 device bug (KV-MF-02): a real
//     4xx/5xx got queued and misreported to the farmer as "offline", then retried forever because it can never
//     succeed. `onDropped` (below) lets the app surface that loss instead of it vanishing silently.
//
// PC-56 HOTFIX-8 · D2 (founder Q11, survey F-2 / B11) — THE QUEUE IS OWNER-SCOPED. A shared phone is normal: before this, one global queue
// held ops with no person on them, and the replay used whoever was signed in — farmer A's queued listing (produce, place, photos) was
// created in farmer B's account and organisation, and A's dead letters were shown to B. Now:
//   • every op is stamped `ownerId` (the signed-in user id — the cache scope) and `tenantId` (the session's organisation) at enqueue;
//     enqueueing with no owner (signed out, 'anon') is REFUSED — a signed-out person cannot queue;
//   • `flush` replays ONLY the given owner's ops (same person AND same organisation) and leaves every other op exactly where it is —
//     never replayed, never dead-lettered, never counted for someone else; it stops at once if the owner changes mid-flush;
//   • `pending` / `dead` / `size` answer ONE owner's ops (the counts and the dead-letter list never show another person's);
//   • sign-out does not clear the queue (a farmer who signs out in the field keeps their listing) — with nobody signed in nothing replays;
//   • an op older than MAX_AGE_MS (30 days) is dropped at its OWNER's next flush with `onDropped(op, 'expired')` (never sent; past the
//     API's 24-hour key memory a replay would act afresh — the API's B12 makes that deterministic, but a month-old listing is not sent);
//   • ops stored BEFORE this change carry no `ownerId`: an unowned op can never be attributed safely, so it is HELD (never replayed, never
//     shown, never announced to whoever is signed in) and dropped silently once it is 30 days old.

export interface QueuedOp<P = unknown> {
  id: string;
  type: string;              // e.g. 'listing.create' — the app maps this to a handler
  payload: P;
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
  /** HOTFIX-8: the signed-in user id that queued it. Absent only on an op stored before HOTFIX-8 (held, never replayed). */
  ownerId?: string;
  /** HOTFIX-8: the organisation (tenant id) the session belonged to; null when the session named none. */
  tenantId?: string | null;
}

export interface KvPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Outcome of attempting one op. `retry` keeps it queued; `permanent-fail` dead-letters it; `ok` removes it. */
export type ReplayResult = 'ok' | 'retry' | 'permanent-fail';
export type OpHandler = (op: QueuedOp) => Promise<ReplayResult>;
/** Why an op left the queue without succeeding. HOTFIX-8 adds 'expired' (older than MAX_AGE_MS, dropped unsent at its owner's flush). */
export type DropReason = 'permanent-fail' | 'attempt-cap' | 'expired';

/** HOTFIX-8: who is asking — the signed-in person and the session's organisation. */
export interface QueueOwner { ownerId: string; tenantId?: string | null }

/** HOTFIX-8: enqueue refused — nobody (or 'anon') is signed in. */
export class QueueOwnerRequiredError extends Error {
  readonly code = 'QUEUE_OWNER_REQUIRED';
  constructor() { super('QUEUE_OWNER_REQUIRED'); this.name = 'QueueOwnerRequiredError'; }
}

const QUEUE_KEY = 'kv.offline.queue';
const DEAD_KEY = 'kv.offline.dead';
const MAX_ATTEMPTS = 8;
/** HOTFIX-8 (founder Q11): a queued op older than this is dropped at its owner's next flush ('expired'), never sent. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A real owner: a non-empty id that is not the signed-out scope. */
export function isOwner(ownerId: string | null | undefined): ownerId is string { return typeof ownerId === 'string' && ownerId.length > 0 && ownerId !== 'anon'; }
/** The op belongs to this owner: the same person AND the same organisation. An unowned (pre-HOTFIX-8) op belongs to nobody. */
export function ownedBy(op: QueuedOp, owner: QueueOwner): boolean {
  return isOwner(op.ownerId) && op.ownerId === owner.ownerId && (op.tenantId ?? null) === (owner.tenantId ?? null);
}

export class OfflineQueue {
  constructor(private readonly kv: KvPort, private readonly maxAttempts = MAX_ATTEMPTS, private readonly maxAgeMs = MAX_AGE_MS) {}

  private async read(key: string): Promise<QueuedOp[]> {
    const raw = await this.kv.get(key);
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as QueuedOp[]) : []; }
    catch { return []; }   // corrupt store never crashes the app (Law 12)
  }
  private async write(key: string, ops: QueuedOp[]): Promise<void> { await this.kv.set(key, JSON.stringify(ops)); }

  /** Append an op, stamped with its owner. Deduped by idempotencyKey (per owner) so a double-tap can't enqueue twice. Refused for 'anon'. */
  async enqueue<P>(input: { type: string; payload: P; idempotencyKey: string; id: string; now: number; ownerId: string; tenantId?: string | null }): Promise<QueuedOp<P>> {
    if (!isOwner(input.ownerId)) throw new QueueOwnerRequiredError();
    const owner: QueueOwner = { ownerId: input.ownerId, tenantId: input.tenantId ?? null };
    const ops = await this.read(QUEUE_KEY);
    const existing = ops.find((o) => o.idempotencyKey === input.idempotencyKey && ownedBy(o, owner));
    if (existing) return existing as QueuedOp<P>;
    const op: QueuedOp<P> = { id: input.id, type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey, createdAt: input.now, attempts: 0, ownerId: owner.ownerId, tenantId: owner.tenantId };
    ops.push(op as QueuedOp);
    await this.write(QUEUE_KEY, ops);
    return op;
  }

  /** The owner's queued ops (in order). Another person's — and an unowned legacy op — are never listed. */
  async pending(owner: QueueOwner): Promise<QueuedOp[]> { return (await this.read(QUEUE_KEY)).filter((o) => ownedBy(o, owner)); }
  /** The owner's dead letters only. */
  async dead(owner: QueueOwner): Promise<QueuedOp[]> { return (await this.read(DEAD_KEY)).filter((o) => ownedBy(o, owner)); }
  async size(owner: QueueOwner): Promise<number> { return (await this.pending(owner)).length; }

  /** Replay THIS OWNER's queued ops in order. Stops at the first 'retry' (transient) to preserve ordering and back off.
   * Returns this owner's counts. Safe to call repeatedly (e.g. on reconnect / app foreground). Another owner's ops are skipped in place.
   * `onDropped` (optional) fires once per op of this owner that leaves the queue WITHOUT succeeding — an immediate
   * 'permanent-fail' (a non-network error the handler already classified as never-succeeding, e.g. a 422/4xx),
   * 'attempt-cap' (a 'retry' op that exhausted maxAttempts, e.g. a server outage that never recovered), or 'expired' (HOTFIX-8: older
   * than MAX_AGE_MS — dropped unsent, not dead-lettered). This is the app's ONE hook to tell the farmer "this saved item could not be
   * sent" instead of silently losing it — a poison op must never just vanish (Law 12: degrade-never-die, loudly).
   * `isCurrent` (optional): asked before each op and after each handler — false (the person signed out / another signed in mid-flush) →
   * stop at once, the remaining ops untouched (an answer that came back after the switch is not trusted to dead-letter anything). */
  async flush(
    owner: QueueOwner & { now?: number; isCurrent?: () => boolean },
    handler: OpHandler,
    onDropped?: (op: QueuedOp, reason: DropReason) => void,
  ): Promise<{ sent: number; dead: number; remaining: number }> {
    if (!isOwner(owner.ownerId)) return { sent: 0, dead: 0, remaining: 0 };   // nobody signed in → nothing replays, nothing shown
    const now = owner.now ?? Date.now();
    const stillOwner = () => (owner.isCurrent ? owner.isCurrent() : true);
    const notify = (op: QueuedOp, reason: DropReason) => { try { onDropped?.(op, reason); } catch { /* notifier must never break the drain */ } };
    let ops = await this.read(QUEUE_KEY);
    // pre-HOTFIX-8 ops (no owner) older than the cap leave silently — never announced to whoever happens to be signed in
    const kept = ops.filter((o) => isOwner(o.ownerId) || now - o.createdAt <= this.maxAgeMs);
    if (kept.length !== ops.length) { ops = kept; await this.write(QUEUE_KEY, ops); }
    let sent = 0; let deadCount = 0;
    let i = 0;
    while (i < ops.length) {
      const op = ops[i];
      if (!ownedBy(op, owner)) { i++; continue; }            // another person's (or an unowned) op: held in place, untouched
      if (!stillOwner()) break;
      if (now - op.createdAt > this.maxAgeMs) {               // older than the cap: dropped unsent, told to its owner
        ops = [...ops.slice(0, i), ...ops.slice(i + 1)];
        await this.write(QUEUE_KEY, ops);
        notify(op, 'expired');
        continue;
      }
      let result: ReplayResult;
      try { result = await handler(op); }
      catch { result = 'retry'; }   // a throw is treated as transient

      if (!stillOwner()) {          // the person changed while this op was in flight
        if (result === 'ok') { ops = [...ops.slice(0, i), ...ops.slice(i + 1)]; sent++; await this.write(QUEUE_KEY, ops); }
        break;
      }
      if (result === 'ok') {
        ops = [...ops.slice(0, i), ...ops.slice(i + 1)]; sent++;
        await this.write(QUEUE_KEY, ops);
        continue;
      }
      if (result === 'permanent-fail') {
        ops = [...ops.slice(0, i), ...ops.slice(i + 1)]; deadCount++;
        await this.write(QUEUE_KEY, ops);
        const dead = await this.read(DEAD_KEY); dead.push(op); await this.write(DEAD_KEY, dead);
        notify(op, 'permanent-fail');
        continue;
      }
      // 'retry' — bump attempts; dead-letter if over the cap; otherwise stop and back off.
      const bumped = { ...op, attempts: op.attempts + 1 };
      if (bumped.attempts >= this.maxAttempts) {
        ops = [...ops.slice(0, i), ...ops.slice(i + 1)]; deadCount++;
        await this.write(QUEUE_KEY, ops);
        const dead = await this.read(DEAD_KEY); dead.push(bumped); await this.write(DEAD_KEY, dead);
        notify(bumped, 'attempt-cap');
        continue;
      }
      ops = [...ops.slice(0, i), bumped, ...ops.slice(i + 1)];
      await this.write(QUEUE_KEY, ops);
      break;
    }
    return { sent, dead: deadCount, remaining: ops.filter((o) => ownedBy(o, owner)).length };
  }

  async clear(): Promise<void> { await this.kv.remove(QUEUE_KEY); await this.kv.remove(DEAD_KEY); }
}
