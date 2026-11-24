# Krishalaya mobile: store listing answers (Google Play + App Store)

PC-56 MOB-STORE-1. **One set of facts, two forms.** Each answer below comes from the code and from `apps/mobile/app.config.ts`, which holds the permissions and the iOS privacy manifest (`ios.privacyManifests`). If a feature starts collecting something new, update the privacy manifest, this file and both store forms in the same change. `apps/mobile/STORE_COMPLIANCE.md` (P-32) is the older summary. Where the two differ, this file is current.

## 0. The facts

| What | Where in the code | Collected by | Required? | Linked to the user | Tracking |
|---|---|---|---|---|---|
| Phone number | OTP sign-in (`(auth)`) | Krishalaya API | **Required** | Yes | No |
| Name | Profile | API | Optional | Yes | No |
| Postal address (farm, delivery) | Profile → farm, buyer addresses, hire booking | API | Optional | Yes | No |
| Precise location, one-shot, foreground only | `core/location/gps.ts`: farm or delivery location, worker check-in (geofence), ambassador visit log, hire booking | API | Optional (user taps) | Yes | No |
| Photos | `core/media/picker.ts`: listing photos, KYC documents and selfie, proof of delivery, worker claims, chat attachments. EXIF is stripped (`exif: false`). | API | Optional | Yes | No |
| Government ID (Aadhaar, PAN) for KYC | `(farmer)/kyc`, `(buyer)/kyc` | API → regulated KYC provider (service provider) | Optional (needed for payouts) | Yes | No |
| Payment info (UPI, card, netbanking) | Razorpay checkout (`core/payments/checkout.ts`). Entered in Razorpay's SDK; Krishalaya never sees card numbers. | Razorpay (payment processor, service provider) | Optional (buyers who pay) | Yes | No |
| Other financial info (payout bank account or UPI id, wallet balance and transactions) | Wallet, profile → bank | API | Optional | Yes | No |
| Purchase history (orders) | Orders | API | Optional | Yes | No |
| In-app messages | Buyer ↔ seller chat | API | Optional | Yes | No |
| Other user content (listings, reviews, complaints, scheme applications) | Listings, reviews, profile → complaint | API | Optional | Yes | No |
| Customer support | Help, complaint | API | Optional | Yes | No |
| User id | Account; the only user field sent to Sentry | API, Sentry | Required | Yes | No |
| Device id (push token) | `core/push/fcm.ts` | API (+ Expo/FCM/APNs to deliver) | Optional (notification permission) | Yes | No |
| Crash logs | Sentry: PII-scrubbed on the device (`core/observability/sentry-scrub.ts`), no IP stored | Sentry (service provider) | Not user-optional (off when no DSN) | Yes (user id) | No |
| Performance diagnostics | Sentry traces, 5% of production sessions | Sentry | as above | Yes | No |

**Not collected:** email, contacts, SMS, call logs, calendar, browsing or search history, an advertising id, analytics or app-interaction events (no analytics provider is wired; `setAnalyticsProvider` is never called), health, audio. Voice input (flags `voice_listing` and `voice_assistant`, OFF at launch) uses the platform recogniser (Apple Speech, or Google's recogniser on Android). Audio goes to the OS vendor, never to Krishalaya, and only the text the user keeps lands in a form. If voice is switched on, review this with the OS vendors' terms.

**Encryption in transit:** always. HTTPS only, cleartext is off (`usesCleartextTraffic: false`, ATS default) and TLS pins are injected per build.
**Deletion:** in the app, Settings → Delete account (`(system)/account-delete.tsx`). This is **behind the `system_screens` flag, which must be ON before submission.** Play also requires a web URL for deletion requests (see §5).
**No tracking:** `NSPrivacyTracking` is false and there are no tracking domains, no ad SDKs and no ATT prompt.

## 1. Google Play: Data safety form

- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes**
- Do you provide a way for users to request that their data is deleted? **Yes** (in-app plus web URL)
- **Shared:** answer **No** for every type. Razorpay, the KYC provider, Sentry and Expo/FCM/APNs are *service providers* processing data on our behalf, which Play's definition excludes from "sharing".

| Play category → type | Collected | Optional? | Purposes |
|---|---|---|---|
| Personal info → Name | Yes | Optional | App functionality, Account management |
| Personal info → Phone number | Yes | **Required** | App functionality, Account management, Fraud prevention / security |
| Personal info → Address | Yes | Optional | App functionality |
| Personal info → Other info (Aadhaar or PAN for KYC) | Yes | Optional | Fraud prevention, security & compliance |
| Financial info → Payment info | Yes | Optional | App functionality |
| Financial info → Purchase history | Yes | Optional | App functionality |
| Financial info → Other financial info | Yes | Optional | App functionality, Fraud prevention / compliance |
| Location → Precise location | Yes | Optional | App functionality |
| Location → Approximate location | Yes (the same one-shot fix) | Optional | App functionality |
| Messages → Other in-app messages | Yes | Optional | App functionality |
| Photos and videos → Photos | Yes | Optional | App functionality, Fraud prevention (KYC) |
| App activity → Other user-generated content | Yes | Optional | App functionality |
| App info and performance → Crash logs | Yes | **Required** (always on when configured) | App functionality |
| App info and performance → Diagnostics | Yes | Required | App functionality |
| Device or other IDs | Yes (push token) | Optional | App functionality |
| Everything else (email, contacts, audio, health, web history, app interactions, installed apps, calendar, files) | **No** | | |

None of the data is processed ephemerally.

### Android permissions (as declared after `expo prebuild` and checked in the release APK, MOB-STORE-1)

| Permission | Why | Asked when |
|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` | API calls; offline banner and sync engine (NetInfo reads the connection type) | Install-time (normal) |
| `CAMERA` | Take a listing, KYC, proof-of-delivery, claim or chat photo | The user taps "Camera" |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | One-shot location: farm or delivery location, job check-in, visit log | The user taps the location button |
| `RECORD_AUDIO` | Speech-to-text while holding the voice button (voice flags OFF at launch) | The user holds the mic |
| `POST_NOTIFICATIONS` | Order, offer, payout and job notifications (Android 13+) | After sign-in and role choice, once |
| `VIBRATE`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | Notification delivery (expo-notifications, FCM) | Normal |
| launcher badge permissions (`READ_APP_BADGE`, Samsung, HTC, Huawei, Oppo, Sony and others) | Unread badge count (expo-notifications' ShortcutBadger) | Normal |
| `DETECT_SCREEN_CAPTURE` | expo-screen-capture: screenshot detection on KYC and wallet screens | Normal |
| `NFC`, `READ_BASIC_PHONE_STATE`, `BIND_GET_INSTALL_REFERRER_SERVICE` | Merged by the **Razorpay** SDK (`com.razorpay:standard-core` / `core`): tap-to-pay cards, UPI app and SIM checks, attribution of the checkout. Kept because blocking them risks a SecurityException inside checkout. All are install-time "normal" permissions with no prompt. | Normal |
| `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX internal (app-private) | Normal |

**Removed** (`android.blockedPermissions`): storage (`READ/WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_*`; the gallery uses the system Photo Picker, which needs no permission), `SYSTEM_ALERT_WINDOW`, background location, location foreground service, activity recognition and biometrics. Play's photo/video permissions policy and background-location declaration therefore do not apply. No sensitive-permission declaration forms are needed.

## 2. App Store: App Privacy ("nutrition label")

**Data used to track you:** none. **Data not linked to you:** none (everything we keep is tied to the account).
**Data linked to you**, all with the purpose **App Functionality** (government ID and KYC photos also serve fraud prevention, which Apple folds into App Functionality):

| Apple category | Types |
|---|---|
| Contact Info | Name, Phone Number, Physical Address |
| Financial Info | Payment Info, Other Financial Info |
| Location | Precise Location |
| User Content | Photos or Videos, Emails or Text Messages (in-app chat), Customer Support, Other User Content |
| Identifiers | User ID, Device ID |
| Purchases | Purchase History |
| Diagnostics | Crash Data, Performance Data |
| Other Data | Other Data Types (government ID for KYC) |

These match `ios.privacyManifests.NSPrivacyCollectedDataTypes` one for one. Required-reason APIs declared: UserDefaults `CA92.1`; FileTimestamp `0A2A.1`, `3B52.1`, `C617.1`; DiskSpace `E174.1`, `85F4.1`; SystemBootTime `35F9.1`. Pods that ship their own manifest (Sentry, Expo modules, React Native) are merged by Xcode. **Re-check the merged `PrivacyInfo.xcprivacy` in the first archive** (Xcode → Organizer → Generate Privacy Report).

**Permission prompts:** camera, photo library, location when in use, microphone and speech recognition, in English (`app.config.ts`), Hindi and Gujarati (`apps/mobile/locales/{hi,gu}.json` → `InfoPlist.strings`). No "Always" location, no motion, no temporary full-accuracy prompt. Notifications use the system prompt, which needs no usage string. **Export compliance:** `usesNonExemptEncryption: false` (HTTPS and OS crypto only).

## 3. Content rating, audience and payments

- **Play (IARC questionnaire):** category Utility / Productivity → marketplace. No violence, sexual content, profanity, drugs or gambling. **Users can interact** (buyer ↔ seller chat, reviews). **Shares location:** the location the user sets for a job or delivery is shown to the counterpart (worker, rider). There are **purchases of physical goods** (not digital). Expected rating: **Everyone / PEGI 3**, with "Users Interact" and "Shares Location" descriptors.
- **App Store age rating:** none of the content descriptors apply, so expect **4+**. The app has user-generated content and chat, so Apple guideline 1.2 requires a way to report content and block abusive users, plus a published contact. Order "report" and complaint flows exist. **Confirm chat has report/block before submission.**
- **Target audience (Play):** **18 and over** only. Accounts handle money, KYC and contracts. The app is not designed for children, so the Families policy does not apply, and the terms say 18+.
- **Payments:** Razorpay for **physical goods and services** (produce, hire, delivery). This is outside Google Play Billing and Apple IAP, as both stores allow for physical goods. Wallet top-ups only fund those purchases. Say so in the review notes, because reviewers sometimes ask about "add money".
- **App Review access:** sign-in is by phone OTP, so give reviewers a **test phone number with a fixed OTP** on a review tenant in the "Sign-in required" notes for both stores. Play's App access section needs the same.

## 4. Store assets: in the repo

- App icon 1024² (opaque), adaptive foreground and monochrome, splash, notification icon: `apps/mobile/assets/brand/*.png`, rendered from `assets/brand/src/*.svg` by `node apps/mobile/scripts/generate-brand-assets.mjs` (`--check` verifies them).
- **Play listing icon 512²:** `apps/mobile/assets/brand/play-store-icon.png` (upload by hand).

## 5. Still needed from the founder

1. **Screenshots** for each language (English, Hindi, Gujarati):
   - Play: 2–8 phone screenshots (9:16, 1080×1920 or larger).
   - App Store: 6.9" (1320×2868) and 6.5" (1284×2778) iPhone sets. The app is phone-only (`supportsTablet: false`), so no iPad set.
   - Suggested screens: farmer home, create listing, buyer search, order tracking, wallet, the language picker.
2. **Play feature graphic** 1024×500. Use the brand green, the mark from `assets/brand/src/icon.svg` and the wordmark.
3. **Store text for each language:**
   - Play: app name (30 characters), short description (80), full description (4,000).
   - App Store: name (30), subtitle (30), promotional text (170), description (4,000), keywords (100).
   - Write it natively in Hindi and Gujarati. Machine translation is not enough.
4. **URLs:** privacy policy (required by both stores; it must describe the data in §0), support URL, marketing URL (optional), and a **web account-deletion URL** (required by Play).
5. Set `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL` and the store URLs as EAS variables once the listings exist. `EXPO_PUBLIC_ANDROID_STORE_URL` and `EXPO_PUBLIC_IOS_STORE_URL` feed the forced-update screen.
6. **Flags ON for review:** `system_screens` (account deletion), and `notifications` if push is part of the reviewed build.
7. **Reviewer test account:** a phone number with a fixed OTP (§3).
8. Developer accounts: Google Play Console (organisation account, D-U-N-S) and Apple Developer Program (organisation). Also the push, OTA and Sentry setup in `docs/mobile/PUSH-SETUP.md`.
