// apps/mobile/src/core/security/tls-pinning.runtime.ts · PC-56 MOB-TLS-1 — installs the CA-level public-key pins
// (tls-pins.ts) into the NATIVE networking stack via react-native-ssl-public-key-pinning: OkHttp CertificatePinner on
// Android (RN's NetworkingModule client — every fetch/XHR), TrustKit on iOS (RCTHTTPRequestHandler's NSURLSession).
// Only for preview/production builds (appEnv staging/production) and only for the app's own API host; development, Expo Go
// and local builds never pin. `tlsPinningReady()` is idempotent and NEVER rejects; the API clients await it before their
// first request so nothing reaches the API host unpinned. A pin mismatch fails that request natively (the app shows its
// usual network error) and is reported once per host to Sentry through the observability API.
import { Platform } from 'react-native';
import { config } from '../config';
import { captureError } from '../observability';
import { buildPinningOptions, makePinFailureReporter } from './tls-pins';

let ready: Promise<void> | null = null;

async function install(): Promise<void> {
  const options = buildPinningOptions({ appEnv: config.appEnv, apiUrl: config.apiUrl });
  if (!options) return; // dev / local build, or no https first-party host → system-CA validation only
  try {
    // Loaded lazily: dev builds never touch the native module (Expo Go does not have it).
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- native module loaded only for pinned builds
    const lib = require('react-native-ssl-public-key-pinning') as typeof import('react-native-ssl-public-key-pinning');
    if (!lib.isSslPinningAvailable()) {
      captureError(new Error('TLS pinning native module missing in a pinned build'), { kind: 'tls_pin_unavailable', platform: Platform.OS });
      return;
    }
    lib.addSslPinningErrorListener(makePinFailureReporter(captureError, Platform.OS));
    await lib.initializeSslPinning(options);
  } catch (e) {
    // Never brick boot over pinning set-up; the miss is visible in Sentry.
    captureError(e, { kind: 'tls_pin_init_failed', platform: Platform.OS });
  }
}

/** Starts pinning once (first call) and resolves when it is in force (or deliberately skipped). Never rejects. */
export function tlsPinningReady(): Promise<void> {
  if (!ready) ready = install().catch(() => undefined);
  return ready;
}
