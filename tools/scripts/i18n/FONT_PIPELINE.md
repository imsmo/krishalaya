# Font pipeline (Q35) — DEV-21

**Status: config + docs, honestly disclosed as such.** This repo carries **zero font binaries** anywhere
(`find apps/mobile -iname "*.ttf" -o -iname "*.woff*"` → empty, verified before this batch's first line of code).
Every claim below is either (a) code that runs today with no network/toolchain dependency, or (b) a documented
procedure that a future CI run or engineer with network access executes — never a fabricated "it works" claim for
something this sandbox cannot actually do.

## The law this pipeline enforces

> "Font pack per language | ≤120KB WOFF2, subsetted, weights 400/700 initially | founder §17 approval to loosen"
> — `developer-handoff.md` §7, Performance-budgets table, **Q35 ruling**.

## What's real, right now

| Piece | File | Runnable in this sandbox? |
|---|---|---|
| Font-pack manifest (12 packs: family, Google Fonts param, weights, script coverage, budget, ratification status) | `packages/i18n/src/fontPacks.ts` | Yes — plain TS, no network. Unit-tested (`registry.spec.ts`). |
| Language → font-pack mapping (14 languages, `fontPack` field) | `packages/i18n/src/languages.ts` | Yes — same. |
| Q35 budget checker (≤120KB WOFF2, real byte-size check on any file dropped in) | `tools/scripts/i18n/check-font-budget.js` | **Yes, fully.** Exit 0/1, CI-wireable today. Tested against synthetic fixtures (`__tests__/check-font-budget.test.js`) since no real font binary exists yet to test against. |
| Unicode-range hints per script | `tools/scripts/i18n/build-font-pack.sh` (`UNICODE_RANGES` table) | Yes — a static lookup table, cites BRAND-016. |

## What requires an environment this sandbox doesn't have

| Step | Needs | Why not run here |
|---|---|---|
| Fetch a font family from Google Fonts | Outbound network to `fonts.googleapis.com`/`fonts.gstatic.com` | Same constraint BRAND-015's own authoring session hit ("outbound web-fetch tool timed out on every attempt") — this dev sandbox has no outbound network either. |
| Subset to a script's Unicode range at weights 400/700 | Python `fonttools` (`pyftsubset`) + `brotli` | Not installed here; per contract §7, no new dependency/toolchain is silently bundled into a batch — this is a call for whoever runs the pipeline for real (CI job or an engineer's dev machine with network). |

`build-font-pack.sh` documents both steps as **exact, copy-pasteable commands** (not vague prose) — see the script
itself. Its own Step 4 (budget-check whatever `.woff2` files exist in the output dir) **is real and runs today**;
run against an empty output dir it correctly reports "nothing to check yet, not a failure" rather than a fake pass.

## The 12 font packs (from `packages/i18n/src/fontPacks.ts`)

| id | family | script | status | languages using it |
|---|---|---|---|---|
| `hind` | Hind | Devanagari | shipped | hi (live), mr (target) |
| `plusJakartaSans` | Plus Jakarta Sans | Latin | shipped | en (live) |
| `hindVadodara` | Hind Vadodara | Gujarati | shipped | gu (live) |
| `hindSiliguri` | Hind Siliguri | Bengali | verified-live-fetch | bn, as (target) |
| `hindGuntur` | Hind Guntur | Telugu | verified-live-fetch | te (target) |
| `hindMadurai` | Hind Madurai | Tamil | verified-live-fetch | ta (target) |
| `balooPaaji2` | Baloo Paaji 2 | Gurmukhi | verified-live-fetch | pa (target) |
| `balooTamma2` | Baloo Tamma 2 | Kannada | verified-live-fetch | kn (target) |
| `balooChettan2` | Baloo Chettan 2 | Malayalam | verified-live-fetch | ml (target) |
| `balooBhaina2` | Baloo Bhaina 2 | Odia | verified-live-fetch | or (target) |
| `notoNaskhArabic` | Noto Naskh Arabic | Arabic | demo-face | ar (target) — DEMO face only, not founder-ratified as launch body face (BRAND-017) |
| `notoNastaliqUrdu` | Noto Nastaliq Urdu | Arabic (Nastaliq) | demo-face | ur (target) — forward canon, BRAND-018, still fully machine-draft |

"verified-live-fetch" means BRAND-015/APPLY-4/APPLY-5 already fetched `fonts.googleapis.com/css2?family=...` for
that family and got 200 OK with real `@font-face` rules (dated 2026-07-21) — the family DEFINITELY exists on
Google Fonts. It does **not** mean a subsetted `.woff2` has been produced or budget-checked yet — that is exactly
the gap this pipeline closes once run with network.

## Running it for real (future CI/engineer step)

```bash
# 1. Install the one-time toolchain (documented here, not silently added to package.json):
pip install fonttools brotli

# 2. Build a pack (network required):
./tools/scripts/i18n/build-font-pack.sh hindSiliguri Bengali dist/fonts/bn

# 3. The budget check runs automatically as the pipeline's last step, and can also be run standalone against
#    any directory or explicit file list, in CI or locally, no network required:
node tools/scripts/i18n/check-font-budget.js --dir dist/fonts
node tools/scripts/i18n/check-font-budget.js dist/fonts/bn/hindSiliguri-400.woff2
```

## CI wiring

See `.github/workflows/canon-fidelity.yml` — its `font-budget` job runs `check-font-budget.js --dir` against
whatever font output directory a build step produces, in the same job pattern as this repo's other 9 workflows
(checkout → setup-node/pnpm → run script). Until a real build step produces `.woff2` files, this job passes
honestly with "nothing to check yet" (exit 0) rather than being skipped silently — the gate exists and is proven
correct (unit-tested), it just has nothing to check against in a repo with no font binaries yet.
