# Krishalaya Mobile — Threat Model & Security Sign-off (P-30, Wave 11)

**Scope:** `apps/mobile` (React Native / Expo) + the `@krishalaya/sdk-js` client it speaks through.
**Posture:** the mobile app is **fully untrusted**. A patched/rooted APK can call any endpoint with any payload,
strip any client-side check, and read the decompiled bundle. Every security decision is therefore **enforced on
the server** (Law 11); the client hardening below only *raises the cost of attack* — it is never the last line of
defence. This document is the §4 sign-off for the GA gate.

> Note on scope of this pass: the JS/config layer is implemented + unit-verified here. Native enforcement (TLS
> pinning handshake, root/Play-Integrity/App-Attest, R8/ProGuard, source-map strip) is wired through the release
> build config (`app.config.ts` `expo-build-properties` + `eas.json`) and is exercised by the EAS/CI build, **not**
> the offline sandbox. `npm audit`/Snyk runs as a CI gate (needs a lockfile + registry).

---

## A. §4 CHECKLIST — status

| # | §4 control | Status | Where |
|---|------------|--------|-------|
| 1 | Tokens only in encrypted secure storage; never AsyncStorage/logs/bundle | ✅ | `core/auth/token-store.ts` (expo-secure-store); access+refresh+expiry only; language in AsyncStorage is non-secret |
| 2 | No API secret/admin capability in the bundle (only `EXPO_PUBLIC_*`) | ✅ | `core/config.ts` fail-closed; only public origin/keys; god-mode lives in admin-api (Law 11) |
| 3 | HTTPS only + TLS cert/public-key **pinning** (primary + backup) | ✅ (native at release) | `core/security/pinning.ts` (config + CI gate `pinConfigReady`); `app.config.ts` `tlsPins` + `usesCleartextTraffic:false` |
| 4 | Root/jailbreak + Play Integrity / App Attest on sensitive flows | ✅ (signal) | `core/security/integrity.ts` — risk signal header `x-device-integrity` on every authed call; server scores it; native provider injected at boot via `setIntegrityProvider` |
| 5 | Anti-tamper/anti-reversing: Hermes, R8/ProGuard, shrink, strip source maps, no dev menu | ✅ (release config) | `app.config.ts` (`jsEngine:hermes`, expo-build-properties), `eas.json` (production profile + private source-map upload) |
| 6 | Every mutation carries an Idempotency-Key (Law 3) | ✅ | SDK attaches `idempotency-key` on non-GET; all write data-layers pass `newId()`; SDK test pins it |
| 7 | Server enforces rate limits/bot defence; app doesn't hammer | ✅ | search debounced (350ms); keyset+bounded lists; GET-only retry/backoff; mutations never auto-retry |
| 8 | Enumeration-safe OTP; respects server cooldown/attempt caps | ✅ | `core/auth/otp.flow` + `otp.helpers` (UI advances identically; surfaces server throttle); verify screen FLAG_SECURE |
| 9 | AuthZ: app picks role for navigation only; 403 shown gracefully | ✅ | role = navigation; every protected action server-authorized; SdkError 403 → friendly state |
| 10 | IDOR / data minimization: ids re-checked server-side; no cross-tenant cache | ✅ | all `box=mine`/owner-scoped reads; deep-link params untrusted (guard); cache scoped per user (`core/offline/scope`) |
| 11 | Input validation client-side for UX + server re-validates (zod .strict) | ✅ | phone/IFSC/VPA/amount validators (ReDoS-safe, bounded); money as bigint-minor strings (Law 2) |
| 12 | PII/DPDP: no raw Aadhaar/PAN/bank; masked only; FLAG_SECURE on sensitive screens | ✅ | last-4/VPA only (`bankLabel`); **17** sensitive screens use `useSecureScreen`; export/delete are server-run |
| 13 | Deep links / WebViews / clipboard audit | ✅ | inbound `parseDeepLink` allowlist (no money flows link-reachable); **zero WebViews**; **zero Clipboard** usage; outbound links https-only |
| 14 | Supply chain: pinned deps, no unvetted native modules, `npm audit`/Snyk in CI | ✅ (CI gate) | `eas.json` production note; audit runs in CI (lockfile + registry) |

FLAG_SECURE coverage (17 screens): auth/verify, buyer/checkout, farmer kyc, orders/pod, profile/bank,
profile/documents, schemes/apply, schemes/docs, wallet add-money/withdraw/index/transactions/payouts/txn-detail,
worker/withdraw, ambassador/withdraw, system/change-phone.

---

## B. PER-FLOW patched-client abuse → server-side mitigation

**OTP / login (`auth/requestOtp`, `auth/verify`).**
- *Abuse:* enumerate which phone numbers exist; brute-force the OTP; replay a captured OTP; spoof "device clean".
- *Closed:* UI advances identically whether or not the number exists (enumeration-safe); the server owns OTP
  attempt caps + resend cooldown + expiry and returns the throttle message; OTP is never logged/clipboard'd; the
  verify screen is FLAG_SECURE; the `x-device-integrity` signal lets the server raise step-up on risky devices.
  A patched client that lies "clean" gains nothing — the server scores the signal, it doesn't trust it.

**Checkout / pay (`buyer/checkout` → `checkout.place` + Razorpay).**
- *Abuse:* tamper the amount/total client-side; replay a payment; pay for someone else's cart; skip a fee.
- *Closed:* totals + charges are computed **server-side** at place time (the app only displays bigint-minor
  amounts via MoneyText — never a float, Law 2); the order POST carries an Idempotency-Key (no double-charge on
  retry); the payment is verified server-side against the Razorpay signature; cart/order are owner-scoped (IDOR).
  FLAG_SECURE on the checkout screen.

**Payout / withdraw (`wallet/withdraw`, worker/ambassador withdraw → `payouts`).**
- *Abuse:* grant yourself a withdrawal; withdraw to someone else's account; replay a withdraw; float the amount.
- *Closed:* the payout is **authorized server-side** (balance, KYC, per-user limits, destination ownership) — a
  patched client can't self-grant; 403 shown, never worked around. Withdrawal is **not** offline-queued (needs a
  live server decision); the POST carries an Idempotency-Key (no double-pay); amounts are bigint-minor; FLAG_SECURE.

**Attendance / geofence (`worker` active-job check-in).**
- *Abuse:* fake GPS to mark attendance off-site; replay a check-in; mark attendance for another worker.
- *Closed:* the geofence pre-check is **UX only** — the server is the authority on attendance acceptance
  (location + time + assignment ownership re-checked); the check-in POST is idempotent; a spoofed-GPS device
  raises the integrity signal; the worker can only act on their own assignment (owner-scoped).

**Offer / negotiation (`buyer/offers` → `offers`).**
- *Abuse:* accept an offer you don't own; tamper the offered price; replay accept to create duplicate orders.
- *Closed:* offer ownership + the accept→order transition are server-enforced (state machine, Law 5); the offer
  price is bigint-minor server-side; accept carries an Idempotency-Key so a replay can't create two orders;
  offers are owner-scoped (IDOR). The app reflects state, never decides it.

---

## C. RESIDUAL RISK / FOLLOW-UPS (tracked, not blocking the JS layer)
- **Native attestation provider** (`setIntegrityProvider`) must be wired in the release build (Play Integrity /
  App Attest) — the JS port + server scoring are ready; the default honestly reports `unknown`.
- **Real TLS pins** must be injected at build (`EXPO_PUBLIC_TLS_PINS`, primary + backup) and rotated on cert
  renewal; `pinConfigReady()` is the CI gate so an empty/short set fails the build.
- **`npm audit`/Snyk** is a CI gate (needs lockfile + registry) — wired in `eas.json`'s production promotion note.
- **Source-map upload** to the crash service is a CI step (private), with maps stripped from the shipped artifact.

## D. SIGN-OFF
The §4 checklist is GREEN at the JS/config layer (items 1–14), with items 3/4/5/14 completed by the release build
config + CI gates (verified by EAS/CI, not the offline sandbox). The five high-value flows above are closed
**server-side** with the client hardening as defence-in-depth. Recommendation: **proceed to staged rollout**
(1%→10%→100%, crash-free ≥ 99.5%) once a release build passes the CI gates (pins present, audit clean, source
maps uploaded). — Mobile security pass, P-30.
