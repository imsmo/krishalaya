# Mobile: push, OTA updates and crash reporting setup (founder steps)

PC-56 MOB-STORE-1. The app builds and runs without any of this. Each missing piece switches its feature off cleanly:

| Missing | Effect |
|---|---|
| `EAS_PROJECT_ID` | No OTA updates (`updates.enabled` false, the app runs the bundle shipped in the binary). No Expo push token: `core/push/fcm.ts` returns null. |
| `GOOGLE_SERVICES_JSON` | Android only: no FCM, so no push token on Android. iOS is unaffected. |
| APNs key | iOS push tokens are issued but Apple rejects the deliveries. |
| `EXPO_PUBLIC_SENTRY_DSN` | Crash reporting is off: the SDK is never initialised and makes no network calls. |
| `SENTRY_AUTH_TOKEN` | Crashes are still reported, but stack traces show minified code because no source maps were uploaded. The release workflow prints a warning. |

All of these are read in `apps/mobile/app.config.ts`. Nothing secret is committed.

## 1. EAS project (needed for OTA and push)

1. From `apps/mobile`, run `npx eas-cli login`, then `npx eas-cli init`. Because the config is dynamic (`app.config.ts`), `eas init` prints the project id and does not write it. Copy the id.
2. Make the id available everywhere `app.config.ts` runs. It is not a secret.
   - On EAS builders: `npx eas-cli env:create --name EAS_PROJECT_ID --value <id> --environment production --environment preview --environment development --visibility plaintext`
   - On GitHub (mobile-release.yml): add a repository **variable** `EAS_PROJECT_ID`.
   - On your own shell, when running `eas`: `export EAS_PROJECT_ID=<id>`, or put it in `apps/mobile/.env`.
   - Optionally set `EXPO_OWNER` (your Expo account or organisation slug) the same way.
3. The config derives the rest: `updates.url = https://u.expo.dev/<id>` (the value `eas update:configure` would write) and `extra.eas.projectId`, which the push token uses.
4. Build numbers live on EAS (`eas.json` → `cli.appVersionSource: "remote"`, with `autoIncrement` on `beta` and `production`). The first `eas build` asks to initialise them. Accept, starting at 1. The store version comes from `APP_VERSION` in `app.config.ts` (now 1.0.0). For a new store release, bump `APP_VERSION`. Because `runtimeVersion` follows the app version, OTA updates only reach binaries with the same version.

### OTA behaviour (read before your first OTA)
- `checkAutomatically: ON_LOAD` is the **native** check on each cold start. When a binary has a project id, it downloads a new update for its channel and applies it on the next launch. **The `ota_updates` flag does not control this.**
- The `ota_updates` flag (default OFF) controls only the extra JavaScript re-check when the app comes back online (`core/release/ota.ts`, via the real expo-updates adapter). It never reloads the app mid-flow.
- To withdraw a bad OTA, run mobile-release → `ota-rollback` (`eas update:rollback`). Flipping the flag does not withdraw it.

## 2. Android push (Firebase Cloud Messaging)

1. Create a Firebase project at <https://console.firebase.google.com>. Turn Analytics off: the app declares no analytics.
2. Add an Android app with package `com.krishalaya.app`, then download `google-services.json`. Do not commit it.
3. Upload it to EAS as a **file** variable. On the builder, EAS sets the variable to the file's path, and `app.config.ts` passes that path to `android.googleServicesFile`:
   `npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production --environment preview --visibility secret`
4. Give Expo's push service permission to send through FCM v1. In Firebase, go to Project settings → Service accounts → Generate new private key. Then run `npx eas-cli credentials` → Android → `com.krishalaya.app` → Google Service Account → "Manage your Google Service Account Key for Push Notifications (FCM V1)" → upload the JSON key.
5. Nothing else is needed in the app. The `expo-notifications` plugin already sets the default channel id `default` (created on registration), the white status-bar icon and the brand colour.

## 3. iOS push (APNs)

1. You need an Apple Developer Program membership and the bundle id `com.krishalaya.app`. The first `eas build -p ios` can register the bundle id for you.
2. The `expo-notifications` plugin adds the Push Notifications capability (`aps-environment`). It is `production` for builds with `EXPO_PUBLIC_APP_ENV=production` (the `beta` and `production` profiles) and `development` otherwise.
3. Create the APNs key. Either let `eas build -p ios` generate it ("Generate a new Apple Push Notifications service key? Yes"), or create one under Certificates, IDs & Profiles → Keys (+ "Apple Push Notifications service") and upload the `.p8` with `npx eas-cli credentials` → iOS → Push Notifications.

## 4. Turning push on
- The server-side flag `notifications` must be ON for the tenant. It is the kill-switch.
- Every signed-in role now registers: after sign-in **and** after a role is chosen, the app asks for notification permission once, just in time (`core/push/PushRegistrar.tsx`). Before this wave, only farmers registered.
- Tapping a push opens the screen for the role that is active at that moment. Buyers go to orders, offers, auctions or KYC. Roles without a notification inbox go to their home screen. A safe internal `deepLink` in the payload takes precedence.

## 5. Crash reporting (Sentry)

1. Create a Sentry organisation and a **React Native** project. Under the project's Security & Privacy settings, turn on **Data Scrubber**, **Use Default Scrubbers** and **Prevent Storing of IP Addresses**. The app already scrubs on the device (`core/observability/sentry-scrub.ts`), and these settings are a second layer.
2. Set the DSN (a public client key) as an EAS variable for the `production` and `preview` environments: `EXPO_PUBLIC_SENTRY_DSN`. Leave it unset for development.
3. Create an auth token with the `project:releases` and `org:read` scopes (Settings → Auth Tokens).
   - EAS: `SENTRY_AUTH_TOKEN` (visibility **secret**), plus `SENTRY_ORG` and `SENTRY_PROJECT` (plaintext). The builder uploads binary source maps while it builds.
   - GitHub: secret `SENTRY_AUTH_TOKEN`, variables `SENTRY_ORG` and `SENTRY_PROJECT`. The `ota-update` job uploads OTA source maps.
4. What gets sent: errors (100%), performance traces (5% of production sessions, 0% elsewhere) and session health (for the crash-free gate on the staged rollout). The only user field is the account id. Screenshots, view hierarchy, replays, profiling and default PII are all off.
