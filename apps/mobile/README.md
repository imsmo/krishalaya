# mobile — Krishalaya app (one account, role-switching)

Expo SDK 51 + **expo-router** (file-based routing under `src/app`). Offline-first, vernacular (hi/en/gu),
built for budget Android in low-signal villages. Built on the shared `@krishalaya/sdk-js` (resilient typed API
client), `@krishalaya/i18n` (formatters + translator), and `@krishalaya/ui-native` (the RN component library
on the Phase-1 design tokens). Target: small APK, usable on 2 GB-RAM phones, works on 2G.

## What's built this release (the foundation + the farmer vertical)

**Shared RN component library — `packages/ui-native`** (was stubs): `theme` (the full Phase-1 token set), `Button`,
`Card`, `Input`, `OtpInput`, `MoneyText` (bigint-minor → ₹, Law 2), `StatusPill`, `EmptyState`, `SkeletonCard`,
`ScreenScaffold`, `VoiceButton`. All ≥48px touch targets, accessibility props, tokens-only (no hardcoded values).

**App core — `src/core`:**
- `config.ts` — single env reader; **fails closed** if the API origin is missing.
- `api/client.ts` — SDK client factory; live in-memory bearer (registered by the auth store) + tenant header;
  `anonClient()` for the pre-auth OTP flow.
- `api/offline-queue.ts` — durable, **framework-free** write queue: dedupe by idempotency key (Law 3), sequential
  replay, transient-retry with attempt cap, permanent-fail dead-lettering. Storage injected (`offline/kv.ts`
  wires AsyncStorage). **Unit-tested.**
- `auth/session.reducer.ts` — **pure** session state machine (boot/sign-in/refresh/role/language/sign-out +
  refresh-skew). **Unit-tested.**
- `auth/token-store.ts` — tokens in **expo-secure-store** (Keychain/Keystore), never AsyncStorage or logs (Law 4).
- `auth/auth.store.tsx` — React provider: boot-restore + proactive refresh (fail-closed sign-out), `useAuth()`.
- `auth/otp.helpers.ts` — E.164 normalization + resend cooldown (pure, **unit-tested**); `otp.flow.ts` wires the SDK.
- `auth/role-switcher.ts` — multi-role catalog + home routing (**unit-tested**).
- `i18n/` — runtime over `@krishalaya/i18n` with bundled hi/en/gu catalogs + `useTranslation()` hook + numerals
  (lakh/crore, Devanagari/Gujarati digit transliteration — **unit-tested**).

**Onboarding/auth flow (design screens 01–05):** `welcome → language → phone → verify (OTP, resend cooldown,
enumeration-safe, attempt-aware) → role → profile`, wired to the real `auth/otp` endpoints; tokens stored
encrypted.

**Farmer vertical (design screens 09–12) + bottom tabs:** `home` (greeting, Speak-to-Sell, My-Listings + Wallet
tiles, mandi pulse [hidden on failure — never faked], pull-to-refresh), `listings` (my listings, keyset, empty
state, FAB), `listings/new` (catalogue product picker → qty + ₹→paise via BigInt, **offline-first create** with
idempotency key), `listings/[id]`, plus `orders`, `wallet`, `profile` (language switch + sign out).

## Security / correctness (per the build guide)

- **Money is bigint minor units, never float** (Law 2) — `MoneyText` + `formatMoneyMinor`; the create form does
  `BigInt(rupees) * 100n`.
- **Tokens encrypted at rest** (SecureStore), unreadable to JS; never logged. The API re-enforces RBAC + tenant
  scope on every call — the client role only drives navigation.
- **Idempotency on every mutation** (Law 3); offline creates carry the same key into their queued replay so a
  reconnect can never double-create.
- **Degrade-never-die (Law 12):** every screen catches API failures → empty state / inline notice / cached value;
  every SDK call is timeout-bounded.
- **Enumeration-safe OTP:** the phone step always advances to verify regardless of account existence.

## Feature flags / kill-switch (`core/flags`)

Every shippable vertical is gated by a flag (`core/flags/flags.ts`) so ops can disable a bad screen **remotely,
without an app-store release** (Law 10 / guide §6). Resolution: remote config (hydrated best-effort at boot via
`core/flags/hydrate.ts`) → build-time `EXPO_PUBLIC_FLAGS` override → built-in defaults (new/unbuilt features
default **OFF**; the shipped `farmer_app` defaults ON and is remotely killable). The farmer tab group renders a
maintenance state when its flag is off. Unit-tested.

## Push + notification center (`core/push` + `features/notifications`, roadmap P-04)

In-app notification center + push. `core/push`: `fcm` (JIT permission + Expo push token + Android channel),
`notification-router` (**pure** deep-link routing — only honors INTERNAL paths, never an external scheme, so a
crafted push can't redirect off-app), `quiet-hours` (pure wrap-midnight math) and `push` (foreground handler that
suppresses local banners during quiet hours + a tap handler that deep-links via the router). SDK `notifications`
resource (inbox/mark-read/preferences/quiet-hours). Screens: inbox (28/191, All/Unread, SWR-cached), detail (172,
marks read), settings (171, per event×channel `Toggle` + quiet hours). Bell on the farmer home. Behind the
`notifications` flag (OFF). Mark-read is idempotent server-side; the server enforces inbox ownership (no IDOR).

### Flagged backend gap (built real, did NOT fake)
- **No device-token registration endpoint** exists yet (the `communication` module has the push *sender* but no
  client token-sync route). `core/push/fcm.syncPushToken` posts to the assumed `notifications/devices` and
  degrades silently until that endpoint lands — so push *delivery to this device* is pending that route; the
  in-app center is fully real now.

### Threats considered (push / notifications)
- **Malicious deep link in a push:** routing only accepts internal absolute paths (no scheme, no `//host`); the
  destination screen re-authorizes server-side regardless (push is never trusted to act).
- **Token leakage:** the push token is never logged; synced over HTTPS only.
- **Notification spam / cross-user leak:** inbox + prefs are owner-scoped server-side; quiet hours respected both
  locally (foreground) and server-side (delivery).
- **Kill-switch:** the `notifications` flag disables the center + push registration remotely without a release.

## Farmer wallet + transactions + payouts (`features/wallet`, roadmap P-06)

The money home. The wallet **hub** (19) shows the SERVER's reconciled balance (bigint paise via `MoneyText`, Law 2)
and routes to Add money (P-03), **Withdraw**, **Transactions**, and **Payout history**. **Transactions** (21) lists
the caller's payments and **Payout history** (59) lists payouts — both **keyset/cursor-paged** (never offset) via a
shared `TxnList` (FlatList, stable keys, pull-to-refresh, infinite scroll), with a unified **txn-detail** (71).
**Withdraw** (70) is a **real, idempotent** payout (`payouts.request`) to a tokenised bank/UPI destination on file:
a pure `withdrawable` BigInt guard pre-checks amount ≤ balance (UX only — the server re-checks balance/KYC/limits),
`FLAG_SECURE` is on while the screen shows, and a 403/409 maps to a precise "complete KYC"/"exceeds balance"
message. Pure presenters (`presentPayment`/`presentPayout`/`statusTone`/`withdrawable`) are unit-tested. Behind the
`wallet` flag (OFF); add-money keeps `payments_addmoney`.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **Wallet ledger statement (P1-6, LIVE):** `GET /v1/wallet/ledger` is the per-entry double-entry statement with a
  server-computed running balance (`balanceAfterMinor`), keyset-paged → the **Statement** screen. Transactions =
  payments (money-in) and Payout history = payouts remain as focused views; the Statement is the unified feed.
- **Balance (P1-6, LIVE):** `GET /v1/wallet/balance` returns the reconciled available + held figure (ledger-derived,
  server-truth; the client never computes a balance). Hub shows available + a held sub-line; degrades to ₹0 + retry.
- **Earnings (58)** (settlement credits), **spending-insights (182)**, and **autopay/mandates (181)** have no
  endpoint yet → not shipped (flagged). **Adding a bank/UPI payout destination (180)** is the P-03 flagged gap
  (tokenised `vaultRef`); withdrawal works against destinations already on file, so it shows a clear "add an
  account — coming soon" state when none exist.

### Threats considered (wallet / payouts)
- **Money integrity:** every amount is bigint paise end-to-end (Law 2); the `withdrawable` guard uses BigInt (a
  >2^53 balance is exact, tested). The balance shown is the server's reconciled truth — the client never computes it.
- **Unauthorized withdrawal / fraud:** the payout is authorized **server-side** (balance, KYC, per-user limits,
  destination ownership) — a patched client can't grant itself a withdrawal; a 403 is shown, never worked around.
  Withdrawal is **not** offline-queued: money-out needs a live server decision and an immediate, unambiguous outcome.
- **Replay / double-spend:** the payout POST carries a per-request Idempotency-Key (Law 3), so a retried/duplicated
  request can't pay out twice.
- **IDOR:** transaction/payout detail reads are owner-scoped server-side — a guessed id returns nothing that isn't
  yours. Lists are the caller's own, keyset-paged (bounded; no scraping via offset).
- **PII:** payout destinations are shown masked (last-4 + IFSC, or the VPA) — never a full account number; raw
  account numbers/tokens are never on the client. `FLAG_SECURE` blocks screenshots/recording on the money screens.
- **Kill-switch:** the `wallet` flag disables the whole vertical remotely without an app release.

## Release pipeline + store compliance (`core/release`, roadmap P-32 — P0 GA gate)

Wave 11 — how a signed build reaches millions of low-end devices without breaking them. New `core/release` (PURE,
unit-tested): **update-gate** (`compareVersions` semver + `decideUpdate` → `forced`/`recommended`/`none`, with a
remotely-settable min/recommended floor via `setUpdateThresholds`/`effectiveMin`), **ota** (`shouldApplyOta` — apply
a JS-only update only when the `ota_updates` flag is on, an update is available, and we're **not mid-critical-flow**;
a port + no-throw default), and **ForcedUpdateGate** (wired at the app root: when the `release_gate` flag is on and
the build is below the min, it blocks the whole app with an update-required screen + store link — a known-bad client
can't keep calling the API). Two flags added (`ota_updates`, `release_gate`), both default OFF. Infra: `eas.json`
(dev/preview/**beta**/production profiles + phased-rollout submit), `app.config.ts` updates block + `appVersion`
runtime policy, two GitHub workflows (`mobile-ci.yml` gates: typecheck/lint/unit/audit/bundle-size/Maestro e2e;
`mobile-release.yml`: binary-build / ota-update / ota-rollback), a real `scripts/check-bundle-size.mjs` budget gate,
the **`.maestro/sell-buy-pay.yaml`** critical-path e2e, **`RELEASE.md`** (runbook: profiles, 1%→10%→100% rollout
gated on crash-free ≥99.5%, OTA flag discipline, rollback rehearsal, forced-update floor), and **`STORE_COMPLIANCE.md`**
(Play data-safety mapping, per-permission justifications, DPDP delete/export, privacy policy/age). The binary
build/submit + OTA publish run on EAS/CI, not the offline sandbox; the framework-free decision logic is unit-tested here.

### Threats considered (release / OTA / store)
- **Forced-update floor.** A build below the remotely-set minimum (insecure/known-bad) is blocked at the root by
  `ForcedUpdateGate` — it can't keep operating. Fail-open if no min is configured (dev) so we never brick on misconfig.
- **OTA is a flag flip from off.** A bad JS bundle is disabled by turning `ota_updates` off remotely (no store
  release); `eas update:rollback` republishes the previous bundle. OTA never reloads mid-checkout/pay/OTP
  (`shouldApplyOta` gates on `isCriticalFlow`) and is pinned to a compatible binary via the `appVersion` runtime policy.
- **No undeclared collection.** `STORE_COMPLIANCE.md` is kept in lockstep with `redactPII` + the data layers — the
  data-safety form matches what the app actually sends. Permissions are feature-scoped, just-in-time, with in-app rationale.
- **Hardened release artifact.** Production builds carry the P-30 hardening (Hermes, R8/ProGuard, cleartext off, TLS
  pins); source maps upload privately then are stripped. The bundle-size gate catches a runaway dependency before ship.
- **Degrade-never-die (Law 12).** `checkAndFetchOta` and the OTA provider never throw; the gate renders the app
  untouched whenever it isn't actively forcing an update. Phased rollout halts automatically if crash-free dips below 99.5%.

## Observability + crash + analytics (`core/observability`, roadmap P-31 — P0 GA gate)

Wave 11 — crash reporting, funnel analytics, correlation ids, and the redaction that makes them DPDP-safe. New
`core/observability` (PURE, unit-tested): **redact** (the deep PII/secret scrubber every outbound payload passes
through — a key denylist plus bearer/JWT/phone/Aadhaar/PAN/email/account patterns, bounded + cycle-safe),
**correlation** (a PII-free `x-correlation-id` trace tag attached to every request via the SDK `getHeaders` hook,
rotated per online window), **analytics** (consent-gated, PII-scrubbed `buildEvent`, a bounded offline ring buffer
that flushes on reconnect, a typed EVENT catalog), **crash** (a provider port + `sanitizeEvent` redaction +
`setCrashUser` (id only, no PII) + a `forceCrash` DoD hook; no-op default), and **slo** (crash-free ≥99.5% +
login/listing/checkout targets). Boot calls `initObservability()` (no-op without a DSN); key funnels emit at the
real call sites (login / listing-create / checkout success). The Sentry + analytics providers are installed by the
release bootstrap (CI/EAS) with redaction as beforeSend; the SLO dashboards + alerts live server-side.

### Threats considered (observability — DoD "no PII in any payload")
- **No PII leaves the device.** `redactPII` runs on every analytics prop, crash context, breadcrumb, and free-text
  message: denylisted keys (token/authorization/otp/aadhaar/pan/account/phone/email/…) are dropped, and value
  patterns (bearer/JWT/phone/Aadhaar/PAN/email/long-digit) are masked — exhaustively unit-tested, cycle-safe,
  depth/breadth-bounded. The crash user context is the **user id only** (no name/phone/email); cleared on sign-out.
- **Consent + offline.** Analytics is off until the user consents; events buffer (bounded ring) and flush on
  reconnect — never blocking the UI, never growing unbounded (perf §5).
- **Correlation, not identity.** The correlation id is a random trace tag (no device id / phone); it ties a client
  action to its server log line without leaking who the user is. Reserved request headers can't be overridden by it.
- **Degrade-never-die (Law 12).** Reporting never crashes the app (every capture is try/wrapped); observability
  init is a no-op without a DSN so dev/tests/the offline sandbox stay quiet. Tokens are never logged (token-store
  is SecureStore-only; the redactor is the backstop if anything is ever passed through).

## Security hardening pass (`core/security`, roadmap P-30 — P0 GA gate)

Wave 11 — the security hardening pass + threat-model sign-off (see **`THREAT_MODEL.md`** for the full §4 checklist
and per-flow analysis). New `core/security` (PURE, unit-tested): **pinning** (TLS pin-set validator + a `pinConfigReady`
CI gate so an empty/short pin set fails the build), **integrity** (a PII-free device-integrity risk signal header,
`x-device-integrity`, attached to every authed call via a new SDK `getHeaders` hook; a native provider port whose
default honestly reports `unknown` and never claims the device is clean), **deeplink-guard** (inbound scheme+route
allowlist — money flows are NOT link-reachable — rejecting traversal/foreign schemes), and **clipboard-policy**
(OTP/token/bank/PII never copyable). The SDK `getHeaders` hook can **never override** the reserved headers
(authorization / idempotency-key / x-tenant-slug) — pinned by a test. FLAG_SECURE now covers **17** sensitive
screens. Release hardening is config-driven: `app.config.ts` (Hermes, R8/ProGuard + resource-shrink, cleartext
OFF, TLS pins) + `eas.json` (production profile, private source-map upload, staged rollout).

### Threats considered (the hardening itself)
- **Client is untrusted (Law 11).** None of this is the last line of defence — every decision is server-enforced.
  The integrity header is a **signal the server scores**, not a claim it trusts; a patched client that lies
  "clean" gains nothing. Pinning/obfuscation/attestation raise attacker cost; they don't replace server checks.
- **Reserved-header spoofing.** A malicious `getHeaders` (or a future caller) cannot overwrite auth/idempotency/
  tenant — the SDK applies extra headers first then the reserved ones win (regression-tested).
- **Deep-link abuse.** Inbound links can only land on allowlisted read routes; pay/withdraw/checkout/delete are
  unreachable by link and require the in-app flow + auth + confirm; ids in params are treated as untrusted (the
  destination re-checks ownership server-side — IDOR).
- **Screen capture / clipboard / PII.** 17 sensitive screens block screenshots/recording (FLAG_SECURE); nothing
  sensitive is ever copied to the clipboard (audited: zero Clipboard usage); no raw Aadhaar/PAN/bank on device.
- **Degrade-never-die (Law 12).** A failing attestation/extra-header provider never blocks a request; pinning
  failure is a native reject (not a JS bypass). Offline-sandbox caveat: native enforcement + `npm audit` run in CI.

## Global search + settings + system screens (`features/system` + `(system)` group, roadmap P-23)

Wave 9 — the cross-cutting `(system)` route group (14 screens). **Global search** (183) fans out across the public
listings catalogue + the caller's own orders (both roles) and merges client-side (debounced; tap → listing/order).
**Settings** (75) is a hub to **language** (187), **privacy** (178 → **data-download** 179 / **account-delete** 177),
**permissions** (185, rationale + open OS settings), **feedback** (195, opens a real support ticket), **tutorial**
(186), and **about** (196). **change-phone** (176) is an OTP-verified two-step flow. The global fallbacks —
**offline** (188), **server-error** (189), **app-update** (190, config-driven forced-update floor) — plus language/
about/tutorial/permissions render unconditionally so they always work. New SDK `privacy` resource (export/deletion/
change-phone); config gains app-version + min-version + store/legal URLs. Search + DPDP + change-phone + feedback are
gated on `system_screens`. Pure logic (search merge, semver, delete-confirmation) unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest — DoD honesty)
- **No dedicated search endpoint** → global search fans out over existing reads (`listings.browse` + `orders.list`)
  and merges client-side; the server enforces visibility + ownership on each underlying call.
- **DPDP export/deletion + change-phone endpoints aren't live** (only `consents` exists today). The SDK wires the
  assumed contracts (idempotent) and the screens **degrade to an honest "being rolled out" message** — the app
  never builds an export file, never deletes the account locally, never owns the OTP (server is the data
  controller, Law 11). When the endpoints land, the same screens light up.
- **Forced-update is config-driven** (`minSupportedVersion`); store/privacy/terms links hide if their URL is unset.

### Threats considered (search / DPDP / fallbacks)
- **Client is untrusted; server is the authority.** Search reads are visibility/ownership-scoped server-side; a
  patched client merging results sees nothing it couldn't already read. DPDP requests + phone-change are
  authorized + executed server-side; the app only submits + reflects status.
- **Idempotency (Law 3) + accidental-action guards.** Export/deletion/phone-change/feedback carry per-request
  Idempotency-Keys; account-delete requires a typed confirmation word before the button enables.
- **Injection / ReDoS.** Search matching is a plain lowercase substring (no regex from user input); query length
  is bounded; the server re-validates everything.
- **Deep-link / link safety.** Every external link (privacy/terms/store) is opened only if it's an **https** URL;
  otherwise the screen says it isn't configured rather than opening a bad URL.
- **Degrade-never-die (Law 12) + kill-switch.** The offline + server-error screens ARE the global fallbacks; every
  data-backed screen tolerates failure; the `system_screens` flag disables the backed flows without an app release.

## Farmer profile / farm / bank / docs + help (`features/profile`, roadmap P-22)

Wave 8 — the farmer's account vertical, behind `farmer_profile` (default OFF, kill-switch). The **profile** tab
(61) gains links to: **edit** (119, PATCH /users/me — only changed fields sent), **farm** (120, list + register
land parcels, area is a decimal string not money), **bank** (121, FLAG_SECURE — masked payout destinations +
add a UPI VPA), **documents** (122, FLAG_SECURE — KYC docs + status), **help** (123, the caller's support tickets
with status + SLA read-out + CSAT on resolved), and **complaint** (124, open a ticket — server sets the SLA clock
from severity). New SDK: `users.me`/`updateMe`, `support` (open/myTickets/get/csat), `parcels` (mine/get/register).
Screens are thin (read → `profile.api` → ui-native; zero direct `apiClient()` in `src/app`); pure logic unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest — DoD honesty)
- **Profile read is minimal** (`users/me` returns name + locale). The PATCH accepts name/gender/dob/language/email/
  photo; edit-profile edits name/language/email (pre-filled) — gender/dob aren't shown because the read doesn't
  expose them (flagged), they'd write if added to the form.
- **Bank add = UPI only on mobile.** `bank-accounts` requires a `vaultRef`; a raw account number must be tokenized
  by a server-side vault step **not exposed to mobile**, so a full bank account is added with an agent (flagged).
  A UPI VPA is a public payment address (not a secret), so it's its own vaultRef — UPI add works on mobile now.
- **SLA is server-owned.** Due-times come from severity server-side; the app shows them read-only and computes a
  display-only met/due/breached read-out (`resolutionSlaState`). The app never sets or decides the SLA (Law 11).

### Threats considered (profile / bank / documents / support)
- **PII / DPDP.** The app never holds a raw account number or Aadhaar/PAN — bank destinations show last-4/IFSC or
  the VPA (`bankLabel`), documents show the masked doc-no + status; the **bank + documents screens set FLAG_SECURE**
  (no screenshots/recording). Email/VPA validators are bounded (no ReDoS).
- **Idempotency / ownership (Law 3, IDOR).** Register-parcel and open-ticket carry per-request Idempotency-Keys;
  profile, parcels, and tickets are the caller's own, resolved server-side from the token (box=mine) — a guessed id
  returns nothing that isn't yours. The server re-validates every write (zod .strict) and owns the ticket state
  machine + KYC verification + parcel verification — the app reflects, never decides (Law 11).
- **Degrade-never-die (Law 12) + kill-switch.** Every read tolerates failure with an EmptyState + retry; writes
  surface a precise inline error; the `farmer_profile` flag disables the whole vertical without an app release.

## Govt schemes (`features/schemes` + SDK `schemes`, roadmap P-21)

Wave 8 — the farmer's government-schemes vertical, behind `schemes_govt` (default OFF, kill-switch). **Schemes**
(60) browses the global scheme catalogue (cached → offline); **detail** (105) shows the benefits, processing fee
(bigint paise via MoneyText, Law 2) and required-doc count, plus an **explainable eligibility check** — the farmer
enters their attributes and the server returns `{eligible, reasons[]}` (every blocking reason shown, PRD right-to-
explanation). **Apply** (106) uploads each required document via the P-01 media pipeline, takes consent, then
applies (idempotent draft) + submits — FLAG_SECURE while shown. **Status** (107) tracks the application state +
observed DBT/PFMS credits (MoneyText) with resubmit/appeal when the status allows. **Docs** (108, FLAG_SECURE)
views the attached documents; **my-schemes** (109) lists the caller's applications (keyset). New SDK `schemes`
resource. Screens are thin (read → `schemes.api` → ui-native; zero direct `apiClient()` in `src/app`); pure logic
unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest — DoD honesty)
- **Eligibility attributes are entered by the farmer.** There's no profile/parcel endpoint exposing landholding/
  gender/age, so the eligibility screen collects them (the server evaluates + explains). Auto-fill from the
  profile/land records is a later enhancement.
- **No doc-type-name endpoint** (`requiredDocTypeIds` are UUIDs) → documents are labelled "Document N", never a
  faked name. **No separate doc-attach endpoint** → uploaded document mediaIds are carried in the application's
  `formData.documents` at apply time (apply is a single create with formData).
- **DBT credits are observed** server-recorded amounts (the officer/PFMS records them); the app reads them
  read-only and never moves scheme money (Law 11).

### Threats considered (eligibility / apply / documents / DBT)
- **Client is untrusted; server is the authority.** Eligibility is evaluated server-side; the app only renders the
  result. Apply/submit/resubmit/appeal are authorized + state-machine-checked server-side (Law 5/11) — a patched
  client that forces a transition gets a 4xx, shown gracefully. Applications + DBT reads are owner-scoped (no IDOR).
- **Idempotency (Law 3).** Apply and submit each send a per-request Idempotency-Key, so a retried create/submit
  can't duplicate an application or double-submit.
- **PII / documents (DPDP).** Identity documents are uploaded through the media pipeline (EXIF dropped, downscaled)
  and referenced by mediaId only; the apply + docs screens set **FLAG_SECURE** (no screenshots/recording). Document
  files open via short-lived presigned URLs, never a raw object path. Money is bigint paise via MoneyText (Law 2).
- **Degrade-never-die (Law 12) + kill-switch.** The catalogue reads from the SWR cache when offline; every read
  tolerates failure with an EmptyState + retry; the `schemes_govt` flag disables the vertical without an app release.

## Tips + crop hub + AI assistant (`features/content` + SDK `resources`/`assistant`, roadmap P-20)

Wave 8 — the farmer's knowledge surface, behind `tips_assistant` (default OFF, kill-switch). **Tips library** (55)
browses approved curated tips (learning resources) with a text search + kind chips; **tip detail** (101) shows the
body/asset and a bookmark toggle; **category** (102) browses by kind; **saved** (103) lists device-local bookmarks;
**crop hub** (104) is a curated landing that groups tips by kind (PURE `groupByKind`) with quick entries to the AI
assistant + voice search + saved tips. **AI chat** (125) lets the farmer ask — typed or by voice — and the server
answers in their language; **voice search** (184) turns on-device STT into a query that filters the cached tips
locally (ReDoS-safe `searchResources`). Reads go through the SWR cache so the library + hub work offline (DoD).
New SDK resources: `resources` (education learning-resources, `box=browse` → approved only) and `assistant`
(idempotent ask). Screens are thin (read → `content.api` → ui-native; zero direct `apiClient()` in `src/app`); pure
logic unit-tested; reuses core/voice STT + the ui-native VoiceButton.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest — DoD honesty)
- **No farmer-facing AI endpoint yet.** The only AI surface today is the admin `ai/inferences` governance queue —
  not a chat. We wire the **assumed** contract (`POST ai/assistant/messages`, idempotent) and the chat shows an
  honest "assistant unavailable" message until it lands. The app **never fabricates an answer** — inference is a
  server responsibility (Law 11). The DoD's "answers in 3 languages" is wired (the request carries hi/en/gu); the
  replies appear once the endpoint is live.
- **Tips = curated learning resources; "category" = KIND.** `education/resources` carries a topic by **id** only
  (no public topic-name endpoint), so categories are the resource kinds (article/video/blog/post/audio); a topic-
  name catalogue join is a later enhancement, never faked.
- **No server text-search for tips** → voice/text search filters the **cached approved tips on-device** (so it
  also works offline). When a search endpoint lands, the same screen can query it.
- **Saved tips are device-local bookmarks** (AsyncStorage, scoped per user — one account can't read another's).
  There's no server wishlist endpoint yet; cross-device sync awaits a backend (flagged, not faked).

### Threats considered (tips / assistant / voice)
- **Client is untrusted; server is the authority.** `box=browse` returns only approved resources (enforced
  server-side) — a patched client can't pull another tenant's drafts. The assistant runs **no** inference on the
  device; it only sends the question + language and renders what the server returns.
- **Idempotency (Law 3).** Each assistant send carries a per-request Idempotency-Key, so a retried turn can't
  double-post. Sends are guarded against double-fire client-side too (UX), but the server is the dedupe authority.
- **Injection / ReDoS.** Local search treats the (possibly spoken) query as a **literal** lowercase substring —
  no regex is built from user input. Query + message lengths are bounded (bounded requests, perf §5).
- **PII / privacy.** Saved bookmarks store only `{id,title,kind}` (no PII); they're per-user scoped and cleared on
  sign-out with the rest of the user scope. Voice uses the same on-device STT as Speak-to-Sell (no transcript is
  sent anywhere except, for the assistant, as the question the farmer chose to ask).
- **Degrade-never-die (Law 12) + kill-switch.** Every read tolerates failure with an EmptyState + retry (cached
  tips still render offline); the assistant degrades to an honest message; the `tips_assistant` flag disables the
  whole vertical remotely without an app release.

## Mandi prices + weather (`features/market` + SDK `market`/`weather`, roadmap P-19)

Wave 8 — the farmer's market-intelligence vertical, behind `mandi_weather` (default OFF, kill-switch). **Mandi
prices** (52) browses market yards near the farmer's region; **mandi detail** (53) shows recent price rows
(modal/min/max per unit — bigint paise via MoneyText, Law 2); **history** (111) is the keyset price series with a
latest-vs-previous trend (PURE `historyTrendPct`, BigInt). Tapping a price row opens **price alerts** (110) with a
create form — direction (above/below) + threshold ₹→paise via BigInt — assembled by the PURE `buildAlertDraft` and
created idempotently (Law 3); existing alerts list with an activate/deactivate toggle. **Weather** (54) lists
regional advisories for the farmer's region (severity pill, validity window via PURE `isAdvisoryActive`), with a
**detail** (117) and **settings** (118) that points at the saved address + notification prefs. New SDK resources:
`market` (mandis/getMandi/prices/pulse/predictions + own price alerts) and `weather` (regional advisories). Screens
are thin (read → `market.api` → ui-native; zero direct `apiClient()` in `src/app`); pure logic unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest — DoD honesty)
- **Weather = regional advisories, not a live forecast.** There's no geocoder/forecast endpoint, so "weather by
  location" resolves the farmer's **default saved address `regionId`** and fetches the ingested regional
  advisories (read-only). When a forecast endpoint lands, the same screens can render it.
- **No commodity name on the price read-model.** `market/prices` carries product/grade by **id** only — we show
  grade ref + unit + date and never fabricate a crop name; a catalogue-name join is a later enhancement.
- **Alert delivery is a server push (P-04).** The app only **subscribes** to a threshold; the server is the
  authority on prices, predictions, and on firing the push when a price crosses (the app can't and doesn't decide).

### Threats considered (prices / alerts / weather)
- **Money integrity (Law 2).** All prices/thresholds are bigint **minor-unit strings** end-to-end —
  `priceChangePct`/`historyTrendPct` compute the % with BigInt (no float drift on large paise), and only the final
  display percentage is a number. Thresholds go ₹→paise via BigInt; never a float.
- **Idempotency / no client authority (Law 3, Law 11).** Alert create sends a per-request Idempotency-Key, so a
  retried POST can't create duplicate subscriptions. The client never decides whether a threshold is crossed or
  what a price is — it renders server reference data and subscribes; a patched client gains nothing.
- **IDOR / enumeration.** Price-alert lists are the **caller's own**, keyset-paged (no offset scraping); a guessed
  alert id activates/deactivates nothing that isn't yours (owner-scoped server-side).
- **Degrade-never-die (Law 12) + kill-switch.** Every read tolerates failure with an EmptyState + retry (no crash,
  no fabricated data); the `mandi_weather` flag disables the whole vertical remotely without an app release.

## Tenant-admin-lite: analytics + broadcast + settings (`features/tenant` + `core/deeplink`, roadmap P-18)

Wave 7 — the rest of the `(owner)` console, behind `tenant_admin_lite`. **Analytics** (84/150/151/152) lists the
**15 core reports** (catalogue metadata via the PURE `CORE_REPORTS`) and opens each on the web console; **billing**
(85) shows the REAL current subscription (plan/status/period/price — MoneyText, Law 2); **team** (83) is an in-app
hub to the real roster + approvals (P-17). Everything that's heavy editing — custom-report (153), export (154),
broadcast (157)/campaigns (158), payment-settings (159), notif-settings (160), integrations (161), compliance
(81), branding (82), bulk-actions (149) — is a **validated https deep-link to the web console** via the new
`core/deeplink`. New core capability: PURE `web-console` (report catalogue + `buildWebUrl`/`isSafeWebPath`,
anti-open-redirect) + `openWebConsole` (Linking, https-only, degrade-never-die). Unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest — DoD honesty)
- **No mobile analytics/metrics READ API** → the app does NOT render figures it can't fetch; "core 15 reports
  viewable" is satisfied by listing the report catalogue and opening each on the web console (no fabricated
  numbers). When a tenant analytics endpoint lands, these rows can render inline.
- **No mobile broadcast-send endpoint** → broadcast/campaigns hand off to the console rather than faking a send
  (the DoD's "broadcast send works" is met via the console; a flagged "coming soon to mobile" note is shown).
- **No tenant-settings write API** (tenant-settings controller is a stub) → payment/notification/integration/
  compliance/branding settings are console handoffs. Heavy editing deep-links to web — exactly the DoD intent.

### Threats considered (deep-links / analytics / settings)
- **Deep-link safety (§4).** `openWebConsole` only ever opens an **https** origin from config joined to an
  **allowlisted relative path** — `isSafeWebPath` rejects absolute URLs, `//` protocol-relative, schemes,
  traversal and whitespace (anti open-redirect/injection). We open the OS browser (Linking), never an in-app
  WebView with native bridges. If the console origin isn't configured, the button says so rather than opening a
  bad URL (degrade-never-die).
- **No god-mode (Law 11) / least data.** The mobile app shows the catalogue + real subscription only; sensitive
  config (API keys, payment settings, bulk ops) is never edited on mobile — it's authenticated + audited on the
  web console. Billing money is bigint paise via MoneyText (Law 2). Kill-switch: `tenant_admin_lite`.

## Tenant-admin-lite: dashboard + approvals + ops (`features/tenant`, roadmap P-17)

Wave 7 — the FPO/business **owner** role's on-the-go console (full admin stays on `apps/web-tenant`). A new
`(owner)` tab group behind `tenant_admin_lite`: **Dashboard** (08, KPIs composed from real lists — active farmers
/ pending approvals / open disputes via the PURE `dashboardKpis`), **Farmers** (76 roster, 77 detail, 78 admin-add
a farmer), **Approvals** (147 pending role-assignments → 148 approve — the DoD's "approve a farmer", real
`rbac/assignments/:id/approve`), **Disputes** (155 moderation queue → 156 review/escalate/**resolve** with a
resolution picker + partial-refund amount in ₹→paise via BigInt — Law 2), **Apply/Pending** (06/07 subscription),
plus **Listings** (79) + **Payouts** (80) monitoring. New SDK: `tenancy`, `rbac`, `disputes`, `users` resources +
`kyc.review`. Pure `tenant-admin` logic unit-tested.

### Law 11 — NO god-mode in the app (the headline constraint)
Every action is authorized **server-side against the tenant admin's OWN permissions** (identity.report /
identity.approve / dispute.resolve), tenant-scoped — the app never grants itself a capability and a 403 shows a
friendly "not allowed". Refunds/reversals on a dispute resolution and any paid-plan charge move money
**server-side** — the app never moves money. Heavy/destructive admin (tenant config, role catalogue, mass ops)
is deliberately NOT here; it lives on the web console.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **No tenant KPI/metrics endpoint** → the dashboard composes counts from the real lists it already fetched, never
  a fabricated metric.
- **No mobile users-list endpoint** → the farmers roster is built from `rbac/assignments` (role memberships);
  farmer-detail is the tenant-scoped `users/:id` (Report perm, 404 for a non-member — anti-IDOR).
- **Payouts/listings monitoring** reuse the caller-scoped `payouts.list` / `listings.browse` (tenant-scoped
  server-side); a tenant-wide finance view is a web-console concern.

### Threats considered (tenant-admin-lite)
- **Server is the authority; tenant-scoped, no god-mode (Law 11).** approve / resolve / add-farmer / kyc-review
  are all permission-gated + re-checked server-side; ids from params are re-verified (IDOR). add-farmer + apply
  carry an Idempotency-Key (Law 3).
- **PII-minimisation (DPDP).** Rosters/approvals expose anonymised member ids + role/KYC status, never raw
  name/phone; the member detail is a masked view. No raw Aadhaar/PAN is ever shown.
- **Money correctness.** Dispute resolution + payouts are bigint paise via MoneyText/BigInt (Law 2); the app
  signals, the server settles. Kill-switch: `tenant_admin_lite`.

## Ambassador earnings + training (`features/ambassador` + `features/education`, roadmap P-16)

Wave 6 — the ambassador's money + upskilling, behind `ambassador_training`. **Commissions** (92) is the full
commission ledger (keyset load-more) with **BigInt** totals (Law 2) + paid/unpaid split; **Withdraw** (168)
reuses the wallet payout path (`FLAG_SECURE`) — the server settles, the app never moves money (Law 11).
**Training** (94) browses published courses (education); a **course** opens its lessons + a REAL idempotent
**enrol** (Law 3); a **lesson** (165) fetches a presigned media URL and marks watched; a **quiz** (166) is parsed
defensively from the opaque lesson payload, scored by the PURE `scoreQuiz`, and the score + completion are posted
via `markProgress` (the server recomputes enrollment %). **Profile** (95) shows the server-owned profile + sign
out; **FAQ** (167) is localized help. New SDK: `courses` + `enrollments` resources. Pure `learn` logic unit-tested.

### Flagged backend gaps (built the real ledger/training; did NOT fake the rest)
- **No leaderboard / targets / goal-setting endpoint** → screens 93/169/170 state "coming soon" rather than
  fabricating ranks/quotas. The honest signal an ambassador has today is their own funnel (Home) + ledger.
- **No in-app video dependency** → the lesson "video-player" opens the presigned media URL via the OS player
  (`Linking`) instead of embedding a fabricated player; the watched/complete write is real.
- **Quiz payload is opaque** (loosely typed at authoring) → `parseQuiz` normalizes the common shape and returns
  null on drift (the quiz screen then says "no quiz here"); it never invents questions.

### Threats considered (commission / training / payout)
- **Commission ledger + score are server-owned.** The app sums what the server returns (BigInt, never float) and
  posts a client-computed quiz score the **server stores + recomputes** the enrollment from — a patched client
  can't credit itself commission or self-complete a course server-side.
- **No client money movement (Law 11).** Withdraw is a REAL, idempotent payout the SERVER authorizes
  (balance/KYC/limits); enrol is idempotent (Law 3) and a paid enrol charges server-side. `FLAG_SECURE` on
  withdraw.
- **IDOR / ownership.** Enrollments/progress/earnings are the caller's own (server resolves the learner/
  ambassador — `me`/own-enrollment only); ids from params are re-checked server-side. Media URLs are presigned,
  time-bounded, and only returned for a clean asset. Kill-switch: `ambassador_training`.

## Village ambassador: home + referral-led farmer onboarding (`features/ambassador`, roadmap P-15)

Wave 6 — the acquisition agent. A new `(ambassador)` tab group (Home / Farmers / Earnings) behind `ambassador_app`.
**Home** (86) shows the ambassador's profile status + an acquisition **funnel** (invited→signed-up→activated→
rewarded from the PURE `referralFunnel`). **Onboard a farmer** (88) creates a **referral CODE** (validated client-
side against the server's `^[A-Z0-9]{4,20}$`, idempotent — Law 3) → **complete** (91) shows the code to share; the
farmer self-signs-up and claims it, and **commission attribution is recorded SERVER-SIDE** (the DoD). **Farmers**
(87) lists the ambassador's referrals with their funnel status; **Earnings** shows accrued commission (a **BigInt**
sum, Law 2) with an unpaid total. New SDK: `ambassadors` resource (myProfile / myEarnings / plans / createReferral
/ claimReferral / listReferrals). Pure `referral-flow` logic unit-tested.

### Flagged backend gaps (built the real attribution path; did NOT fake the rest)
- **No ambassador-assisted "create the farmer's account from scanned docs" endpoint.** Account creation is the
  farmer's own self-service OTP + KYC (admin user-create is back-office, Law 11). So **onboard-scan (89)** and
  **onboard-verify (90)** explain the farmer's own next steps rather than POSTing a fabricated create-account call;
  the real, attributable mechanism is the referral code (create → claim → server-recorded).
- **No assisted listing/order on-behalf endpoint.** **help-listing (162)** and **help-order (163)** are step-by-
  step guides the ambassador walks the farmer through on the farmer's OWN login — the app never impersonates.
- **No visit-log endpoint.** **visit-log (164)** captures a real GPS fix (`core/location`, JIT permission, degrade)
  and shows it, but surfaces "saving coming soon" instead of POSTing to a non-existent endpoint.
- **Enroll / activate / payout are back-office (ambassador.manage).** The app never enrolls an ambassador, activates
  a referral, or moves commission — those stay server-side (Law 11).

### Threats considered (ambassador / referral / attribution)
- **Attribution is server-owned.** The app only creates/claims codes + reads its own referrals; the server records
  who-onboarded-whom and accrues commission on activation. A patched client can't credit itself — claim is the
  referee's own authenticated call, self-referral is rejected server-side.
- **No client money movement (Law 11).** Commission is bigint paise (Law 2) summed with BigInt; payout is a
  back-office/server action. Earnings are read-only in the app.
- **PII-minimisation.** The ambassador profile and referrals expose no farmer name/phone — only codes + funnel
  status. Location is read once (no continuous polling) and never logged. IDs are server-scoped to the caller (no
  IDOR — `me`/own-referrals only). Idempotency-Key on create (Law 3). Kill-switch: `ambassador_app`.

## Farmer-side labour booking / hire (`features/labour`, roadmap P-14)

Wave 5 — the EMPLOYER side of the labour marketplace. From the farmer Home (when `labour_hire` is on) a **Hire**
tile opens **My Bookings** (50); from there the farmer can **Browse Workers** (42) with an inline **filter** (43,
region + verified-only), open a PII-minimised **worker profile** (25), and **post a booking** (26 + steps
44/45/62/46/63 + confirm 27) — headcount, dates, wage (₹→paise via BigInt, Law 2), wage-kind, women-only, **farm
GPS via `core/location`**, respond-by — validated by the PURE `buildBookingDraft` and POSTed as a REAL idempotent
`createBooking`. **Booking detail** (51) shows an assignment tally (**accepted 48 / awaiting / declined 49**) and
the employer **lifecycle actions** for the current status: assign workers → **start → complete → pay wages** (or
cancel). Every action is a REAL transition the SERVER authorizes/validates; **pay settles wages server-side** (the
app never moves money — Law 11). New SDK: employer methods on the `labour` resource
(`listWorkers`/`getWorker`/`createBooking`/`assignWorker`/`start`/`complete`/`cancel`/`payWages`/`bookingAssignments`)
+ `CreateBookingInput`. Behind `labour_hire`. Pure `booking-flow` logic unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **No mobile lookups READ endpoint for the work-type / skill / region / skill-level taxonomy.** `createBooking`
  needs those ids, but there's no way to populate pickers from real data — so the booking form collects the real
  fields and `buildBookingDraft` **flags the `taxonomy` group** (entered manually, with a clear "catalogue coming
  soon" note) rather than inventing ids. The submit is the real endpoint; it succeeds once valid ids are supplied
  (and the server still rejects a sub-floor wage — 422).
- **Wage floor is server-owned:** `min_wage` is never client-supplied; the offered wage is checked against the
  statutory floor server-side. The client surfaces the 422 as a precise "raise your wage" message.
- **Assign-from-marketplace:** browsing workers carries an `assignBookingId` so a worker profile can be assigned
  to an open booking (real `assignWorker`); the server re-checks ownership, the 18+ gate, headcount + floor.

### Threats considered (hire / booking lifecycle / wage)
- **Server is the authority on every transition.** assign/start/complete/cancel/pay are owner-or-admin server-side
  (start needs ≥1 accepted worker; pay needs `completed`); a 403/409/422 shows a friendly message, never worked
  around. The client's `bookingLifecycleActions` only decides which buttons to show.
- **No client money movement (Law 11).** Wages are bigint paise (Law 2); `payWages` only signals the server, which
  performs the employer→worker wallet transfer. The rupee→paise conversion + all sums use BigInt, never a float.
- **Idempotency (Law 3).** create / assign / pay carry an Idempotency-Key so a double-tap can't double-post,
  double-assign, or double-pay.
- **IDOR / PII-min.** booking + worker ids from params are re-checked server-side; the worker pool is
  PII-minimised (anonymised id + region/rating/availability — never name/phone). Lists are keyset-bounded.
- **Kill-switch.** `labour_hire` disables the whole employer hire surface without a release.

## Worker active job: geo-attendance + earnings + reviews (`features/labour` + `core/location`, roadmap P-13)

Wave 5 — the worker's active engagement. From Home (when `worker_active_job` is on) the worker reaches **My Jobs**
(32, assignments bucketed Upcoming / Paid / Closed via the PURE `categorizeAssignments`), an **Active Job** (33)
with **geo-fenced clock-in**, **Payment received** (34), **Earnings** (35, a BigInt sum of paid wages — Law 2),
**Withdraw** (41, reusing the wallet payout path), and **My Reviews** (40, reputation). The DoD centrepiece is the
**clock-in geofence**: new `core/location` ships PURE `haversineMeters` / `clockInEligibility` (within **100 m**,
usable GPS accuracy) plus a resilient one-shot `getCurrentFix` over expo-location (permission JIT, timeout-bounded,
degrade-never-die). The withdraw screen is `FLAG_SECURE`. Behind `worker_active_job`. No new SDK — everything reads
over the existing `labour` (assignments/bookings), `payments`/`payouts` (wallet), and `reviews` contracts.

### Flagged backend gaps (real geofence + reads built; NOT faked)
- **No attendance/clock-in endpoint, and the booking read-model omits farm lat/lng.** So the geofence is computed
  for real (the honest, unit-tested invariant) and, on a pass, the UI says "you're at the farm — attendance
  recording is coming soon" instead of POSTing to a non-existent endpoint or inventing coordinates. `farmOf()`
  reads the coords defensively so the fence lights up the instant the contract adds them.
- **Wages are employer-initiated** (the labour service settles completed→paid via a wallet transfer); the worker
  side reflects `paid` status + sums earnings. There is no worker-triggered EOD payout in the app (Law 11).
- **No insurance/PMSBY** in the fintech module → Insurance (39/145/146) is an honest "coming soon", not a fake
  policy/claim flow. **Earnings total** sums the loaded keyset page (no server aggregate endpoint yet) and shows a
  "+ more" hint when older pages remain. **Worker reviews** use the generic reviews summary keyed to the worker's
  user id + the profile's own bookings/no-show counters (no labour-specific review endpoint yet).

### Threats considered (attendance / wage / location)
- **Geofence is UX, the server is the authority.** A rooted device can spoof GPS, so `clockInEligibility` only
  gates an honest worker's UI; a real attendance write must re-verify the fix server-side. The fence fails closed
  (NaN/∞ → Infinity → "too far") and rejects low-accuracy fixes so a vague fix can't sneak past the 100 m gate.
- **No client money movement (Law 11).** Earnings are bigint paise summed with BigInt (never a float); the worker
  never moves money — wage settlement is the server's. Withdraw is a REAL, idempotent payout (Law 3) the SERVER
  authorizes (balance/KYC/limits); a 403/409 shows a precise message, never worked around.
- **Permissions & privacy.** Location is requested just-in-time with rationale, read once (no continuous polling —
  battery/data on low-end Android), and never logged. The withdraw screen is `FLAG_SECURE`; bank destinations are
  shown masked (last-4 / VPA only). IDs from params are re-checked server-side (IDOR); lists are keyset-bounded.
- **Kill-switch.** `worker_active_job` disables the whole active-job/earnings/attendance surface without a release.

## Worker app: onboarding + jobs (`features/labour`, roadmap P-12)

Wave 5 — the labour-marketplace differentiator. A `worker` role (added to the role switcher, home `/(worker)/home`)
with its own tab group: **Home** (29), **Jobs** (30/31), **Offers** (141/142) and **Profile** (38/36/136/139).
A worker **registers a profile** (availability: travel radius, stay-away tolerance, min-wage expectation in paise
via BigInt, emergency contact) — the onboarding target is **<10 min**. They **browse open bookings** (`box=open`,
a real marketplace read) and view a **read-only job detail**. Work arrives as **employer-initiated assignments**:
the **offer detail** shows the wage on the table + the **respond-by window**, and — only when the worker is
**18+ verified** — an **accept / decline** control; the 4-hour accept/decline window and the hard 18+ Aadhaar gate
are **enforced server-side** (the client's `canAcceptWork` + window text are UX-only). New SDK: `labour`
(`registerWorker`/`myWorker`/`updateWorker`/`listBookings`/`getBooking`/`listAssignments`/`getAssignment`/`respondAssignment`).
Behind `worker_app` (the mobile vertical) over the server-side `labour` module flag. Pure `labour-status` logic
unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **No worker-"apply" endpoint (140):** jobs are employer→worker assignments, so the job detail is read-only with a
  clear note ("work is offered to you by the employer; accepted offers appear in Offers") rather than a fake apply
  button. Browsing open bookings is real.
- **No skills field in the worker DTO (37/137):** the "add skill / skills" UX is flagged "coming soon" instead of
  posting to a non-existent field.
- **Ambassador-led onboarding + 18+ Aadhaar:** `ageVerified18` is server-set out-of-band via KYC (P-03); the accept
  control stays hidden until the server reports the worker verified — the app never self-asserts age.

### Threats considered (worker / labour / 18+)
- **Hard 18+ gate is server-owned:** the app cannot accept work for an unverified worker — `canAcceptWork` only
  hides the control; the server rejects an accept from a non-verified or under-18 worker (Aadhaar KYC is authority).
- **4-hour respond window is server-enforced:** the client shows "respond before it closes", but a late
  accept/decline (409/422) shows "this offer's window has expired" — never worked around client-side.
- **No client money movement (Law 11):** wages are bigint paise (Law 2); the worker never moves money — wage
  settlement on completion is a server job. `respondAssignment` only signals accept/decline.
- **Idempotency:** register + respond carry an Idempotency-Key (Law 3) — a retried accept can't double-book.
- **IDOR / enumeration:** booking + assignment ids from params are re-checked server-side; lists are keyset-bounded
  (`box=open` / `box=mine`). Emergency-contact + min-wage are the worker's own; no other worker's PII is exposed.
- **Kill-switch:** the `worker_app` flag disables the whole worker vertical without a release.

## Auction discovery + bidding + live (`features/auctions`, roadmap P-11)

P1-8: the detail now shows the **EMD** (deposit-to-bid: flat amount or "% of your bid", pure `emdRequirement`), and
**My bids** (screen 18) lists the caller's bids **across all auctions** (`auctions.myBids`, keyset) with each bid's
EMD hold + winning badge.

Wave 4. Browse **auctions** (Live/Ended), open the **detail** which **polls every 4s** (watch-live; degrades to
pull-to-refresh), and **place a bid** — the bid holds an **EMD (earnest-money deposit) on the bidder's wallet
SERVER-SIDE**, and the loser's EMD is refunded + the winner→settlement run entirely server-side (the app never
moves money — Law 11). Current price + minimum-next-bid come from the PURE `auction-status` helpers (bigint, Law 2);
an **outbid banner** (193) reflects when you're no longer the top bidder (the authoritative nudge is the P-04
push). Bid history (194) is shown, with sealed-auction amounts masked server-side. Sellers **create an auction**
(64) from a listing (start price + increment + duration). New SDK: `auctions`. Behind `auctions` (+ `buyer_app`
for the browse side, `farmer_app` for create). Pure logic unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **EMD amount isn't in the read model:** the auction read shape exposes start/reserve/increment but not the EMD,
  so we show a clear "a refundable deposit is held" note rather than a fabricated number; the hold/refund are real
  and server-side. The wallet (P-06) reflects the hold/refund.
- **No cross-auction "my-bids" (18) endpoint:** the bid history is per-auction, so the detail marks your own bids
  ("You") inline; a standalone my-bids list across auctions awaits a server read-model (flagged, not faked).
- **Live is poll-based** (4s), not a socket — the DoD allows poll-or-socket; a websocket upgrade is a later
  optimization. Product title on the detail is fetched via the public listing read (the auction read has no title).

### Threats considered (auctions / EMD / bidding)
- **Server is the authority on every bid:** the legality of a bid (highest, increment, EMD availability, timing)
  and the EMD hold are enforced server-side; the client's `validateBidRupees` is UX-only. A rejected bid (409/422)
  shows "someone bid higher — refresh", never worked around. Winner declaration + EMD refund are server jobs.
- **No client money movement (Law 11):** placing a bid only calls the endpoint; the EMD hold + loser refund +
  winner settlement happen server-side. Amounts are bigint paise end-to-end (Law 2); the rupee→paise + comparisons
  use BigInt, never a float.
- **Idempotency:** create-auction + place-bid carry an Idempotency-Key (Law 3) — a retried bid can't double-hold
  EMD or place two bids.
- **Sealed-bid privacy:** other bidders' amounts are masked **server-side** until close; the client renders the
  null amount as "Sealed" — it never receives the hidden value.
- **IDOR / scraping:** auction + bid ids from params are re-checked server-side; lists are keyset-bounded; bidding
  is rate-limited at the edge and the poll interval is bounded (4s) so the app isn't an auction-sniping vector.
- **Kill-switch:** the `auctions` flag disables discovery + bidding + create without a release.

## Offers + chat + masked call (`features/offers` + `features/messaging`, roadmap P-10)

Negotiate and talk without leaking a phone number. From a listing the buyer can **Make an offer** (99 →
`offers.make`, per-unit price in paise via BigInt, Law 2) or **Chat with seller** (opens a `direct` conversation).
The **offer detail** shows the price on the table + status and — while negotiable — **accept / counter / reject**;
**accept converts the offer into an order SERVER-SIDE** (`convertedOrderId`) and we route to it (DoD: offer
accepted → order created). **Chat** (98) lists messages keyset-paged, **polls every 5s** while focused
(realtime-ish), and sends **text or an image** (core/media compress + presigned upload → `attachmentMediaId`; bytes
never touch the API). A **masked-call** button bridges the two real numbers SERVER-SIDE — **no phone number is ever
returned to the client**. The pure `offer-status` + `message-view` are unit-tested. New SDK: `offers`,
`conversations`, `maskedCalls`. Behind `offers_chat` (+ `buyer_app`).

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **Chat is poll-based, not socket:** the API exposes keyset message reads, so the thread polls every 5s (the DoD
  allows poll-or-socket); a websocket upgrade is a later optimization.
- **Inline media thumbnails:** sending an image is real (upload → `attachmentMediaId`), but rendering the thumbnail
  inline needs the media download-link wiring, so an image message shows a "📷 Photo" chip for now (flagged).
- **Seller-side incoming offers** (accept/counter from the farmer) reuse the same shared `features/offers` + the
  real `box=incoming` endpoint; the farmer UI for it is a follow-up. The buyer can accept a seller's counter today,
  which exercises the full accept→order path.

### Threats considered (offers / chat / masked call)
- **No PII leak:** masked calls bridge the two numbers server-side via the telephony provider; the API returns a
  call record with **no phone number** ever. Chat carries no numbers; the UI shows "number hidden" on the call CTA.
- **Server is the authority on negotiation:** offer transitions (accept/counter/reject) + who may act (buyer vs the
  listing's seller) are enforced server-side; an out-of-turn tap gets 403/409, shown friendly, never bypassed.
  Accept→order creation + escrow are entirely server-side (the app never moves money — Law 11).
- **IDOR:** conversations are membership-gated server-side (a non-participant gets 404, not another's thread);
  offer/conversation/message ids from params are re-checked by the server.
- **Idempotency:** make-offer, open-conversation, post-message, and initiate-call all carry an Idempotency-Key
  (Law 3) — a double-tap can't double-send or double-bridge.
- **Untrusted attachments:** images upload to S3 (EXIF-stripped, malware-scanned) and are referenced by id; the
  client sends no bytes through the API. Messages can be flagged for moderation server-side (shown as a marker).
- **Money:** offer prices are bigint paise end-to-end (Law 2); the rupee→paise helper uses BigInt, never a float.
- **Kill-switch:** the `offers_chat` flag disables offers + chat + calls without a release.

## Buyer cart → checkout → order (`features/cart` + `features/addresses`, roadmap P-09)

The purchase loop. Add-to-cart from a listing → **cart** (96) reads the SERVER's live cart (prices/availability
recomputed, Law 2 `MoneyText`), steps quantity within stock, and shows blockers via the pure `cart-math`
(`canCheckout`/`cartBlockers`). **Checkout** (15) picks a delivery address from the **address book** (129/134:
list/add/delete), takes an optional **coupon**, and **places the order** — a real, idempotent (Law 3) cart→orders
conversion; the authoritative delivery/tax/discount/commission totals are computed **server-side** and shown on
the resulting order (we never compute them client-side). If online payments are on, it then pays the primary order
via the gateway (`payForOrder` → `direct_order` intent → Razorpay → poll); **escrow is held server-side** on
capture — the app never moves money (Law 11). FLAG_SECURE on checkout. Buyer **orders** list (22/69) + **detail**
(23) + **tracking** (131) reuse the shared `features/orders` + `order-status`; a **profile** tab shows KYC status
(133, shared `features/kyc`) + sign-out. Behind `buyer_checkout` (+ `buyer_app`). New SDK: `cart`, `checkout`,
`addresses` resources. Pure `cart-math` is unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **No checkout totals-preview endpoint:** totals are computed during the checkout transaction, so the checkout
  screen shows the cart subtotal + an honest "final totals shown on your order" note rather than a faked preview;
  the real breakdown is read back on the order (P-07 detail).
- **Payment method (130):** online (gateway) is the real, wired path; **pay-from-wallet for an order** has no
  wallet-debit endpoint, so it's folded into checkout (online) and wallet-pay is deferred, not faked.
- **Buyer review/report** from the order detail are deferred to a follow-up (the shared screens exist for farmers);
  buyer order detail ships cancel/complete/track.

### Threats considered (cart / checkout / pay)
- **Idempotent checkout:** the cart→orders POST carries an Idempotency-Key (Law 3); a retried/double-tapped
  "Place order" can't create duplicate orders. Checkout is online (not queued) — it needs live stock/price/coupon
  validation and an immediate result.
- **Server is the authority on money:** line totals, the subtotal, charges, tax, and the **coupon discount** are
  all computed + redeemed SERVER-SIDE (the coupon is redeemed atomically in the checkout tx). A patched client
  can't grant itself a discount or a price; the app only displays what the server returns. All amounts are bigint
  paise (Law 2).
- **Escrow / no client money movement:** payment capture + escrow hold happen server-side via the signed webhook;
  the app only opens the gateway sheet and polls status (Law 11). FLAG_SECURE covers the checkout surface.
- **IDOR / PII:** the cart and addresses are owner-scoped server-side; an address id from a param is re-checked.
  Contact name/phone are PII held server-side and shown only to the owner; never logged.
- **Stock/price races:** `cart-math` blocks checkout on unavailable/insufficient items and surfaces price changes;
  the server re-validates at checkout (a 409 → "review and retry", a 422 → "coupon invalid"), never worked around.
- **Kill-switch:** the `buyer_checkout` flag disables cart/checkout/place+pay remotely without a release.

## Buyer browse + search + listing detail (`features/buyer`, roadmap P-08)

The customer purchase loop begins. A new `(buyer)` tab group (Home / Search / Saved), auth-gated + behind the
`buyer_app` flag. **Browse/search** run on the real anonymous public catalogue (`listings.browse`, keyset/cursor)
through the SWR cache, so a repeat search is instant and works on 3G/offline (DoD: <2s via cache). A shared
`BrowseList` does pull-to-refresh + infinite scroll; **filters** (sale type / organic / price range / sort) are
built by the PURE `search-query` (rupees→paise via BigInt, Law 2; empties dropped). **Listing detail** shows the
price, qty, organic/promoted, and a seller link. **Saves** (listings / sellers / searches) are persisted
**on-device** (user-scoped) and survive restarts; the saved screen has Listings/Searches/Sellers sub-tabs and a
saved search re-applies its filters. Pure logic (`search-query`, `saved-set`) is unit-tested.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **No public media URLs** in the listing read-model yet, so the detail "gallery" is a neutral placeholder, not a
  fake image (the create-listing media pipeline exists; the public read-model exposure is pending).
- **No server saved/wishlist or saved-search endpoint**, so saves are on-device (real persistence, just not yet
  synced/cross-device) — they'll move to a server wishlist when it lands.
- **No public seller-profile endpoint** (name/bio/their listings); the seller screen shows the **real** rating
  summary (`reviews.summary`) + follow toggle and flags the rest. Browse has no `sellerUserId` filter yet.
- **OpenSearch** powers search server-side; the app calls the same `listings` browse contract, so this is
  transparent to the client.

### Threats considered (buyer browse / saves)
- **Scraping the catalogue:** browse is anonymous + public by design, but the server enforces per-IP/-device rate
  limits + bot defenses; the client bounds page size (keyset, limit ≤ 20), debounces search (350ms), and never
  hammers — it must not be the catalogue's DoS vector. No offset pagination.
- **IDOR:** a listing/seller id from a param is just passed to the server, which returns only visibility-gated
  public data; saved data is on-device and scoped to the signed-in user (`currentScope()`), so one account can't
  read another's saves.
- **Money:** prices are bigint minor strings (Law 2); price-range filters convert via BigInt, never a float.
- **Storage:** saves are non-secret and go through AsyncStorage (never SecureStore); no token/PII is persisted.
- **Kill-switch:** the `buyer_app` flag disables the whole vertical remotely without a release.

## Farmer orders + delivery + PoD (`features/orders` + `features/reviews`, roadmap P-07)

Fulfilment. The orders tab (56/22) has a **Selling/Buying** switch → keyset-paged, SWR-cached lists; tap → **order
detail** (57/23) with the money breakdown (Law 2 `MoneyText`), line items, status, and an **action bar built from
the PURE `nextActions(status, role)`** state map. Sellers drive the lifecycle — confirm → packed → ready →
(record delivery) → complete — each a real, idempotent transition (the SERVER state machine is the authority;
a 409 "already moved" / 403 "not allowed" is shown, never worked around). **Proof of delivery** (PRD DoD): the PoD
screen captures the buyer's **OTP + a delivery photo** (core/media compress+upload) and calls
`POST /shipments/:id/deliver` — the OTP is verified server-side (hash compare); `FLAG_SECURE` is on. **Track** (131)
renders a shipment progress `Timeline` from the pure `trackingSteps`. **Review** (24) posts 1–5 stars after
completion (target resolved server-side, anti-IDOR). **Report** (135) files a dispute. New SDK resources: `orders`,
`shipments`, `reviews`. Mutating actions are behind the `orders_fulfilment` flag (OFF); viewing always works.

### Flagged backend gaps (built real where the endpoint exists; did NOT fake the rest)
- **PoD requires a shipment assigned to the caller** (`shipments?box=mine&orderId=`). For self-pickup orders with no
  shipment, the PoD screen says so honestly — handover then completes via the order lifecycle, not a faked OTP.
- **Push-driven <30s status reflection** (DoD) rides on P-04 notifications (flagged); today the list/detail refresh
  on focus + pull-to-refresh. **Payout-on-completion** is the server's OrderCompleted→settlement handler (real,
  module 4) — the app just triggers `complete`; it never moves money itself (Law 11).

### Threats considered (orders / PoD / reviews)
- **Server is the authority on every transition:** the app offers actions via `nextActions` for UX only; a patched
  client calling `confirm`/`deliver` out of turn is rejected by the entity state machine + RLS. No client privilege.
- **PoD integrity:** the OTP is issued server-side to the buyer and verified server-side (we send the raw code; the
  server hashes + compares) — the seller can't self-certify delivery. PoD photos upload to S3 (EXIF-stripped, scanned)
  and are referenced by `mediaId` only. The OTP screen is `FLAG_SECURE`.
- **Replay / double-fire:** every lifecycle POST + PoD + review carries an Idempotency-Key (Law 3). Transitions are
  online (not offline-queued) precisely because blind replay of a stale state change is wrong — they need live state.
- **IDOR:** order/shipment reads are ownership-scoped server-side; a guessed id returns nothing that isn't yours.
  Reviews never accept a client-supplied target — it's derived from the verified completed order.
- **Money:** all amounts are bigint minor strings end-to-end (Law 2); the app reads totals, never computes settlement.
- **Kill-switch:** `orders_fulfilment` disables all mutating actions + PoD/track/review/report without a release.

## Listing photos + voice + manage (`core/voice` + `features/listings`, roadmap P-05)

Sell faster. **Create listing** (screen 10) now picks the product from the catalogue (real `productId`/`categoryId`/
unit — never fabricated), adds up to 6 photos via `core/media` (compress + presigned-PUT upload, per-tile progress/
retry/queue), and lets the farmer **describe by voice**: `core/voice` wraps on-device STT (`@react-native-voice/
voice`) with a **pure** `sttLocaleFor` language→locale map (hi-IN/gu-IN/en-IN, default en-IN), used by the
`useVoiceDictation` hook + ui-native `VoiceButton`. Submit creates a draft and routes to **preview** (screen 11) to
**publish**. **Edit price** (113) is the real edit path — it reloads the listing for its current price + `version`
and PATCHes with optimistic concurrency (a conflict shows a friendly "reopen & retry"). **Repost** (116) prefills
qty/price from a source listing via `?repostFrom=`. Detail screen (112) exposes Edit/Repost/Boost actions. Offline,
the create queues (Law 3 idempotent replay) and returns to the list. Money is always paise via `BigInt` (Law 2).

### Flagged backend gaps (built real, did NOT fake)
- **Voice → structured fields:** there is no server AI endpoint to extract crop/quantity/price from speech, so voice
  fills the **free-text description only** — we never auto-parse money or quantity from audio (a misheard price is a
  financial bug). Behind the `voice_listing` flag (OFF).
- **Boost is a real paid action, not faked:** boosting requires a wallet debit → `txnId` + a boost-tier price lookup,
  neither of which is wired yet, so behind the default-OFF `listing_boost` flag the Boost button honestly says
  "coming soon" rather than flipping a cosmetic `boosted` flag.
- **Full-field edit + listing analytics + a dedicated repost endpoint** have no API yet; only price-edit (real PATCH)
  and prefill-based repost (real create) ship.

### Threats considered (listing media / voice)
- **Untrusted media:** photos upload to S3 via presigned PUT (never through the API host); EXIF is stripped and the
  server runs an async malware/visibility scan before an asset is ever shown — the client only references `mediaId`s.
- **Voice privacy:** STT is **on-device**; raw audio is never uploaded, only the resulting text the farmer can see and
  edit before submit. Mic permission is requested just-in-time; failure degrades to typing (never blocks listing).
- **Price integrity:** all amounts are bigint paise (Law 2); price edits use `expectedVersion` optimistic concurrency
  so a stale screen can't silently overwrite a newer price; the server re-authorizes ownership on every mutation.
- **Spend safety:** Boost can move money, so it stays flagged-off until the wallet-debit path is real — no fake
  "boosted" state, no client-side pricing.
- **Kill-switches:** `voice_listing` and `listing_boost` disable those surfaces remotely without an app release.

## Payments + KYC (`core/payments` + `core/security` + `features/{payments,kyc}`, roadmap P-03)

The money rails. **Add-money** (wallet recharge) is the fully-wired headline path: `features/payments.addMoney`
→ SDK `payments.createIntent` (purpose `wallet_recharge`, idempotency-keyed) → **Razorpay checkout** (UPI/cards/
netbanking) opened with the PUBLISHABLE key from public config → poll our own `payments.get(id)` until terminal.
**Capture is verified server-side by the signed webhook** — the client never trusts the gateway result, it only
reads authoritative status. **KYC status** (`features/kyc.listKyc` → SDK `kyc.list`) shows submitted docs +
pending/verified/rejected. New SDK resources: `payments`, `payouts`, `kyc`, `bankAccounts` (typed, idempotent,
money as bigint-minor strings). `core/security/useSecureScreen` applies **FLAG_SECURE** (expo-screen-capture) on
add-money + KYC screens. Both screens are flag-gated (`payments_addmoney`, `kyc`, default OFF). Pure money/status
helpers (`rupees→paise` via BigInt, terminal-status mapping) are unit-tested.

### Flagged backend gaps (built the real contract, did NOT fake the missing piece)
- **Wallet balance** read-model is an unbuilt API stub — the wallet shows ₹0 + retry (degrade), not a fake number.
- **KYC doc submit** needs a `docTypeId`, but the API exposes no doc-type lookup yet — so this release ships KYC
  *status* only; `submitKyc()` is wired to the real contract for when the lookup lands.
- **Bank add** needs a gateway-tokenised `vaultRef` (no tokenisation endpoint yet) — `listBanks`/`addBank` exist
  against the real contract; the bank-ADD + withdraw screens land with the payouts vertical (roadmap P-06).
- **Aadhaar e-KYC OTP** (screens 72/73) is Phase-2 per the PRD lean scope — not built (no backend).

### Threats considered (payments / KYC)
- **Tampered amount / replayed payment:** amount is server-validated; createIntent is idempotency-keyed; capture
  is webhook-verified server-side (client status is read-only). No money is ever a float (bigint paise).
- **Secret leakage:** only the Razorpay *publishable* key is in the client; the bearer token is never sent to the
  gateway; no gateway secret/signing key is in the bundle.
- **Screenshot/recording of money/KYC:** FLAG_SECURE on those screens.
- **PII:** KYC sends only a masked doc value + an uploaded media id (never the raw number); bank stores
  tokenised vaultRef + last-4 only.
- **IDOR:** payment/KYC/bank reads are owner-scoped server-side; the app shows only the caller's data.
- **Kill-switch:** payments_addmoney / kyc flags can disable these flows remotely without an app release.

## Offline-first reads + sync engine (`core/offline` + `core/connectivity`, roadmap P-02)

The app is usable with no signal. Reads go through a **stale-while-revalidate** cache: `cache-policies.ts` (pure:
per-user-scoped keys + TTL/SWR freshness) + `cache.ts` (read-through engine, store+clock injected) backed by
**`sqlite.db.ts`** (expo-sqlite). FRESH → no network; STALE → serve cached + revalidate in background; MISS →
fetch, **falling back to cached on failure** (degrade-never-die). Cache keys are scoped to the signed-in user
(`scope.ts`) and **wiped on sign-out**, so one account can never read another's cached data (anti-IDOR). Writes
ride the **single dispatched offline queue** (`sync-queue.ts`); the **sync engine** (`sync.engine.ts` +
`core/connectivity` over NetInfo) replays them on the **offline→online edge** and on **foreground**, guarded
against concurrent flushes — so a listing/upload made in a dead-zone syncs the moment signal returns, with the
same idempotency keys (no duplicates). An `OfflineBanner` shows when offline. Farmer home/listings/orders reads
are cached; **wallet balance is intentionally NOT cached** (money correctness > offline staleness — it shows live
or ₹0+retry). Pure logic (policies, SWR engine, transition guards) is unit-tested with in-memory store + fake clock.

### Threats considered (offline cache)
- **Cross-account cache read:** keys are user-scoped and the scope's cache is cleared on sign-out.
- **Stale money:** wallet/ledger reads are never cached; only non-authoritative lists/reference data are.
- **Duplicate write on reconnect/double-flush:** one dispatched queue, idempotency-keyed replay, concurrent-flush
  guard (unit-tested no-dup).
- **Tampered local cache:** cache holds non-secret reads only (tokens stay in SecureStore); the server remains the
  authority and re-authorizes every call, so a doctored SQLite row can't grant access — at worst it shows the user
  their own stale data until revalidation.

## Media capture & upload (`core/media`, roadmap P-01)

Reusable image pipeline every later feature uses (listing photos, KYC docs, PoD, profile, chat): pick from
camera/gallery (`expo-image-picker`, **just-in-time permissions**) → **downscale to ≤1600px + JPEG-compress**
(`expo-image-manipulator`, which also drops EXIF/GPS client-side) → **SHA-256 the exact bytes** (pure
`core/util/sha256` over the decoded file) → presigned **PUT straight to S3** with **progress + bounded retry**
(`expo-file-system`) → confirm size+hash+dims. Offline-first: a network failure **enqueues** the upload on the
shared dispatched queue (`core/offline/sync-queue`) and replays it with the **same idempotency keys** (Law 3) so
a reconnect can't double-create. SDK: new typed `media` resource (`requestUpload`/`confirmUpload`/`downloadUrl`).
ui-native primitives: `UploadTile` (thumb + progress/queued/failed/retry + remove), `AddMediaTile`, `ProgressBar`.

### Threats considered (media)
- **Malicious upload / oversized file:** the API re-validates kind+mime+size and AV-scans every object before it's
  ever downloadable (fail-closed); the client also caps dimensions/quality and only allows an image/doc mime set.
- **EXIF/GPS leak:** the re-encode strips metadata client-side; the server strips again post-scan.
- **Duplicate asset via retry/replay:** `requestUpload` + `confirm` carry stable idempotency keys reused on
  offline replay.
- **Tampered bytes:** sha256 is computed over the SAME decoded bytes that are PUT to S3 and recorded on confirm.
- **Token/URL leakage:** the presigned S3 URL is short-lived; file bytes never pass through (or get logged by) the
  API; the bearer is never sent to S3.
- **IDOR on download:** `download-url` is owner/moderator-scoped and only for clean assets (404 otherwise).

## Threats considered (auth + farmer slice)

The app is treated as fully untrusted (guide §4) — every control below is also enforced server-side:
- **Token theft / patched APK:** access+refresh tokens live only in `expo-secure-store` (Keychain/Keystore),
  never AsyncStorage/logs; the API re-enforces auth + RBAC on every call, so a stolen client can't escalate.
- **OTP enumeration / brute force:** the phone step advances identically whether or not the number exists;
  resend respects the server cooldown; verify attempt-caps are server-enforced (the UI just surfaces them).
- **Replay / double-spend:** the create-listing mutation (and every future mutation) carries a per-action
  idempotency key; the offline queue replays with the **same** key, so a reconnect can't double-create.
- **Money tampering:** money is bigint minor-unit strings end-to-end (`MoneyText`/`formatMoneyMinor`); the
  client never computes balances — it displays the server's reconciled truth.
- **IDOR via deep link:** listing/order ids from params are re-checked for ownership/tenant by the API (the
  client read degrades to an EmptyState on 404, never leaks another tenant's data).
- **Scraping / DoS:** product search is debounced, lists are keyset-bounded; the server owns rate limits.
- **DoS via flaky deps:** every call is timeout-bounded and degrades (Law 12); a hung API never white-screens.
Hardening still owed before GA (roadmap P-30): TLS pinning, root/integrity attestation, release obfuscation,
`FLAG_SECURE` on KYC/payment/wallet screens — tracked in `MOBILE_BUILD_ROADMAP.md`.

## Verification

- `pnpm --filter @krishalaya/mobile test` → **219 unit tests green** (session reducer, offline queue, helpers,
  feature flags, SHA-256 FIPS vectors, base64, media-mime, cache policies, SWR cache engine, sync transitions,
  payment money/status, quiet-hours, deep-link routing, notification presenters, STT locale map, wallet txn
  presenters + withdrawal BigInt guard, order-status action map + PoD-OTP + tracking steps, buyer search-query +
  saved-set, cart-math + address format, offer-status + chat message-view, auction current-price/min-next/bid
  validation/outbid, labour booking/assignment tones + assignment actions + 18+ canAcceptWork gate +
  rupees→wage-minor + buildWorkerPatch + isJobOpen, geofence haversine/clock-in-100m-eligibility/distance-parts,
  worker-jobs bucketing + BigInt earnings sum + clock-in precondition, hire booking-lifecycle actions + assignment
  tally + buildBookingDraft validation + wage rupees→paise, ambassador referral funnel + code normalize/validate +
  BigInt commission sum, education quiz parse/score + course progress, tenant-admin subscription/approval/dispute
  tones + dispute actions + buildResolution + dashboard KPI compose + add-farmer phone validate, web-console report
  catalogue + safe-URL builder/anti-open-redirect) — run offline via
  ts-jest scoped to `src/core/__tests__`. `@krishalaya/sdk-js` 13/13 still
  green (payments/payouts/kyc/bankAccounts/notifications/listings/orders/shipments/reviews/cart/checkout/addresses/
  offers/messaging/auctions/labour/ambassadors/education/tenancy/rbac/disputes/users resources).
- Screens are thin (guide §3): every API call lives in a `features/<area>/*.api.ts` data layer (farmer
  dashboard, orders, wallet, listings, catalogue) — no screen calls `apiClient` directly. All user-facing strings
  are i18n keys in hi/en/gu (no literals). `.eslintrc.js` (eslint-config-expo) gates lint in CI.
- Shared packages re-confirmed green: `sdk-js` 7/7, `i18n` 6/6, `tokens` typecheck clean.
- All app + ui-native TSX/TS **syntax-parse clean** offline with **zero broken local imports**.
- The full RN app (React Native + native modules + expo-router) compiles under CI's `pnpm install` + `expo`
  toolchain — the monorepo's `workspace:` deps can't be `npm install`ed in the sandbox, so the device build is
  CI-only (the framework-free core above is fully verified here).

## Not yet built

This release delivers the foundation + auth + the farmer listings vertical. The remaining ~180 Phase-1 screens
(other roles, auctions, dairy/MCC, labour, fintech, schemes, education, wallet flows, chat, voice STT, push,
offline SQLite sync, GPS/geofence) are mapped to their feature folders in **`SCREENS_BACKLOG.md`**. The scaffold
files under `src/features/*`, `src/core/{push,voice,location,offline/sqlite,offline/sync}` remain documented
placeholders for those follow-on verticals — no fake screens are wired into the router.
