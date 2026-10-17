// apps/mobile/src/core/offline/sync.engine.ts · drains the durable write queue (OfflineQueue, via sync-queue's
// dispatched flush) at the right moments: when the device transitions offline→online, and when the app returns
// to the foreground. This is how a listing/media op created in a dead-zone replays the moment signal returns —
// with the SAME idempotency keys, so a flush can never double-apply (Law 3). The transition guards are PURE
// (unit-tested); start() wires the NetInfo + AppState listeners and guards against overlapping flushes.
//
// POISON OPS (KV-MF-02): a queued op can be dead-lettered mid-flush (a real, non-network error the handler
// classified as 'permanent-fail', or one that exhausted its retry cap). That must never happen silently — the
// farmer saved something and it's gone. `onDroppedOp` (sync-queue) is the hook; here we surface ONE grouped
// alert per flush pass (not one per item — a bad batch must not spam the farmer with N popups).
// PC-56 HOTFIX-8 · D2: a queued op older than 30 days is dropped unsent at its owner's flush ('expired') — told in its own words
// (`sync.itemExpired`), never as "could not be sent, try again". Only the signed-in owner's ops are flushed (core/offline/sync-queue.ts).
import { AppState, type AppStateStatus, Alert } from 'react-native';
import { startConnectivity, subscribeConnectivity, isOnline } from '../connectivity/connectivity';
import { flushQueue, onDroppedOp } from './sync-queue';
import { shouldFlushOnConnectivity, shouldFlushOnAppState } from './sync-policy';
import { i18n } from '../i18n/i18n';
import { MAX_AGE_MS } from '../api/offline-queue';

const MAX_AGE_DAYS = Math.round(MAX_AGE_MS / (24 * 60 * 60 * 1000));

export { shouldFlushOnConnectivity, shouldFlushOnAppState } from './sync-policy';

let flushing = false;
async function flushOnce(): Promise<void> {
  if (flushing) return;          // guard: never run two flushes concurrently (avoids double-send races)
  flushing = true;
  let dropped = 0; let expired = 0;
  const unsub = onDroppedOp((_op, reason) => { if (reason === 'expired') expired++; else dropped++; });
  try { await flushQueue(); }
  catch { /* queue handles its own retries */ }
  finally {
    unsub();
    flushing = false;
    // One grouped alert for the whole pass — a farmer with 3 poisoned ops sees ONE popup, not three.
    if (dropped > 0) Alert.alert(i18n.t('sync.itemFailed'));
    if (expired > 0) Alert.alert(i18n.t('sync.itemExpired', { days: MAX_AGE_DAYS }));
  }
}

/** Start the sync engine. Returns a stop() cleanup. Call once at app boot. */
export function startSyncEngine(): () => void {
  const stopNet = startConnectivity();
  let prevOnline = isOnline();
  let prevAppState: AppStateStatus = AppState.currentState;

  const unsubConn = subscribeConnectivity(() => {
    const next = isOnline();
    if (shouldFlushOnConnectivity(prevOnline, next)) void flushOnce();
    prevOnline = next;
  });
  const sub = AppState.addEventListener('change', (next) => {
    if (shouldFlushOnAppState(prevAppState, next, isOnline())) void flushOnce();
    prevAppState = next;
  });

  void flushOnce(); // attempt once at boot (best-effort)
  return () => { unsubConn(); sub.remove(); stopNet(); };
}
