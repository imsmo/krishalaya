// apps/mobile/app.config.ts · Expo app configuration. Uses expo-router (file-based routing under src/app) and
// surfaces public runtime config via `extra` (read by core/config.ts — no secrets here, only public values
// injected from EXPO_PUBLIC_* env at build time). Deep-link scheme `krishiverse` powers OTP/SMS return +
// notification taps. P-30 release hardening: Hermes JS engine, R8/ProGuard + resource shrink, cleartext OFF, and
// TLS pinning declared for the API host so the native layer enforces it in release builds (§4). None of these are
// the LAST line of defence — the server is the authority (Law 11) — but they raise the cost of attack.
import type { ExpoConfig } from 'expo/config';

const apiHost = (() => { try { return process.env.EXPO_PUBLIC_API_URL ? new URL(process.env.EXPO_PUBLIC_API_URL).host : undefined; } catch { return undefined; } })();
// TLS public-key pins (base64 SHA-256 SPKI) injected at build time: primary + backup (rotation). CSV in env.
const tlsPins = (process.env.EXPO_PUBLIC_TLS_PINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const config: ExpoConfig = {
  name: 'Krishalaya',
  slug: 'krishalaya',
  scheme: 'krishiverse',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  jsEngine: 'hermes', // Hermes bytecode in release (smaller + harder to reverse than plain JS) — §4/§5
  splash: { backgroundColor: '#1e6f3f', resizeMode: 'contain' },
  assetBundlePatterns: ['**/*'],
  ios: { supportsTablet: false, bundleIdentifier: 'co.krishiverse.app' },
  android: { package: 'co.krishiverse.app', adaptiveIcon: { backgroundColor: '#1e6f3f' } },
  plugins: [
    'expo-router', 'expo-secure-store', 'expo-localization', 'expo-font',
    // Release anti-tamper/anti-reversing + transport hardening (§4). Cleartext is OFF (HTTPS-only); R8/ProGuard
    // + resource shrinking minify + strip; Hermes is the engine. ProGuard keeps the RN/OkHttp/Hermes runtime.
    ['expo-build-properties', {
      android: {
        enableProguardInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        usesCleartextTraffic: false,
        extraProguardRules: '-keep class com.facebook.hermes.** { *; }\n-keep class com.facebook.jni.** { *; }\n-keep class com.swmansion.** { *; }\n-dontwarn okhttp3.**\n-dontwarn okio.**',
      },
      ios: { flipper: false },
    }],
  ],
  experiments: { typedRoutes: true },
  // Crash/source-map handling (§4/§6): release builds upload source maps PRIVATELY to the crash service and
  // STRIP them from the shipped artifact — configured in eas.json + the CI upload step, not here.
  // expo-updates (OTA for JS-only fixes; same flag discipline + rollback — §8). `url` is injected by
  // `eas update:configure` (it carries the project id); we don't block boot on a check (fallback 0 → apply on the
  // next cold start), and the runtime is keyed to appVersion so an OTA can only target a compatible binary.
  updates: { enabled: true, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 },
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    tenantSlug: process.env.EXPO_PUBLIC_TENANT_SLUG,
    tenantId: process.env.EXPO_PUBLIC_TENANT_ID,
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    appVersion: '0.1.0',
    minSupportedVersion: process.env.EXPO_PUBLIC_MIN_VERSION,
    androidStoreUrl: process.env.EXPO_PUBLIC_ANDROID_STORE_URL,
    iosStoreUrl: process.env.EXPO_PUBLIC_IOS_STORE_URL,
    privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL,
    termsUrl: process.env.EXPO_PUBLIC_TERMS_URL,
    razorpayKeyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
    tenantConsoleUrl: process.env.EXPO_PUBLIC_TENANT_CONSOLE_URL,
    // TLS pinning config consumed by the native pinning hook in release builds; CI gate: pinConfigReady().
    tlsPins: apiHost && tlsPins.length ? [{ host: apiHost, pins: tlsPins, includeSubdomains: false }] : [],
  },
};

export default config;
