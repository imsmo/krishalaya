# Dependency-audit exceptions

`pnpm audit --audit-level high` gates CI (ci.yml, mobile-ci.yml, security-scan.yml). Every advisory listed here is
**ignored by ID** in `package.json` → `pnpm.auditConfig.ignoreGhsas`, so CI stays red on anything new. Nothing is
ignored by package name or severity. Each entry says why it is not exploitable here and what removes it.

## Current exceptions: none

`pnpm.auditConfig.ignoreGhsas` is absent from `package.json`; `pnpm audit --audit-level high` passes with nothing
ignored (2026-11-24: 0 critical, 0 high; the remaining low/moderate findings are below the CI gate).

## History

- **2026-11-24, PC-56 SEC-5** — 26 advisories were ignored by ID, all arriving through the Expo SDK 51 / React Native
  0.74 toolchain of `apps/mobile`: `tar` 6.2.1 (9), `@xmldom/xmldom` 0.7.13 (13), `image-size` 1.2.1 (2) and
  `turbo-stream` 2.4.1 (1) at build time only, and `decode-uri-component` 0.2.2 (GHSA-qr28-fpjm-wq7f, shipped in the
  app through react-navigation → `query-string`). Exit criterion: the Expo SDK upgrade (MOB-SDK-1).
- **2026-11-24, PC-56 MOB-SDK-1** — Expo SDK 58 (React Native 0.88, React 19.3, Expo Router 58). A `pnpm audit` run
  with every ignore removed reports none of the 26 advisories; all 26 IDs and the two Expo-51-only overrides
  (`babel-plugin-react-compiler>zod`, `zod-validation-error>zod`) plus the `@expo/config-plugins` 8.0.11 pin were
  deleted from `package.json`.

## Rules for this file

- Add an entry only with: the advisory ID, where the code runs (shipped or build-time, with evidence), why it is not
  exploitable or what the real impact is, and the exit criterion. Never ignore a server-side advisory here.
- Never widen an entry to a package or a severity.
- Review at every Expo, React Native or dependency wave.
