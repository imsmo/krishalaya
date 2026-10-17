// apps/web-storefront/src/lib/worker-switch.ts · PC-56 STORE-6a · D4 (Law 10) — is the storefront's service worker switched ON?
// `storefront_pwa` is PLATFORM-scoped (one worker per origin serves every path store), so it is read through the public flags endpoint with no
// tenant. The read FAILS OPEN, as the API's own answer does (FAIL_OPEN_FLAGS): an API or flag-store outage must never make `/sw.js` serve the
// self-unregistering worker to every phone. The answer is held for 30 s in this instance (the browser asks on every navigation's update check).
// (A module of its own: a route file may export only Next's names.)
import 'server-only';
import { publicClient } from './api-client';

const HOLD_MS = 30_000;
let held: { on: boolean; until: number } | null = null;

/** `storefront_pwa` from the platform answer; absent, unreadable or failing → ON (fail open). */
export async function workerSwitchedOn(now: number = Date.now()): Promise<boolean> {
  if (held && held.until > now) return held.on;
  let on = true;
  try { on = (await publicClient().storefront.flags()).storefront_pwa !== false; } catch { on = true; }
  held = { on, until: now + HOLD_MS };
  return on;
}
/** Tests: forget the held answer. */
export function forgetWorkerSwitch(): void { held = null; }
