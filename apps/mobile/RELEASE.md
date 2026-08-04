# Krishalaya Mobile — Release Runbook (P-32, Wave 11)

How we ship a build to millions of low-end devices without breaking them: EAS profiles, phased rollout, OTA with
flag discipline + rollback, and the forced-update floor. (MOBILE_AI_AGENT_BUILD_GUIDE §8.) The framework-free
release logic is unit-tested here; the binary build/submit + OTA run on EAS/CI, not the offline sandbox.

## Channels & profiles (`eas.json`)
| Profile | Channel | Distribution | Use |
|---|---|---|---|
| `development` | — | internal (dev client) | local dev + e2e APK |
| `preview` | `preview` | internal | QA / staging smoke |
| `beta` | `beta` | Play internal→closed→open / TestFlight | beta cohort |
| `production` | `production` | Play production (1% rollout) / App Store | GA |

Release hardening (Hermes, R8/ProGuard + shrink, cleartext-off, TLS pins) lives in `app.config.ts`
(`expo-build-properties`); source maps upload privately then are stripped (P-30 + `mobile-release.yml`).

## Binary release (new native build)
1. CI green on `main` (mobile-ci.yml: typecheck, lint, unit, audit, bundle-size, Maestro e2e).
2. `mobile-release.yml` → `binary-build` / `beta` → ship to internal testing; bake with the beta cohort until
   **crash-free sessions ≥ 99.5%** (SLO `crash_free_sessions`).
3. Promote: `binary-build` / `production` → submit starts a **1% staged rollout** (`eas.json` submit.rollout=0.01,
   releaseStatus=inProgress).
4. **Phased rollout gates:** 1% → watch crash-free + the funnel SLOs (login/listing/checkout success) for ~24h →
   10% → 100%. Halt at any step if crash-free dips below 99.5% or a funnel regresses.

## OTA (JS-only fixes) — flag discipline
- `mobile-release.yml` → `ota-update` → `eas update --channel <beta|production>`. Same `runtimeVersion`
  (`appVersion` policy) so an OTA only targets a compatible binary.
- The app checks/fetches OTA on reconnect/foreground **only when the `ota_updates` flag is on** and **never
  mid-critical-flow** (`core/release/ota.ts` `shouldApplyOta`); a staged bundle applies on the next cold start.
- A bad OTA is a **flag flip** away from disabled — turn `ota_updates` off remotely (no store release needed).

## Rollback rehearsal (must be rehearsed before GA)
- **Binary rollout:** pause/halt the Play staged rollout (or set the previous build to 100%).
- **OTA:** `mobile-release.yml` → `ota-rollback` (`eas update:rollback --channel <ch>`) republishes the previous
  publish; clients pick it up on next check. Verify on a test device that the previous bundle is served.
- **Kill-switch:** flip the offending feature flag OFF (remote config) — the bad screen disappears without a
  release (Law 10).

## Forced-update floor
- The min supported version is set remotely (`setUpdateThresholds`) / via `EXPO_PUBLIC_MIN_VERSION`. When the
  installed build is below it AND the `release_gate` flag is on, `ForcedUpdateGate` (wired at the app root) blocks
  the whole app with an update-required screen + store link — a known-bad/insecure client can't keep calling the
  API. `decideUpdate` (`core/release/update-gate.ts`) is unit-tested; fail-open if no min is configured.

## Pre-GA checklist
- [ ] CI green (all §9 gates) including the Maestro sell+buy+pay e2e.
- [ ] Signed build shipped to the internal track; beta cohort crash-free ≥ 99.5%.
- [ ] OTA update + rollback rehearsed on a test device.
- [ ] Store metadata complete (`STORE_COMPLIANCE.md`): data-safety, permission justifications, privacy policy, age.
- [ ] Forced-update floor verified (set min above current → app blocks → update unblocks).
- [ ] P-30 `THREAT_MODEL.md` sign-off + P-31 observability live (crash + funnels, PII-redacted).
