// apps/mobile/metro.config.js · Expo's default Metro config, unchanged. Since SDK 52 `expo/metro-config` detects the
// pnpm workspace by itself (watchFolders = the workspace packages, nodeModulesPaths = app + root node_modules, symlinks
// followed), so the hand-written monorepo overrides this file used to carry are gone (MOB-SDK-1: expo-doctor flags
// them). The offline cache module is `core/offline/sqlite.store.ts` — not `sqlite.db.ts` — because `db` is one of
// Expo's asset extensions and `./sqlite.db` would resolve as a .db asset. See https://docs.expo.dev/guides/monorepos/.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
