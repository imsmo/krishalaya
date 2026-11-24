// apps/mobile/src/core/security/index.ts · public surface for the security core (guide §4). Screens/boot import
// from here only. FLAG_SECURE (useSecureScreen), TLS public-key pins (tls-pins: CA-level, API host, preview/
// production only; installed natively by tls-pinning.runtime — MOB-TLS-1), device-integrity signal + provider wiring,
// inbound deep-link guard, and the clipboard policy. Root/attestation and obfuscation live in the release build config.
export { useSecureScreen } from './screen-guard';
export { engageSecureScreen, type ScreenCaptureGuard } from './screen-capture-guard';
export { isValidPin, isValidHostPins, hostOf, isPinnedHost, pinConfigReady, type HostPins } from './pinning';
export { AMAZON_TRUST_PINS, PIN_EXPIRATION_DATE, buildPinningOptions, pinningOptionsValid, type PinningOptions } from './tls-pins';
export { setIntegrityProvider, buildIntegrityHeader, integrityHeaders, isSensitivePath, UNKNOWN_INTEGRITY, type IntegrityResult, type IntegrityProvider } from './integrity';
export { parseDeepLink, isSafeParamValue, APP_SCHEME, DEEPLINK_ALLOWLIST, type ParsedLink } from './deeplink-guard';
export { isCopyAllowed, type ClipboardKind } from './clipboard-policy';
