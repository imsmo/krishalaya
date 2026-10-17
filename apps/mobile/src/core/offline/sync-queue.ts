// apps/mobile/src/core/offline/sync-queue.ts · the SINGLE durable offline write queue for the whole app, with a
// handler REGISTRY keyed by op.type. Every feature that enqueues a write (listing.create, media.upload, …)
// registers a replay handler here; `flushQueue()` drains the queue in order, dispatching each op to its handler.
// One queue (not one-per-feature) is required for correct ordering + a single reconnect flush (guide §5/§6).
// An op whose type has no registered handler is treated as transient (waits for the feature to register, then
// the attempt-cap dead-letters it) so a stale op can never silently corrupt another feature.
// `onDroppedOp` lets the app surface a dead-lettered op to the farmer (KV-MF-02: a poison op — one that fails
// for a real, non-network reason — must never just vanish into the dead-letter list unannounced).
// PC-56 HOTFIX-8 · D2 (founder Q11): OWNER-SCOPED. `enqueueOp` stamps the signed-in user id (the cache scope) and the session's
// organisation on every op and REFUSES when nobody is signed in ('anon' → QueueOwnerRequiredError); `flushQueue` replays ONLY the
// signed-in owner's ops (another person's are held unseen until they sign in again — never sent as someone else, never shown, never
// dead-lettered for being someone else's) and stops the moment the owner changes; `pendingCount` / `deadOps` answer the signed-in
// owner's only. An op older than 30 days is dropped at its owner's next flush with the 'expired' reason (core/api/offline-queue.ts).
import { OfflineQueue, QueueOwnerRequiredError, type QueuedOp, type OpHandler, type ReplayResult, type DropReason } from '../api/offline-queue';
import { i18n } from '../i18n/i18n';
import { asyncStorageKv } from './kv';
import { currentScope, currentTenant } from './scope';

const queue = new OfflineQueue(asyncStorageKv);
const handlers = new Map<string, OpHandler>();

/** The signed-in owner right now (the cache scope + the session's organisation). */
const owner = () => ({ ownerId: currentScope(), tenantId: currentTenant() });

/** Register the replay handler for an op type (idempotent; last registration wins). */
export function registerOpHandler(type: string, handler: OpHandler): void { handlers.set(type, handler); }

/** Enqueue a write op for later replay, stamped with the signed-in owner. Deduped by idempotencyKey inside the queue.
 *  Signed out → refused: a signed-out person cannot queue (the error carries `sync.signInToSave` in the person's language — the screens
 *  print `e.message` — and the code QUEUE_OWNER_REQUIRED). */
// (a plain `export function` — DEV-14's money-never-queues guard scans this module's export surface by that shape)
export function enqueueOp(input: { type: string; payload: unknown; idempotencyKey: string; id: string; now: number }) {
  return queue.enqueue({ ...input, ...owner() }).catch((e: unknown) => {
    if (e instanceof QueueOwnerRequiredError) throw Object.assign(new Error(i18n.t('sync.signInToSave')), { code: e.code });
    throw e;
  });
}

const dispatch: OpHandler = async (op: QueuedOp): Promise<ReplayResult> => {
  const h = handlers.get(op.type);
  if (!h) return 'retry'; // handler not registered yet — wait; attempt-cap will dead-letter a truly orphaned op
  return h(op);
};

export type DroppedOpReason = DropReason;
export type DroppedOpListener = (op: QueuedOp, reason: DroppedOpReason) => void;
const droppedListeners = new Set<DroppedOpListener>();

/** Register to hear about an op that left the queue WITHOUT succeeding (dead-lettered, or expired unsent). This is the app's hook
 * for telling the farmer "this saved item could not be sent" (KV-MF-02: a poison op must never just vanish).
 * Returns an unsubscribe function. Safe to register from more than one place (e.g. a screen + a toast host). */
export function onDroppedOp(fn: DroppedOpListener): () => void {
  droppedListeners.add(fn);
  return () => droppedListeners.delete(fn);
}

/** Drain the SIGNED-IN OWNER's ops in order (call on reconnect / app foreground). Safe to call repeatedly. Signed out → nothing.
 * Notifies every registered `onDroppedOp` listener for each of this owner's ops dropped during this pass. */
export function flushQueue() {
  const o = owner();
  return queue.flush(
    { ...o, isCurrent: () => currentScope() === o.ownerId && currentTenant() === o.tenantId },
    dispatch,
    (op, reason) => { for (const fn of droppedListeners) fn(op, reason); },
  );
}

export function pendingCount() { return queue.size(owner()); }
export function deadOps() { return queue.dead(owner()); }
