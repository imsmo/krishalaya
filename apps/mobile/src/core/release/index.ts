// apps/mobile/src/core/release/index.ts · public surface for release management (guide §8): the forced-update
// floor (decision + gate component + remote thresholds) and OTA (expo-updates) check/fetch with flag discipline.
// The actual EAS build/submit + OTA publish + phased rollout live in eas.json + the CI workflows + RELEASE.md;
// this module owns the runtime gate + the PURE decisions CI verifies.
export { compareVersions, decideUpdate, setUpdateThresholds, effectiveMin, effectiveRecommended, type UpdateDecision } from './update-gate';
export { shouldApplyOta, setOtaProvider, checkAndFetchOta, otaProviderFrom, installExpoOtaProvider, type OtaState, type OtaProvider, type UpdatesModuleLike } from './ota';
export { ForcedUpdateGate } from './ForcedUpdateGate';
