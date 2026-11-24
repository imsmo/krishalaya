// apps/mobile/app.config.ts · Expo app configuration. Uses expo-router (file-based routing under src/app) and
// surfaces public runtime config via `extra` (read by core/config.ts — no secrets here, only public values
// injected from EXPO_PUBLIC_* env at build time). Deep-link scheme `krishalaya` powers OTP/SMS return +
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
  scheme: 'krishalaya',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  // New Architecture: mandatory since SDK 55 (the `newArchEnabled` key was removed from the config schema) — MOB-SDK-1.
  jsEngine: 'hermes', // Hermes bytecode in release (smaller + harder to reverse than plain JS) — §4/§5
  splash: { backgroundColor: '#1e6f3f', resizeMode: 'contain' },
  assetBundlePatterns: ['**/*'],
  ios: { supportsTablet: false, bundleIdentifier: 'com.krishalaya.app' },
  android: { package: 'com.krishalaya.app', adaptiveIcon: { backgroundColor: '#1e6f3f' } },
  plugins: [
    'expo-router', 'expo-secure-store', 'expo-localization', 'expo-font', 'expo-sqlite',
    // Speech-to-text via the platform recognizer (core/voice/stt.client) — used only behind the `voice_listing` / `voice_assistant`
    // flags (both OFF at launch). Adds RECORD_AUDIO (the replaced @react-native-voice/voice merged the same permission
    // from its own manifest) and the iOS microphone + speech usage descriptions the OS shows before it asks.
    ['expo-speech-recognition', {
      microphonePermission: 'Krishalaya uses the microphone only while you hold the voice button, to turn your words into text.',
      speechRecognitionPermission: 'Krishalaya turns your speech into text so you can fill forms without typing.',
    }],
    // Release anti-tamper/anti-reversing + transport hardening (§4). Cleartext is OFF (HTTPS-only); R8 + resource
    // shrinking minify + strip; Hermes is the engine. ProGuard keeps the RN/OkHttp/Hermes runtime.
    // MOB-SDK-1: Google Play requires target API 36 (Android 16) for new apps and updates since 31 Aug 2026 — the
    // target is pinned here explicitly so an SDK default can never silently drop below it. compileSdk is 37 (the
    // SDK 58 default) and cannot be 36: every Expo SDK 58 module's AAR metadata requires compileSdk >= 37 (the release
    // build fails checkReleaseAarMetadata on 36). Play gates on targetSdk only. `enableProguardInReleaseBuilds` was
    // renamed `enableMinifyInReleaseBuilds` (SDK 54); the old key is no longer read.
    ['expo-build-properties', {
      android: {
        compileSdkVersion: 37,
        targetSdkVersion: 36,
        enableMinifyInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        usesCleartextTraffic: false,
        extraProguardRules: [
          '-keep class com.facebook.hermes.** { *; }',
          '-keep class com.facebook.jni.** { *; }',
          '-keep class com.swmansion.** { *; }',
          // Razorpay checkout (its documented rules): the checkout WebView calls back into Java by reflection.
          '-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }',
          '-keepattributes JavascriptInterface',
          '-keepattributes *Annotation*',
          '-keep class com.razorpay.** { *; }',
          '-dontwarn com.razorpay.**',
          '-keepclasseswithmembers class * { public void onPayment*(...); }',
          '-dontwarn okhttp3.**',
          '-dontwarn okio.**',
        ].join('\n'),
      },
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
