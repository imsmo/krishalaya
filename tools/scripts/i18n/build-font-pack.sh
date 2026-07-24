#!/usr/bin/env bash
# tools/scripts/i18n/build-font-pack.sh · Q35 font-pack build pipeline (DEV-21) — CONFIG + DOCUMENTATION, not a
# tool this sandbox can execute end-to-end. Read FONT_PIPELINE.md first for the full honest boundary statement.
#
# WHAT THIS SCRIPT DOES: fetches one font family from Google Fonts (per BRAND-015's ratified candidate list),
# subsets it to the target script's Unicode range at the requested weights, and runs it through
# check-font-budget.js so a pack that blows the Q35 ≤120KB ceiling is caught before it ever reaches a build.
#
# WHY IT CANNOT RUN HERE, TODAY (stated up front, not discovered late):
#   1. Outbound network access to fonts.googleapis.com/fonts.gstatic.com is unavailable in this sandbox (the same
#      constraint BRAND-015's own authoring session hit — "outbound web-fetch tool timed out on every attempt").
#   2. The subsetting step needs `fonttools`'s `pyftsubset` (Python) — not installed here, and per contract §7
#      ("no new dependency added without a one-line justification... in the PR description"), installing a new
#      Python toolchain is a call for whoever runs this in a real CI/dev environment with network, not something
#      to silently bundle into this batch.
# This script is therefore the CONFIG + DOCUMENTED PROCEDURE deliverable the DEV-21 brief explicitly asks for
# ("pipeline-as-config + docs is the honest deliverable, state it") — copy-pasteable and correct, not a fake run.
#
# Usage (once run in an environment with network + fonttools):
#   ./build-font-pack.sh <fontPackId> <script> <outDir>
#   e.g. ./build-font-pack.sh hindSiliguri Bengali dist/fonts/bn
#
# Requires: curl, python3 with `fonttools` (`pip install fonttools brotli`), node (for the budget check).
set -euo pipefail

FONT_PACK_ID="${1:?Usage: build-font-pack.sh <fontPackId> <script> <outDir>}"
SCRIPT_NAME="${2:?script name required, e.g. Bengali}"
OUT_DIR="${3:?outDir required}"

# Unicode-range hints per script (BRAND-016 script-metrics terminology; ranges are conservative supersets — a
# real subsetting pass should tighten per Q35's "engineering may tighten this ceiling" clause). These are the
# same script names FONT_PACKS in packages/i18n/src/fontPacks.ts declares under `scriptCoverage`.
declare -A UNICODE_RANGES=(
  [Devanagari]="U+0900-097F"
  [Gujarati]="U+0A80-0AFF"
  [Bengali]="U+0980-09FF"
  [Telugu]="U+0C00-0C7F"
  [Tamil]="U+0B80-0BFF"
  [Gurmukhi]="U+0A00-0A7F"
  [Kannada]="U+0C80-0CFF"
  [Malayalam]="U+0D00-0D7F"
  [Odia]="U+0B00-0B7F"
  [Arabic]="U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF"
  [Latin]="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+2000-206F"
)

RANGE="${UNICODE_RANGES[$SCRIPT_NAME]:-}"
if [ -z "$RANGE" ]; then
  echo "ERROR: no unicode-range hint for script '$SCRIPT_NAME'. Add one to UNICODE_RANGES above (cite BRAND-016)." >&2
  exit 1
fi

echo "== Font pack: $FONT_PACK_ID (script: $SCRIPT_NAME, unicode-range: $RANGE) =="
mkdir -p "$OUT_DIR"

# Step 1 — read the family + weights from the manifest (packages/i18n/src/fontPacks.ts is the source of truth;
# this grep is a documentation convenience, not a real parser — a real CI job should import the TS module or
# regenerate a JSON sidecar via `tsc` first).
echo "Step 1: cross-check packages/i18n/src/fontPacks.ts for '$FONT_PACK_ID' (family, weights, googleFontsFamilyParam)."
grep -A 3 "id: '$FONT_PACK_ID'" "$(dirname "$0")/../../../packages/i18n/src/fontPacks.ts" || {
  echo "ERROR: '$FONT_PACK_ID' not found in fontPacks.ts — do not invent a pack id." >&2; exit 1; }

# Step 2 — fetch the Google Fonts CSS (per BRAND-015: "loads N Google Fonts families beyond the shipped 5").
# Requires network. NOT run in this batch.
echo "Step 2 (requires network — NOT executed in this sandbox):"
echo "  curl -sS 'https://fonts.googleapis.com/css2?family=<googleFontsFamilyParam>&display=swap' -o \"$OUT_DIR/raw.css\""
echo "  # then extract each @font-face src url(...) and curl each .ttf/.woff2 asset referenced"

# Step 3 — subset to the target script + weights 400/700 (Q35: "subsetted, weights 400/700 initially").
# Requires fonttools (pip install fonttools brotli). NOT run in this batch.
echo "Step 3 (requires fonttools — NOT executed in this sandbox):"
echo "  pyftsubset \"$OUT_DIR/raw-400.ttf\" --unicodes=\"$RANGE\" --flavor=woff2 --output-file=\"$OUT_DIR/${FONT_PACK_ID}-400.woff2\""
echo "  pyftsubset \"$OUT_DIR/raw-700.ttf\" --unicodes=\"$RANGE\" --flavor=woff2 --output-file=\"$OUT_DIR/${FONT_PACK_ID}-700.woff2\""

# Step 4 — the ONE step that IS real and runnable right now: budget-check whatever subset .woff2 files exist in
# OUT_DIR. If steps 2-3 haven't been run (no network here), this correctly reports "nothing to check yet".
echo "Step 4 (REAL, runs now):"
node "$(dirname "$0")/check-font-budget.js" --dir "$OUT_DIR"
