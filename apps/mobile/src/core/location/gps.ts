// apps/mobile/src/core/location/gps.ts · thin, resilient wrapper over expo-location for a ONE-SHOT fix used by
// worker clock-in (P-13). Permission is requested just-in-time (guide §8); a denied permission or a slow/absent
// GPS degrades to null (Law 12) — the caller shows "can't get your location, move to open sky & retry", never a
// crash. We bound the wait (no hung UI thread) and never poll continuously here (battery/data on low-end Android).
// expo-location is imported lazily so the module loads even where the native dep isn't linked (tests/web).
import type { GeoFix } from './geofence';

const FIX_TIMEOUT_MS = 8_000;

type ExpoLocation = {
  requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
  getCurrentPositionAsync: (opts: { accuracy: number }) => Promise<{ coords: { latitude: number; longitude: number; accuracy: number | null } }>;
  Accuracy: { High: number };
};

function load(): ExpoLocation | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- optional native module, loaded lazily inside try/catch so the app degrades (Law 12) when it is absent
  try { return require('expo-location') as ExpoLocation; } catch { return null; }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('gps_timeout')), ms))]);
}

// Single-shape result (not a discriminated union) so consumers narrow on `ok` without union-member access errors:
// when ok, `fix` is set; when not, `reason` is set.
export interface GpsResult { ok: boolean; fix?: GeoFix; reason?: 'unavailable' | 'denied' | 'timeout' | 'error' }

/** Request permission (JIT) and read a single high-accuracy fix, bounded by a timeout. Never throws. */
export async function getCurrentFix(): Promise<GpsResult> {
  const Location = load();
  if (!Location) return { ok: false, reason: 'unavailable' };
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
    const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), FIX_TIMEOUT_MS);
    return { ok: true, fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy } };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message === 'gps_timeout' ? 'timeout' : 'error' };
  }
}
