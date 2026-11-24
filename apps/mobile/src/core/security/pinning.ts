// apps/mobile/src/core/security/pinning.ts · PURE TLS pin validators (guide §4). WHAT is pinned lives in tls-pins.ts (CA-level
// SPKI pins: Amazon Trust Services roots + Starfield Services G2, the app's own API host only, preview/production builds only,
// expiring 2028-05-31); tls-pinning.runtime.ts installs them in the native stack via react-native-ssl-public-key-pinning
// (OkHttp CertificatePinner on Android, TrustKit on iOS). Nothing is configured in app.config / Info.plist / a pin-set, and no
// pins come from env. These helpers are the format checks the builder and its CI test use. docs/mobile/TLS-PINNING.md.

export interface HostPins { host: string; pins: string[]; includeSubdomains?: boolean }

/** A base64 SHA-256 SPKI pin: 44 chars ending in '=' (32 bytes → base64). Plain check, no ReDoS. */
const PIN_RE = /^[A-Za-z0-9+/]{43}=$/;
export function isValidPin(pin: string): boolean { return PIN_RE.test((pin ?? '').trim()); }

/** A pin set is valid for production iff: a host, ≥2 pins (primary + backup for rotation), all well-formed. */
export function isValidHostPins(hp: HostPins | null | undefined): boolean {
  if (!hp || !hp.host || !Array.isArray(hp.pins)) return false;
  if (hp.pins.length < 2) return false; // primary + backup (rotation) — §4
  return hp.pins.every(isValidPin) && new Set(hp.pins).size === hp.pins.length;
}

/** Extract the host of a URL (lowercased, no port) — for matching a request against the pin set. Null if bad. */
export function hostOf(url: string): string | null {
  const m = /^https:\/\/([^/:?#]+)/i.exec((url ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** Whether a URL's host is covered by a pin set (exact host, or a subdomain when includeSubdomains). */
export function isPinnedHost(url: string, pinsList: HostPins[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return pinsList.some((hp) => host === hp.host.toLowerCase() || (!!hp.includeSubdomains && host.endsWith(`.${hp.host.toLowerCase()}`)));
}

/** Gate used at build/CI time: the prod pin config must be non-empty AND every entry valid. */
export function pinConfigReady(pinsList: HostPins[]): boolean {
  return Array.isArray(pinsList) && pinsList.length > 0 && pinsList.every(isValidHostPins);
}
