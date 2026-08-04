# Krishalaya Mobile — Store Compliance (P-32, Wave 11)

Play Store + App Store submission compliance (MOBILE_AI_AGENT_BUILD_GUIDE §8). This is the source of truth that
the store data-safety / privacy forms must match what the app actually collects. Keep it in sync with the code
(`core/observability/redact` defines what never leaves the device; `core/security` the FLAG_SECURE/PII handling).

## Permissions — justification + just-in-time rationale
Requested only when the feature needs them, each with an in-context rationale (the `(system)/permissions` screen,
P-23, mirrors this list). None are requested at launch.

| Permission | Why (minimal, feature-scoped) | When asked |
|---|---|---|
| Camera | Photograph produce for a listing; capture KYC/scheme docs | On tapping capture in create-listing / KYC / scheme apply |
| Photos / media | Attach an image or document from the gallery | On tapping "add from gallery" |
| Location (foreground) | Show nearby mandis; confirm worker attendance (geofence) | On opening mandi/weather or starting a work check-in |
| Microphone | Voice search + Speak-to-Sell (on-device STT) | On tapping the mic |
| Notifications | Price alerts, order updates, reminders | On first opt-in (P-04) |

Not requested: background location, contacts, SMS read, calendar, precise advertising id. No `READ_PHONE_STATE`.

## Play Data Safety / App Privacy — collection & sharing
| Data type | Collected? | Purpose | Shared? | Notes |
|---|---|---|---|---|
| Phone number | Yes | Account / OTP auth | No | Server-side; masked in UI; **redacted from analytics/crash** |
| Name | Yes (optional) | Profile/greeting | No | |
| Email | Yes (optional) | Profile/contact | No | Redacted from analytics/crash |
| Approx. location | Yes (if granted) | Mandis, attendance | No | Foreground only |
| Photos/docs | Yes (user-provided) | Listings, KYC, schemes | No | EXIF stripped before upload (P-01) |
| Financial info | Yes (server-side) | Payments/payouts/wallet | With payment processor (Razorpay) | App holds **no** raw account/card; last-4/VPA only; FLAG_SECURE |
| Aadhaar/PAN (KYC) | Server-side only | KYC/scheme eligibility | With regulated KYC provider | Never stored raw on device; masked; FLAG_SECURE |
| App activity / analytics | Yes (consented) | Funnels / SLOs | With analytics provider | **PII-scrubbed** (`redactPII`), behind consent, off by default |
| Crash logs | Yes | Stability | With crash service (Sentry) | PII/token-redacted; user id only |
| Device integrity signal | Yes | Fraud/risk scoring | No | Coarse posture token, **no device id / PII** |

- **Encryption in transit:** HTTPS + TLS pinning (P-30). **At rest:** tokens in Keychain/Keystore (expo-secure-store).
- **Data deletion:** in-app DPDP **account delete** + **data export** (P-23, `(system)` privacy) — request from the app.
- **Account creation:** phone-OTP (enumeration-safe). Children: not directed at children; no child data collected.

## Listings / metadata
- Title, short + full description, screenshots, feature graphic per locale (hi/en/gu).
- Category: Shopping / Business (agri marketplace). Content rating: everyone (no restricted content).
- Privacy policy URL + terms URL (config `privacyUrl`/`termsUrl`); linked in-app (About / Privacy screens).
- Contact email + support (in-app help/complaint → support tickets, P-22).

## Pre-submit checks
- [ ] Data-safety form fields above match `redactPII` + the data layers (no undeclared collection).
- [ ] Each permission has an OS usage-description string + the in-app rationale (permissions screen).
- [ ] Privacy policy + terms URLs resolve (https) and are linked in-app.
- [ ] Account-delete + data-export reachable in-app (DPDP); deletion documented.
- [ ] Release build: cleartext off, Hermes, R8/ProGuard, source maps stripped (P-30).
