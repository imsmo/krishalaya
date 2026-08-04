#!/usr/bin/env bash
# ops/load-tests/pilot/run-pilot-gate.sh (Sprint S5)
#
# Runs the PILOT-scale k6 load gate against $STAGING_API_URL: order-flow (browse + a realistic slice
# of checkout+payment-intent) and realtime-sockets (own-order-channel WS subscribers), sequentially,
# each saving a timestamped JSON summary. Add --soak to also run the 60-minute soak variant of
# soak-72h.js at pilot scale (see profile.env PILOT_SOAK_VUS/PILOT_SOAK_DURATION).
#
# What this intentionally does NOT run: k6-auction-burst.js, k6-mcc-morning-peak.js,
# k6-billion-scale-model.js (EXCLUDED at pilot — auctions/dairy modules OFF for the pilot thin slice,
# billion-scale is a capacity *model* not a run) or k6-payout-batch.js (EXCLUDED — the endpoint it
# targets has zero live invocation path in the current codebase; see README "Per-script disposition").
#
# Usage:
#   cp profile.env.example profile.env   # once, then fill in TENANT_ID/TOKENS/LISTING_ID
#   ./run-pilot-gate.sh                  # ramp -> sustain(10m) -> spike(2x) -> drain
#   ./run-pilot-gate.sh --soak           # ... plus a 60-min soak afterwards
#   ./run-pilot-gate.sh --env-file /path/to/other.env [--soak]
#
# Requires: k6 (https://k6.io) on PATH, `node` (for the summary table + provisioning script).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOAD_TESTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/profile.env"
RUN_SOAK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --soak) RUN_SOAK=true; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  echo "Copy profile.env.example to profile.env and fill it in first." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

: "${STAGING_API_URL:?Set STAGING_API_URL in ${ENV_FILE}}"
: "${TENANT_ID:?Set TENANT_ID in ${ENV_FILE}}"

if [[ -z "${TOKENS:-}" ]]; then
  echo "WARNING: TOKENS is empty — order-flow/realtime-sockets will only exercise the anonymous" >&2
  echo "         public-browse path. Run provision-loadtest-identities.mjs first for full coverage." >&2
fi

# ── money-safety guard, loud and non-negotiable ────────────────────────────────────────────────
# S5 REVIEW FIX: host-anchored allow-on-'staging' guard. The old substring refusal
# (*api.krishalaya.com*) also refused legitimate staging hosts that CONTAIN the prod
# string (e.g. api.staging.krishalaya.com — the canonical convention per terraform/S1).
# New rule: the URL host MUST contain 'staging' (or be localhost/127.0.0.1) — anything
# else is treated as production and refused. Blocks prod under every naming scheme.
case "${STAGING_API_URL}" in
  *"staging"*|*"localhost"*|*"127.0.0.1"*)
    : # allowed — staging or local
    ;;
  *)
    echo "REFUSING TO RUN: STAGING_API_URL (${STAGING_API_URL}) does not look like a staging/local host" >&2
    echo "(host must contain 'staging', or be localhost). This gate must never target production. Aborting." >&2
    exit 1
    ;;
esac
echo "=========================================================================================="
echo " MONEY SAFETY: this gate creates payment INTENTS ONLY (POST /v1/payments). It NEVER calls"
echo " POST /v1/payments/webhooks/* or any other webhook. No ledger entry is created and no real"
echo " money moves. See README.md \"Money safety\" before you run this against anything but a"
echo " disposable staging environment with the sandbox payment gateway registered."
echo "=========================================================================================="

command -v k6 >/dev/null 2>&1 || { echo "k6 not found on PATH. Install k6 (https://k6.io) first." >&2; exit 1; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS_DIR="${SCRIPT_DIR}/results/${TS}"
mkdir -p "${RESULTS_DIR}"
echo "Results dir: ${RESULTS_DIR}"

declare -a RUN_NAMES=()
declare -a RUN_STATUS=()
declare -a RUN_SUMMARY=()

run_k6() {
  local name="$1" script="$2"
  shift 2
  local summary_file="${RESULTS_DIR}/${name}.summary.json"
  echo ""
  echo "── ${name} ──────────────────────────────────────────────────────────────────────────────"
  local rc=0
  k6 run \
    -e BASE="${STAGING_API_URL}" \
    -e WS_URL="${WS_URL:-}" \
    -e TENANT_ID="${TENANT_ID}" \
    -e TOKENS="${TOKENS:-}" \
    -e LISTING_ID="${LISTING_ID:-}" \
    -e PILOT_MODE=true \
    -e CHECKOUT_RATE="${CHECKOUT_RATE:-0.2}" \
    -e INCLUDE_MARKET_PULSE="${INCLUDE_MARKET_PULSE:-false}" \
    -e MARKET_PRODUCT_ID="${MARKET_PRODUCT_ID:-}" \
    -e PILOT_RAMP_MIN="${PILOT_RAMP_MIN:-2}" \
    -e PILOT_SUSTAIN_MIN="${PILOT_SUSTAIN_MIN:-10}" \
    -e PILOT_SUSTAIN_VUS="${PILOT_SUSTAIN_VUS:-20}" \
    -e PILOT_SPIKE_MIN="${PILOT_SPIKE_MIN:-2}" \
    -e PILOT_SPIKE_VUS="${PILOT_SPIKE_VUS:-50}" \
    -e PILOT_DRAIN_MIN="${PILOT_DRAIN_MIN:-1}" \
    -e PILOT_RT_SUSTAIN_VUS="${PILOT_RT_SUSTAIN_VUS:-20}" \
    -e PILOT_RT_SPIKE_VUS="${PILOT_RT_SPIKE_VUS:-50}" \
    -e PILOT_P95_MS="${PILOT_P95_MS:-800}" \
    -e PILOT_P99_MS="${PILOT_P99_MS:-2000}" \
    -e PILOT_ERR_RATE="${PILOT_ERR_RATE:-0.01}" \
    "$@" \
    --summary-export "${summary_file}" \
    "${script}" || rc=$?

  RUN_NAMES+=("${name}")
  if [[ ${rc} -eq 0 ]]; then RUN_STATUS+=("PASS"); else RUN_STATUS+=("FAIL(${rc})"); fi
  if [[ -f "${summary_file}" ]] && command -v node >/dev/null 2>&1; then
    RUN_SUMMARY+=("$(node "${SCRIPT_DIR}/summarize.mjs" "${summary_file}" 2>/dev/null || echo 'n/a')")
  else
    RUN_SUMMARY+=("n/a")
  fi
  return 0   # keep going so every included script gets a chance to run; overall gate fails at the end if any failed
}

run_k6 "order-flow" "${LOAD_TESTS_DIR}/k6-order-flow.js"
run_k6 "realtime-sockets" "${LOAD_TESTS_DIR}/k6-realtime-sockets.js"

if [[ "${RUN_SOAK}" == true ]]; then
  echo ""
  echo "── soak (pilot-scale, ${PILOT_SOAK_DURATION:-60m} @ ${PILOT_SOAK_VUS:-15} VUs) ──────────────────────────────"
  summary_file="${RESULTS_DIR}/soak.summary.json"
  rc=0
  k6 run \
    -e BASE="${STAGING_API_URL}" \
    -e VUS="${PILOT_SOAK_VUS:-15}" \
    -e DURATION="${PILOT_SOAK_DURATION:-60m}" \
    -e SOAK_P99_MS="${SOAK_P99_MS:-2500}" \
    -e SOAK_ERR_RATE="${SOAK_ERR_RATE:-0.01}" \
    --summary-export "${summary_file}" \
    "${LOAD_TESTS_DIR}/soak-72h.js" || rc=$?
  RUN_NAMES+=("soak")
  if [[ ${rc} -eq 0 ]]; then RUN_STATUS+=("PASS"); else RUN_STATUS+=("FAIL(${rc})"); fi
  if [[ -f "${summary_file}" ]] && command -v node >/dev/null 2>&1; then
    RUN_SUMMARY+=("$(node "${SCRIPT_DIR}/summarize.mjs" "${summary_file}" 2>/dev/null || echo 'n/a')")
  else
    RUN_SUMMARY+=("n/a")
  fi
fi

echo ""
echo "=========================================== SUMMARY ===================================="
printf "%-20s %-10s %s\n" "SCRIPT" "RESULT" "KEY METRICS"
printf "%-20s %-10s %s\n" "------" "------" "-----------"
overall_rc=0
for i in "${!RUN_NAMES[@]}"; do
  printf "%-20s %-10s %s\n" "${RUN_NAMES[$i]}" "${RUN_STATUS[$i]}" "${RUN_SUMMARY[$i]}"
  [[ "${RUN_STATUS[$i]}" == PASS ]] || overall_rc=1
done
echo "=========================================================================================="
echo "Full JSON summaries: ${RESULTS_DIR}/*.summary.json"

if [[ ${overall_rc} -eq 0 ]]; then
  echo "PILOT GATE: PASS — all included scripts held their thresholds."
else
  echo "PILOT GATE: FAIL — see the table above and the JSON summaries for detail."
fi
exit ${overall_rc}
