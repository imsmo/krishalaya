# MOBILE AI AGENT BUILD GUIDE — Krishalaya App (React Native / Expo)

**Paste the "Mobile Production-Grade Contract" (§1) at the top of EVERY mobile build command.**
This is the engineering constitution for the Krishalaya mobile app — the primary surface for **millions of
real, concurrent users** (farmers, buyers, workers, traders, ambassadors) issuing **billions of operations**,
on budget Android phones, on 2G/flaky networks, in 3 launch languages. Our ambition is to be the **world's
largest agri platform**, so assume from day one that well-funded global competitors and attackers are reverse-
engineering the APK, replaying our APIs, scraping our catalogue, and probing every input. Build for that —
every screen is production, never a demo.

This guide is the mobile sibling of `AI_AGENT_BUILD_GUIDE.md` (backend). When the two overlap, both apply; the
**12 Laws in `CLAUDE.md` are supreme** (esp. Law 2 money=bigint-minor, Law 3 idempotency, Law 11 god-mode lives
only in admin-api — NEVER in the app, Law 12 degrade-never-die).

**Exemplars to match (already built — copy their structure & rigor):**
- Component library: `packages/ui-native/` (theme + primitives, tokens-only, ≥48px targets, a11y).
- App core: `apps/mobile/src/core/` — `config.ts` (fail-closed), `api/client.ts`, `api/offline-queue.ts`
  (durable, idempotent, tested), `auth/session.reducer.ts` (pure, tested), `auth/token-store.ts` (SecureStore),
  `auth/auth.store.tsx`, `i18n/`, `auth/otp.helpers.ts` + `role-switcher.ts` (pure, tested).
- A shipped vertical: `apps/mobile/src/app/(auth)/*` + `(farmer)/*` and `src/features/listings/listings.api.ts`.
- Screen catalog + backlog: `apps/mobile/SCREENS_BACKLOG.md` (the 196 Phase-1 designs and where each lives).
- Designs: `../Phase-1 all screen design/` — pixel/UX source of truth. Tokens: `packages/tokens` + ui-native `theme`.

---

## 1. THE MOBILE PRODUCTION-GRADE CONTRACT (paste at the top of every command)

```
MOBILE PRODUCTION-GRADE CONTRACT — obey for everything you build in apps/mobile + packages/ui-native:
- Hyperscale client for millions of concurrent users / billions of ops, on low-end Android & 2G,
  under active attack and reverse-engineering. Write code that withstands that — never a demo.
- Match the exemplars: packages/ui-native (components) and apps/mobile/src/core + the (auth)/(farmer)
  verticals (screens/data). Mirror their layering, naming, and rigor. NEVER deep-import; use the
  package/feature public surface.
- NO stubs, NO TODOs, NO placeholders, NO fake data, NO hardcoded screens. If a backend contract or
  dependency is missing, build the real call against the SDK or EXPLICITLY flag it — never invent ids,
  prices, or mock responses wired into the UI.
- Bake in EVERY time: the server is the only authority (the app NEVER trusts its own role/permission
  for security — only for navigation); tokens only in encrypted secure storage (never AsyncStorage/logs);
  every mutation carries an Idempotency-Key (Law 3); money is ALWAYS bigint minor-unit strings via
  MoneyText/formatMoneyMinor — never a float/Number (Law 2); every network call is timeout-bounded with
  retry/backoff on GETs only; every screen DEGRADES, never crashes (Law 12) — empty/cached/inline-error,
  never a white screen or 500 bubble; i18n keys (hi/en/gu), never literals; ≥48px touch targets + a11y labels.
- Offline-first: reads serve from cache then revalidate; writes enqueue durably (OfflineQueue) and replay
  with the same idempotency key — the farmer never loses work in the field.
- Think adversarially for every screen/endpoint call: how does a hostile user/competitor abuse it from a
  patched APK or a script? Close it (see §4). Assume the client is fully untrusted; enforce on the server.
- Tests are MANDATORY: unit-test all non-trivial PURE logic (reducers, state machines, money math, parsers,
  queue, validators). Component/e2e where it earns its keep. Mock-only tests that prove nothing are rejected.
- Performance budgets are hard limits (see §5): cold start, bundle/APK size, list frame rate, memory.
- Before "done": run typecheck + unit tests + lint (and the RN build in CI); self-audit against §4–§8 and
  the §9 checklist; PASTE the green output. Red = not done. If a scale/security trade-off is ambiguous,
  choose what a top global consumer app (think Google/Meta/Stripe scale) ships, and state the assumption.
```

---

## 2. PRE-FLIGHT — read before writing a line
1. `CLAUDE.md` — the **12 Laws**. Non-negotiable. (Law 11: god-mode/admin powers are NEVER in this app.)
2. `apps/mobile/README.md` + `apps/mobile/SCREENS_BACKLOG.md` — what exists, where each of the 196 screens goes.
3. The exemplar vertical IN FULL: `src/app/(farmer)/*` + `src/features/listings/listings.api.ts` (data-layer
   pattern: SDK call → degrade-never-die → offline-queue for writes → typed result).
4. `packages/ui-native/src/index.ts` + `theme.ts` — use these primitives/tokens; **never** hardcode a color,
   spacing, font, or a raw `<TextInput>`/`<Button>` when a primitive exists. Add a primitive if one is missing.
5. The matching backend contract for the screen: the SDK resource (`@krishalaya/sdk-js`) OR the API
   controller/DTO in `apps/api/src/modules/<domain>` so field names + idempotency + money types match EXACTLY.
   If the SDK lacks a typed method, use the SDK `request()` escape-hatch and note the assumed contract; if the
   endpoint itself is missing, flag it — never fake the response.
6. The Phase-1 design for the screen in `../Phase-1 all screen design/` — match layout, copy, and flow.
7. `apps/mobile/src/core/i18n/locales/{hi,en,gu}.json` — add keys for every new string in ALL three languages.

---

## 3. WHAT TO BUILD — structure (match the exemplars exactly)
Routing is **expo-router** (file-based) under `src/app`. Role groups are `(auth)`, `(farmer)`, `(buyer)`, …
Feature logic/data lives under `src/features/<area>/` and is imported by the screens — screens stay thin.

- `src/app/(role)/_layout.tsx` — the role's navigator (Tabs/Stack); **auth-gate** (Redirect if anonymous).
- `src/app/(role)/<screen>.tsx` — a screen: read params → call a feature hook/api → render ui-native components.
  No business logic, no direct `fetch`, no raw styling. Loading → `SkeletonCard`; empty/failure → `EmptyState`.
- `src/features/<area>/<area>.api.ts` — the data layer: typed functions over the SDK; **degrade-never-die**
  (catch → empty/cached); **writes go through the OfflineQueue** with an idempotency key; keyset pagination only.
- `src/features/<area>/<area>.store.ts` — local UI/feature state (pure reducer + hook) when needed; PURE core is
  unit-tested.
- `src/features/<area>/components/` — feature-specific composite components built ONLY from ui-native primitives.
- `src/core/*` — cross-cutting: `config`, `api` (client + offline-queue + interceptors), `auth`
  (session.reducer + token-store + auth.store + otp + role-switcher), `i18n`, `offline` (kv + sqlite + sync),
  `push`, `voice`, `location`, `analytics`, `util`. Never instantiate raw storage/fetch in a screen — use core.
- `packages/ui-native/src/components/*` — reusable, presentational, tokens-only, a11y, ≥48px.
- `__tests__/` colocated under `src/core/__tests__` (pure) and feature tests where logic warrants.
- Every feature folder gets a one-paragraph header comment: what it owns, which screens, which API.

If a string, color, or number is about to be hardcoded → STOP: it belongs in i18n, theme, or config.

---

## 4. SECURITY — the part global competitors attack first (mandatory, not optional)
**Golden rule: the mobile app is fully untrusted. Every security decision is enforced on the server; the app
only reflects it.** A patched/rooted APK can call any endpoint with any payload — design as if it will.

Client-side hardening (raise the cost of attack; never the last line of defense):
- **Secrets / tokens.** Access+refresh tokens ONLY in `expo-secure-store` (iOS Keychain / Android Keystore),
  rotated on refresh, cleared on sign-out. NEVER AsyncStorage, NEVER in JS globals beyond the in-memory auth
  store, NEVER in logs/analytics/crash reports. No API secret, signing key, or admin capability is ever in the
  bundle (only `EXPO_PUBLIC_*` public config). Fail closed at boot if config is missing.
- **Transport.** HTTPS only; enable **TLS certificate/public-key pinning** for the API host in production builds
  (with a backup pin + rotation plan). Reject cleartext (`usesCleartextTraffic=false`).
- **Device integrity.** Root/jailbreak detection + (Android) Play Integrity / (iOS) DeviceCheck/App Attest on
  sensitive flows (login, payments, payouts, KYC). Treat a failed attestation as a server-side signal, not a
  hard client block (degrade), but raise risk scoring server-side.
- **Anti-tamper / anti-reversing.** Release builds: Hermes bytecode, JS minification, ProGuard/R8 + resource
  shrinking, native-string obfuscation for any sensitive constants, disable debugging/dev menus, strip source
  maps from the artifact (upload them to the crash service privately).
- **API abuse.** Every mutation sends an **Idempotency-Key** scoped per user+action (Law 3) so replays can't
  double-apply. Assume scraping: the server enforces per-user/-device/-IP rate limits + bot defenses; the app
  must not hammer (debounce search, bound list sizes, back off on 429). Never rely on client throttling alone.
- **AuthN/OTP.** Phone-OTP is enumeration-safe (the UI advances identically whether or not the number exists).
  Respect server resend cooldown + attempt caps; surface the server's throttle message; never reveal account
  existence. Step-up re-auth for high-risk actions is enforced by the server.
- **AuthZ.** The app picks a role for NAVIGATION only. It NEVER grants itself a permission. Every protected
  action is authorized server-side; a 403 is shown as a friendly "not allowed", never worked around.
- **IDOR / data minimization.** Never trust an id from a deep link/param without the server re-checking
  ownership/tenant. Request only the fields a screen needs; never cache another user's/tenant's data.
- **Input validation.** Validate + normalize on the client for UX (phone E.164, pincode, IFSC, amounts as
  integer minor units) AND know the server re-validates (zod .strict). Guard regexes against ReDoS.
- **PII & privacy (DPDP).** Never store raw Aadhaar/PAN/bank in plaintext or logs; show masked/last-4 only.
  Explicit consent screens (append-only), data-subject export/delete, clear retention. Redact PII from analytics
  and crash payloads. Screenshot/screen-recording protection (`FLAG_SECURE`) on KYC/payment/wallet screens.
- **Deep links / WebViews / clipboard.** Validate every deep-link route + param; never auto-execute actions from
  a link without auth + confirm. Avoid WebViews; if unavoidable, no `allowFileAccess`, no JS bridges exposing
  native, allowlist origins. Don't put OTP/tokens on the clipboard.
- **Supply chain.** Pin dependency versions; no unvetted native modules; run `npm audit`/Snyk in CI; verify
  Expo/RN integrity. A compromised dependency is a breach.

Deliverable per feature: a short **"Threats considered"** note (how a hostile user/competitor abuses these
screens/endpoints from a patched client, and how each is closed — server-side enforcement named) + regression
tests for the client-side invariants (idempotency key present, token never logged, money never floated,
degrade path renders).

---

## 5. SCALE & PERFORMANCE — budgets are hard limits (billions of ops, low-end devices)
The bottleneck is the device and the network, not just the backend. Treat performance as a feature.
- **Cold start:** < 2.5s to interactive on a 2 GB-RAM Android. Defer non-critical work; lazy-load heavy
  features (route-level code splitting); keep the root layout light.
- **Bundle / APK:** keep the install small (Hermes, tree-shaking, no unused native modules, compressed assets,
  vector icons not PNGs). Watch every new dependency's footprint.
- **Lists:** `FlatList`/`FlashList` with stable keys, `getItemLayout` where possible, windowing; **never** map
  a huge array into a ScrollView. **Keyset (cursor) pagination only** — never offset. No work in `renderItem`.
- **Rendering:** memoize (`React.memo`, `useCallback`, `useMemo`) hot paths; avoid anonymous inline objects in
  styles (use `StyleSheet.create`); animations on the **native driver**; 60fps scrolling is the target.
- **Network:** one timeout-bounded client; GETs retry with backoff, mutations never auto-retry (they enqueue);
  cache reads (stale-while-revalidate) with tenant-prefixed keys + explicit invalidation on write; batch where
  possible; never N+1 round-trips for one screen.
- **Offline-first:** durable read cache (SQLite) + the write queue; the app is usable with no signal and
  reconciles on reconnect/foreground. Bound the queue; dead-letter poison ops.
- **Memory/data:** downscale/compress images before upload (rural data is costly); cap in-memory caches; release
  listeners on unmount. Respect data-saver.
- **Money correctness:** bigint minor units only, end to end; format at the edge via `formatMoneyMinor`.

---

## 6. RESILIENCE & OBSERVABILITY (degrade, never die — Law 12)
- Wrap EVERY external dependency (API via SDK, push, location, STT, payments SDK) with timeout + retry/backoff +
  graceful fallback. One hung dependency must never freeze the UI thread or cascade.
- Every screen has three states wired: loading (`SkeletonCard`), empty/error (`EmptyState` + retry), and data.
  A thrown error in render is a defect.
- **Crash + error reporting** (e.g. Sentry) in production with **PII/token redaction**; symbolicate via private
  source maps. **Analytics** events for funnels (no PII), behind consent, with an offline buffer.
- Structured client logs carry a request id / correlation id propagated to the API (no PII/secrets).
- **Every feature behind a remote feature flag, default OFF, with a kill-switch** (Law 10) so a bad screen can
  be disabled without an app-store release. Support **forced-update** + maintenance screens.
- Define client SLOs for hot flows (login success rate, create-listing success, crash-free sessions ≥ 99.5%).

---

## 7. ACCESSIBILITY, i18n & INCLUSIVITY (our users are the differentiator)
- **i18n:** hi/en/gu via `useTranslation()` keys — never a literal string in a screen. Add all 3 languages for
  every new key. Support Indic digits where the design calls for it. Plan for RTL-safe layouts.
- **Low-literacy / accessibility:** large type, high contrast (outdoor sunlight), ≥48px targets, voice-first
  affordances (Speak-to-Sell), icons + text, `accessibilityLabel`/`Role`/`State` on every interactive element,
  screen-reader tested, respects OS font scaling.
- **Vernacular money/number/date** formatting via `@krishalaya/i18n`. Never assume English locale.

---

## 8. MNC-GRADE DELIVERY PROTOCOL (how a top global company ships a client at this scale)
- **Branching/PRs:** trunk-based or GitFlow with required review (CODEOWNERS), no direct pushes to main; small
  reviewable PRs; conventional commits.
- **CI gates (must be green to merge):** `typecheck`, `lint`, `unit tests`, RN/Expo build, dependency audit,
  bundle-size check, (where set up) Detox/Maestro e2e on the critical flow, and the §9 checklist.
- **Release management:** versioned releases + changelog; **EAS build profiles** (dev/preview/production);
  **staged/phased rollout** (1%→10%→100%) with crash-rate gates; **OTA updates** (expo-updates) for JS-only
  fixes with the same flag discipline; documented rollback (revert OTA / halt rollout). Forced-update floor.
- **Store compliance:** Play Store + App Store policy (permissions justified + minimal, data-safety/privacy
  labels accurate, age rating, content). Request permissions just-in-time with rationale.
- **Privacy/legal:** DPDP compliance, consent management, data export/delete, retention; privacy policy linked
  in-app; data-safety form kept in sync with what the app actually collects.
- **Quality:** crash-free-session SLO with alerting; performance regression tracking; beta channel (internal →
  closed → open testing). Accessibility + localization sign-off per release.
- **Docs:** every feature ships a README + "Threats considered" note + updates `SCREENS_BACKLOG.md` and
  `apps/api/MODULE_STATUS.md`.

---

## 9. DEFINITION OF DONE (with PROOF — nothing is "done" without it)
```bash
cd apps/mobile
npm run typecheck       # exit 0
npm run lint            # exit 0
npm run test            # all green (pure logic: reducers, queue, money, validators)
# packages/ui-native: npm run typecheck
# CI additionally: expo build / EAS, dependency audit, bundle-size, e2e on the critical flow
```
Then: wire the screen into expo-router, add i18n keys (hi/en/gu), put the feature behind a flag (default OFF),
write the feature README + "Threats considered" note, update `SCREENS_BACKLOG.md` + `MODULE_STATUS.md`, ensure CI
is green. **Paste the green output.** (Note: a full device build runs in CI/EAS, not the offline sandbox — the
framework-free core is what's unit-verified locally; say so explicitly.)

---

## 10. REVIEW CHECKLIST (you, founder/CTO, before merge)
Structure & laws:
- [ ] Screens are thin (read → feature api → ui-native render); no business logic, raw fetch, or raw styling.
- [ ] Built ONLY from ui-native + theme tokens; no hardcoded color/spacing/font; ≥48px targets + a11y labels.
- [ ] All strings are i18n keys present in hi/en/gu; vernacular number/money/date formatting.

The recurring mobile bug-classes — grep the diff for each:
- [ ] **Money as number/float** anywhere (must be bigint minor-unit strings + MoneyText).
- [ ] **Token/PII/secret** in AsyncStorage, logs, analytics, crash payloads, or the bundle.
- [ ] **Mutation without an Idempotency-Key**, or a GET that retries a write.
- [ ] **A screen that can throw/white-screen** (missing loading/empty/error state) — violates Law 12.
- [ ] **Trusting the client role/permission for security** instead of letting the server enforce.
- [ ] **Offset pagination / unbounded list / work inside renderItem** (scale).
- [ ] **Literal user-facing strings** or **hardcoded design values**.
- [ ] **Deep-link/param used without server-side ownership re-check** (IDOR).

Security & scale (from §4–§5):
- [ ] Server is the authority; 403 handled gracefully; no client-side privilege.
- [ ] TLS pinning + secure storage + (sensitive flows) integrity/attestation + FLAG_SECURE on KYC/pay/wallet.
- [ ] Enumeration-safe auth; respects server cooldown/throttle.
- [ ] Timeout on every call; degrade path renders; feature behind a kill-switch flag.
- [ ] Perf budgets met (cold start, list fps, bundle); images compressed before upload.
- [ ] Offline: reads cached, writes queued + idempotent replay.

If any fail: *"This violates the Mobile Production-Grade Contract / DoD item X and diverges from the exemplar at
<file>. Fix and re-verify."*

---

## 11. PACE & SEQUENCING
- Build in `SCREENS_BACKLOG.md` order — finish one role/feature vertical before starting the next; a screen's
  data dependencies (SDK method/endpoint) come first.
- Add a ui-native primitive or a core capability JUST BEFORE the first screen that needs it (e.g. an image
  picker/uploader before create-listing photos; the STT engine before voice listing; push before notifications).
- **One feature vertical ≈ one session + review.** Never "build all the roles at once." Tests green → behind a
  flag (OFF) → enable for a pilot tenant/cohort → smoke test → phased rollout.

*North star: when in doubt, build it like the `(farmer)` vertical + `ui-native`, assume a global competitor is
reading the decompiled APK, and ship what a top-tier consumer app at hundreds-of-millions of users would ship.*
```
