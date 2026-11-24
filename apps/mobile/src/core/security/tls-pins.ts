// apps/mobile/src/core/security/tls-pins.ts · PC-56 MOB-TLS-1 — WHAT the app pins, and the PURE builder that turns (appEnv,
// API url) into the options handed to react-native-ssl-public-key-pinning (OkHttp CertificatePinner on Android, TrustKit on
// iOS). Pure: no React Native imports, so CI unit-tests every rule. The runtime that installs it is tls-pinning.runtime.ts.
//
// What is pinned: the SPKI (public key) of the CA layer — the Amazon Trust Services roots and the Starfield Services Root G2
// cross-sign — for the app's OWN API host only. Never our leaf: production TLS is an AWS ACM certificate on the ALB, and ACM
// renews it (new key) on its own schedule, so a leaf pin would lock every installed app out at the next renewal. Never a
// third party (Razorpay, Sentry, Expo, Google): they rotate keys without telling us and their SDKs secure themselves.
// Values, sources and the openssl commands that recompute them: docs/mobile/TLS-PINNING.md.

import { isValidPin } from './pinning';

/** The CA-level pins. Each is base64(SHA-256(SubjectPublicKeyInfo DER)) of the PEM published at amazontrust.com/repository. */
export const AMAZON_TRUST_PINS: ReadonlyArray<{ name: string; spki: string }> = Object.freeze([
  // ACM RSA certificates (our default: terraform modules/acm key_algorithm unset = RSA_2048) chain leaf → Amazon RSA 2048 M0x →
  // Amazon Root CA 1. The cross-signed Amazon Root CA 1 (issuer Starfield Services G2) that ALBs send carries the SAME key.
  { name: 'Amazon Root CA 1 (RSA 2048, expires 2038-01-17)', spki: '++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=' },
  { name: 'Amazon Root CA 2 (RSA 4096, expires 2040-05-26)', spki: 'f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=' },
  // ACM ECDSA certificates (EC_prime256v1 / EC_secp384r1) chain to Root CA 3 / Root CA 4.
  { name: 'Amazon Root CA 3 (ECC P-256, expires 2040-05-26)', spki: 'NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=' },
  { name: 'Amazon Root CA 4 (ECC P-384, expires 2040-05-26)', spki: '9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=' },
  // The cross-sign anchor older trust stores build the path to.
  { name: 'Starfield Services Root CA - G2 (RSA 2048, expires 2037-12-31)', spki: 'KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=' },
]);

/** After this UTC date the pins switch themselves OFF and the app falls back to normal system-CA validation — so a phone that
 * never updates fails OPEN instead of being locked out. ~18 months from the 2026-11-24 introduction; reviewed every year and
 * pushed forward in a store release (docs/mobile/TLS-PINNING.md → "Review calendar"). Format yyyy-MM-dd (both native layers). */
export const PIN_EXPIRATION_DATE = '2028-05-31';

/** App environments whose builds enforce pins (eas.json: preview → `staging`; beta + production → `production`). Every other
 * value — `development`, unset, anything unknown — is a dev/local build and never pins. */
export const PINNED_APP_ENVS: ReadonlySet<string> = new Set(['production', 'staging']);

/** Hosts that are NEVER pinned even if a misconfigured build points the API url at them: third parties whose keys we do
 * not control. Suffix match on the hostname. */
export const NEVER_PIN_HOST_SUFFIXES: ReadonlyArray<string> = Object.freeze([
  'razorpay.com', 'sentry.io', 'ingest.sentry.io', 'expo.dev', 'expo.io', 'exp.direct', 'exp.host', 'expo.test',
  'google.com', 'googleapis.com', 'gstatic.com', 'firebaseio.com', 'apple.com', 'icloud.com',
  'amazonaws.com', 'cloudfront.net', // S3 presigned media URLs + raw AWS endpoints: AWS-owned names, not our API
  'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'ngrok.dev', 'loca.lt', 'trycloudflare.com',
]);

export interface DomainPinOptions { includeSubdomains: boolean; publicKeyHashes: string[]; expirationDate: string }
/** Shape accepted by react-native-ssl-public-key-pinning's initializeSslPinning (kept local so this file stays RN-free). */
export type PinningOptions = Record<string, DomainPinOptions>;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A host that only exists on a developer's machine / LAN / tunnel, or a raw IP: never pinned. */
export function isDevHost(host: string): boolean {
  const h = (host ?? '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (IPV4.test(h) || h.includes(':') || h.startsWith('[')) return true; // any IPv4 literal (10.x, 192.168.x, 127.x, …) or IPv6
  return false;
}

/** True when the host is (a subdomain of) a third party we must never pin. */
export function isThirdPartyHost(host: string): boolean {
  const h = (host ?? '').toLowerCase().replace(/\.$/, '');
  return NEVER_PIN_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Hostname (lowercase, no port) of an https:// URL; null for http, malformed, or empty. */
export function httpsHostOf(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https:\/\/([^/:?#@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

export interface PinInputs {
  appEnv: string | undefined;
  /** The API base url (config.apiUrl). */
  apiUrl: string | undefined;
  /** Other first-party hosts the app talks to over fetch (e.g. a realtime gateway url). None today. */
  extraUrls?: ReadonlyArray<string | undefined>;
}

/** The pin options for this build, or null when the build must NOT pin (dev/local env, no https first-party host). Each
 * pinned host gets ALL CA pins (≥2 — TrustKit refuses fewer) and the expiration date. Exact host only (no subdomains): the
 * app pins what it calls, nothing wider. */
export function buildPinningOptions(input: PinInputs): PinningOptions | null {
  if (!input.appEnv || !PINNED_APP_ENVS.has(input.appEnv)) return null;
  const hosts = [input.apiUrl, ...(input.extraUrls ?? [])]
    .map(httpsHostOf)
    .filter((h): h is string => !!h && !isDevHost(h) && !isThirdPartyHost(h));
  if (hosts.length === 0) return null;
  const options: PinningOptions = {};
  for (const host of hosts) {
    options[host] = {
      includeSubdomains: false,
      publicKeyHashes: AMAZON_TRUST_PINS.map((p) => p.spki),
      expirationDate: PIN_EXPIRATION_DATE,
    };
  }
  return options;
}

/** CI gate: every pinned host has ≥2 distinct well-formed pins and a valid yyyy-MM-dd expiration. */
export function pinningOptionsValid(opts: PinningOptions | null): boolean {
  if (!opts) return false;
  const entries = Object.entries(opts);
  if (entries.length === 0) return false;
  return entries.every(([host, o]) =>
    !!host && !isDevHost(host) && !isThirdPartyHost(host) &&
    o.publicKeyHashes.length >= 2 && new Set(o.publicKeyHashes).size === o.publicKeyHashes.length && o.publicKeyHashes.every(isValidPin) &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.expirationDate) && !Number.isNaN(Date.parse(`${o.expirationDate}T00:00:00Z`)));
}

/** What a pin failure event carries from the native layer (library's PinningError). */
export interface PinFailureEvent { serverHostname?: string; message?: string }
export type CaptureFn = (error: Error, context: Record<string, unknown>) => void;

/** Error name Sentry groups pin failures under. The message names no URL — only the class of failure. */
export const PIN_FAILURE_ERROR_NAME = 'TlsPinFailure';

/** Builds the listener the runtime registers for native pin failures: reports ONCE per host per app session (a MITM proxy
 * fails every request — one event is the signal, a thousand is noise) with the bare hostname only (never a URL, path or
 * query string; the native message is dropped because OkHttp's includes the presented chain). Never throws: the user just
 * sees the request fail with the app's ordinary network error. */
export function makePinFailureReporter(capture: CaptureFn, platform: string): (e: PinFailureEvent) => void {
  const reported = new Set<string>();
  return (e) => {
    try {
      const host = httpsHostOf(`https://${String(e?.serverHostname ?? '').trim()}/`) ?? 'unknown';
      if (reported.has(host)) return;
      reported.add(host);
      const err = new Error('TLS public-key pin mismatch');
      err.name = PIN_FAILURE_ERROR_NAME;
      capture(err, { kind: 'tls_pin_failure', host, platform });
    } catch { /* reporting must never break the app */ }
  };
}
