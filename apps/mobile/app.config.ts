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

// PC-56 MOB-STORE-1 · the store version. ONE constant feeds both `version` (CFBundleShortVersionString / versionName) and
// `extra.appVersion` (what core/config.ts hands the forced-update floor, update-gate.ts compareVersions), so the release_gate
// can never compare a different number from the one the store shows. Build numbers (android.versionCode / ios.buildNumber)
// are NOT set here: eas.json `cli.appVersionSource: "remote"` + `autoIncrement` on beta/production keep them on EAS.
export const APP_VERSION = '1.0.0';
const BRAND_GREEN = '#1e6f3f'; // packages/tokens colors primary 600 — the Krishalaya mark's tile colour

// EAS project id (from `eas init`; not a secret). Set EAS_PROJECT_ID in the shell that runs `eas` AND as an EAS environment
// variable (EAS re-evaluates this file on its builders). Unset locally → no OTA URL (expo-updates is switched off and the app
// runs its embedded bundle) and no Expo push token (core/push/fcm.ts degrades to null). docs/mobile/PUSH-SETUP.md.
const easProjectId = process.env.EAS_PROJECT_ID || undefined;
// Android FCM config: EAS "file" environment variable GOOGLE_SERVICES_JSON holds the PATH of google-services.json on the
// builder. Absent (local/CI without it) → no FCM on Android: push registration returns null, the app is unaffected.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;
const isProductionBuild = process.env.EXPO_PUBLIC_APP_ENV === 'production';

// iOS permission strings (English; hi/gu in ./locales/*.json). Each names what Krishalaya actually does with it — read from
// the code that asks: core/media/picker.ts (camera / gallery), core/location/gps.ts (one-shot fix), core/voice/stt.client.ts.
const PERMISSION = {
  camera: 'Krishalaya opens the camera only when you choose to take a photo — of your produce for a listing, a KYC document or selfie, a proof of delivery, or a picture for a chat.',
  photos: 'Krishalaya opens your photo library only when you choose a picture to attach — a produce photo, a KYC document, a proof of delivery or a chat picture. Only the photo you pick is used.',
  location: 'Krishalaya reads your location only when you tap to share it — to set your farm or delivery location, check in at a job site, or log a field visit.',
  microphone: 'Krishalaya uses the microphone only while you hold the voice button, to turn your words into text.',
  speech: 'Krishalaya turns your speech into text so you can fill forms without typing.',
} as const;

// Crash reporting (Sentry, core/observability/sentry.provider.ts). The Expo plugin wires the native SDK and the release
// build's PRIVATE source-map upload. The upload runs only when SENTRY_AUTH_TOKEN is present on the builder (an EAS secret);
// without it (local, forks) the upload is disabled instead of failing the build. Org/project fall back to SENTRY_ORG /
// SENTRY_PROJECT at build time. Source maps never ship in the APK/IPA (Hermes emits them beside the bundle, not into it).
const sentryPlugin: [string, Record<string, unknown>] = ['@sentry/react-native', {
  ...(process.env.SENTRY_ORG ? { organization: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_URL ? { url: process.env.SENTRY_URL } : {}),
  disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN,
}];

const config: ExpoConfig = {
  name: 'Krishalaya',
  slug: 'krishalaya',
  scheme: 'krishalaya',
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  version: APP_VERSION,
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  // New Architecture: mandatory since SDK 55 (the `newArchEnabled` key was removed from the config schema) — MOB-SDK-1.
  // Hermes bytecode in release (smaller + harder to reverse than plain JS) — §4/§5. React Native 0.88 ships Hermes as its only
  // engine, so the old `jsEngine: 'hermes'` key is gone from SDK 58's config type (MOB-STORE-1; it was a no-op).
  // Brand assets: SVG sources in assets/brand/src, PNGs rendered by scripts/generate-brand-assets.mjs (MOB-STORE-1).
  icon: './assets/brand/icon.png', // 1024² opaque — iOS + Android legacy launcher
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.krishalaya.app',
    // HTTPS + the OS's own crypto only → exempt from US export-compliance documentation (skips the per-build question).
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true, // let the hi/gu InfoPlist.strings (./locales) apply
      NSCameraUsageDescription: PERMISSION.camera,
      NSPhotoLibraryUsageDescription: PERMISSION.photos,
      NSLocationWhenInUseUsageDescription: PERMISSION.location,
      NSMicrophoneUsageDescription: PERMISSION.microphone,
      NSSpeechRecognitionUsageDescription: PERMISSION.speech,
    },
    // Apple privacy manifest (PrivacyInfo.xcprivacy). Required-reason APIs: the categories our pods touch — React Native
    // core (SystemBootTime, UserDefaults, FileTimestamp), AsyncStorage/SecureStore/expo-constants (UserDefaults),
    // expo-file-system + expo-sqlite (FileTimestamp, DiskSpace), Sentry (SystemBootTime, FileTimestamp). Collected data =
    // exactly what docs/mobile/STORE-LISTING.md declares (one source of facts); NO tracking, no tracking domains.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['0A2A.1', '3B52.1', 'C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
      ],
      NSPrivacyCollectedDataTypes: ([
        'NSPrivacyCollectedDataTypePhoneNumber',        // OTP sign-in + the account itself
        'NSPrivacyCollectedDataTypeName',               // profile
        'NSPrivacyCollectedDataTypePhysicalAddress',    // farm / delivery addresses
        'NSPrivacyCollectedDataTypePreciseLocation',    // one-shot fix when the user taps (core/location/gps.ts)
        'NSPrivacyCollectedDataTypePhotosorVideos',     // listing photos, KYC documents + selfie, proof of delivery, chat
        'NSPrivacyCollectedDataTypeEmailsOrTextMessages', // in-app chat between buyers and sellers
        'NSPrivacyCollectedDataTypeCustomerSupport',    // complaints / help requests
        'NSPrivacyCollectedDataTypeOtherUserContent',   // listings, reviews, scheme applications the user writes
        'NSPrivacyCollectedDataTypePaymentInfo',        // UPI / card entered in Razorpay checkout (Razorpay SDK)
        'NSPrivacyCollectedDataTypeOtherFinancialInfo', // payout bank account / UPI id, wallet balance
        'NSPrivacyCollectedDataTypePurchaseHistory',    // orders
        'NSPrivacyCollectedDataTypeOtherDataTypes',     // government ID for KYC (Aadhaar / PAN, server-verified)
        'NSPrivacyCollectedDataTypeUserID',             // account id (also the only user field Sentry gets)
        'NSPrivacyCollectedDataTypeDeviceID',           // push token
        'NSPrivacyCollectedDataTypeCrashData',          // Sentry, PII-scrubbed
        'NSPrivacyCollectedDataTypePerformanceData',    // Sentry traces at a 5% sample in production
      ]).map((type) => ({
        NSPrivacyCollectedDataType: type,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      })),
    },
  },
  android: {
    package: 'com.krishalaya.app',
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-foreground.png',
      monochromeImage: './assets/brand/adaptive-monochrome.png', // Android 13+ themed icons
      backgroundColor: BRAND_GREEN,
    },
    ...(googleServicesFile ? { googleServicesFile } : {}),
    // Only what the app uses (each justified in docs/mobile/STORE-LISTING.md). An explicit list stops the template's
    // defaults (storage, SYSTEM_ALERT_WINDOW) from being added; blockedPermissions strips the ones library manifests merge in
    // that no Krishalaya feature needs.
    permissions: [
      'android.permission.CAMERA',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.RECORD_AUDIO',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
    ],
  },
  // iOS-only InfoPlist.strings per language (Hindi + Gujarati) for the permission prompts above.
  locales: { hi: './locales/hi.json', gu: './locales/gu.json' },
  plugins: [
    'expo-router', 'expo-secure-store', 'expo-localization', 'expo-font', 'expo-sqlite',
    ['expo-splash-screen', { image: './assets/brand/splash.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: BRAND_GREEN }],
    // Camera + gallery only (no video): the picker's microphone string is the same just-in-time voice string.
    ['expo-image-picker', { cameraPermission: PERMISSION.camera, photosPermission: PERMISSION.photos, microphonePermission: PERMISSION.microphone }],
    // Foreground, one-shot location only: no "Always", no background/foreground-service location, no motion, no temporary
    // full-accuracy prompt (the app never calls requestTemporaryFullAccuracyAsync).
    ['expo-location', {
      locationWhenInUsePermission: PERMISSION.location,
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      motionUsagePermission: false,
      locationFullAccuracyPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
    }],
    // Push (core/push): white status-bar silhouette, brand tint, the `default` channel fcm.ts creates, and the APNs
    // `aps-environment` entitlement (production for store builds).
    ['expo-notifications', {
      icon: './assets/brand/notification-icon.png',
      color: BRAND_GREEN,
      defaultChannel: 'default',
      mode: isProductionBuild ? 'production' : 'development',
    }],
    sentryPlugin,
    // Speech-to-text via the platform recognizer (core/voice/stt.client) — used only behind the `voice_listing` / `voice_assistant`
    // flags (both OFF at launch). Adds RECORD_AUDIO (the replaced @react-native-voice/voice merged the same permission
    // from its own manifest) and the iOS microphone + speech usage descriptions the OS shows before it asks.
    ['expo-speech-recognition', {
      microphonePermission: PERMISSION.microphone,
      speechRecognitionPermission: PERMISSION.speech,
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
  // Crash/source-map handling (§4/§6): release builds upload source maps PRIVATELY to Sentry (the plugin above, gated on
  // SENTRY_AUTH_TOKEN) and the maps are never part of the shipped artifact.
  // expo-updates (OTA for JS-only fixes; same flag discipline + rollback — §8). `url` is what `eas update:configure` would
  // write (https://u.expo.dev/<projectId>), built from EAS_PROJECT_ID so the build also works without it: no project id →
  // updates disabled (embedded bundle only). We don't block boot on a check (fallback 0 → apply on the next cold start),
  // and the runtime is keyed to appVersion so an OTA can only target a compatible binary. NOTE: ON_LOAD is the NATIVE
  // launch check; the `ota_updates` flag gates only the JS foreground re-check (core/release/ota.ts) — a bad OTA is
  // withdrawn with `eas update:rollback`, not by the flag (RELEASE.md).
  updates: {
    enabled: !!easProjectId,
    ...(easProjectId ? { url: `https://u.expo.dev/${easProjectId}` } : {}),
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    tenantSlug: process.env.EXPO_PUBLIC_TENANT_SLUG,
    tenantId: process.env.EXPO_PUBLIC_TENANT_ID,
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    appVersion: APP_VERSION,
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
