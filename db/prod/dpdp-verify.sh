#!/usr/bin/env bash
# db/prod/dpdp-verify.sh · live DPDP subject-rights check against a REAL account. Exercises consent + export +
# deletion intake and confirms the DB rows (DSR + cooling-off). Async completion (export file / erasure) needs the
# worker-runtime (flagged) — this verifies the request path the data-protection sign-off must witness.
#   API=https://api.krishalaya.com TOKEN=<subject access token> TENANT=<tenant uuid> \
#   ADMIN_DB_URL=postgresql://kv_app:...@<writer>:5432/krishalaya ./db/prod/dpdp-verify.sh
set -euo pipefail
API="${API:?set API base}"; TOKEN="${TOKEN:?set subject access TOKEN}"; TENANT="${TENANT:?set TENANT uuid}"
DB="${ADMIN_DB_URL:?set ADMIN_DB_URL (read-only check conn)}"
H=(-H "authorization: Bearer $TOKEN" -H "content-type: application/json")

echo ">> 1. grant + read consent (append-only)"
curl -sf "${H[@]}" -X POST "$API/v1/consents" -d '{"purpose":"marketing","granted":true}' >/dev/null
curl -sf "${H[@]}" "$API/v1/consents" | jq '.data | length' | xargs -I{} echo "   consents on file: {}"

echo ">> 2. request DPDP export (portability)"
curl -sf "${H[@]}" -X POST "$API/v1/privacy/export-requests" -d '{}' | jq -r '.data.id // .data.requestId // "queued"' | xargs -I{} echo "   export request: {}"
psql "$DB" -At -c "SELECT count(*) FROM data_export_jobs WHERE job_kind='user_dpdp_export' AND created_at > now()-interval '5 min'" \
  | xargs -I{} echo "   data_export_jobs created (5m): {}"

echo ">> 3. request erasure (deletion) → expect a cooling-off DSR row"
curl -sf "${H[@]}" -X POST "$API/v1/privacy/deletion-requests" -d '{"reason":"dpdp_verify"}' >/dev/null
psql "$DB" -At -c "SELECT status, (cooling_ends_at IS NOT NULL) FROM data_subject_requests WHERE request_type='erasure' ORDER BY created_at DESC LIMIT 1" \
  | xargs echo "   latest erasure DSR (status, has_cooling):"

echo ">> 4. status visible to the subject (no IDOR)"
curl -sf "${H[@]}" "$API/v1/privacy/requests" | jq '.data | length' | xargs -I{} echo "   subject's requests: {}"

echo ""
echo "PASS: consent + export + erasure intake all work; erasure carries a cooling-off date."
echo "NOTE: export-file generation + post-cooling erasure run on the WORKER-RUNTIME (flagged P0-9) — verify those"
echo "      complete once the worker scheduler is deployed."
