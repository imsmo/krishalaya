// apps/mobile/metro.config.js · Expo's default Metro config, wrapped by Sentry's (MOB-STORE-1). Since SDK 52
// `expo/metro-config` detects the pnpm workspace by itself (watchFolders = the workspace packages, nodeModulesPaths = app +
// root node_modules, symlinks followed), so no monorepo overrides here (MOB-SDK-1: expo-doctor flags them).
// getSentryExpoConfig = getDefaultConfig + a Debug ID stamped into every bundle and its source map, which is how Sentry matches
// a release crash to the PRIVATELY uploaded map (the map itself never ships). The offline cache module is
// `core/offline/sqlite.store.ts` — not `sqlite.db.ts` — because `db` is one of Expo's asset extensions. See
// https://docs.expo.dev/guides/monorepos/ and https://docs.sentry.io/platforms/react-native/manual-setup/expo/.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
