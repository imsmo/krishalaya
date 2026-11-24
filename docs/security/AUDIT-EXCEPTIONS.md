# Dependency-audit exceptions

`pnpm audit --audit-level high` gates CI (ci.yml, mobile-ci.yml, security-scan.yml). Every advisory listed here is
**ignored by ID** in `package.json` → `pnpm.auditConfig.ignoreGhsas`, so CI stays red on anything new. Nothing is
ignored by package name or severity. Each entry says why it is not exploitable here and what removes it.

Recorded 2026-11-24 (PC-56 SEC-5), after the SEC wave fixed every other high/critical advisory:
SEC-1 same-line patches (26 versions), SEC-2 Next 15.5.29, SEC-3 @nestjs/microservices removed (unused),
SEC-4 zod 4 on the server, SEC-5 zod 4 under Expo's babel plugin.

## Exit criterion for every entry below: the Expo SDK upgrade (MOB-SDK-1)

All five packages arrive through Expo SDK 51 / React Native 0.74 (`apps/mobile`). Their fixes need a new major of each,
and forcing those under Expo's own toolchain (image-size 2 changed its API; decode-uri-component ≥ 0.4 is ESM-only)
risks breaking builds that only device QA could catch. Upgrading the Expo SDK moves all of them and is the planned fix.
**When MOB-SDK-1 lands, delete this file's entries and the matching `ignoreGhsas` lines, and re-run the audit.**

How "shipped or not" was decided: a real `expo export --platform android --source-maps` of the app, and the list of
`node_modules` packages in the shipped Hermes bundle's source map (118 packages).

### Build-time only — never shipped in the app, never fed untrusted input

| Package | Version | Where it runs | Advisories |
|---|---|---|---|
| `tar` | 6.2.1 | Expo CLI on the build machine (extracting Expo's own templates from npm) | GHSA-23hp-3jrh-7fpw (critical: parse DoS), GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w, GHSA-8x88-c5mf-7j5w, GHSA-r292-9mhp-454m |
| `@xmldom/xmldom` | 0.7.13 | Expo config plugins / plist during `expo prebuild` (reads and writes the project's own iOS/Android files) | GHSA-wh4c-j3r5-mjhp, GHSA-2v35-w6hq-6mfw, GHSA-f6ww-3ggp-fr8h, GHSA-x6wf-f3px-wcqx, GHSA-j759-j44w-7fr8, GHSA-w2rr-34g9-rvrj, GHSA-4w3w-2rp5-g8jm, GHSA-c7q8-3ch8-vqpv, GHSA-27p8-2357-5qqv, GHSA-8344-3jmq-59r6, GHSA-x4fp-j954-r2f4, GHSA-965w-775f-mr7g, GHSA-93r5-fhx6-vmg9 |
| `image-size` | 1.2.1 | Metro/Expo asset tooling on the build machine (the repo's own images) | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr |
| `turbo-stream` | 2.4.1 | Expo's dev/server tooling (React Router single-fetch); the advisory is a server DoS and the app runs no such server | GHSA-rxv8-25v2-qmq8 |

The inputs are the repository's own files and Expo's own published templates. A build machine that is fed hostile
archives or XML has a bigger problem than these advisories.

### Shipped in the app — accepted, low impact

| Package | Version | Where it runs | Advisory | Why accepted until MOB-SDK-1 |
|---|---|---|---|---|
| `decode-uri-component` | 0.2.2 | In the app: react-navigation → `query-string` parses deep-link URLs | GHSA-qr28-fpjm-wq7f (quadratic time on crafted percent-encoded input) | Worst case: a user opens a crafted link and the app on **their own phone** stalls until restarted. No server, no data, no other user is affected. The fixed releases are ESM-only and `query-string@7` `require()`s it, so a forced override would break link parsing — a worse outcome than the advisory. |

## Rules for this file

- Add an entry only with: the advisory ID, where the code runs (shipped or build-time, with evidence), why it is not
  exploitable or what the real impact is, and the exit criterion. Never ignore a server-side advisory here.
- Never widen an entry to a package or a severity.
- Review at every Expo, React Native or dependency wave.
