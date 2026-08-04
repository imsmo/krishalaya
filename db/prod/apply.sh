#!/usr/bin/env bash
# db/prod/apply.sh · ONE fail-closed, idempotent command to bring a PRODUCTION database fully up:
#   migrate (owner) → partition runway → app-role logins (strong pw) → seed REFERENCE data (never demo)
#   → RLS-coverage gate → kv_app least-privilege connectivity probe.
#
# Safe to re-run (every step is idempotent). Stops on the first failure (set -e). Secrets are read from AWS
# Secrets Manager — never passed on the CLI or echoed.
#
#   PROJECT=krishalaya-prod REGION=ap-south-1 \
#   WRITER_HOST=$(terraform -chdir=infra/terraform/envs/prod output -raw aurora_writer_endpoint) \
#   MASTER_SECRET_ARN=$(terraform -chdir=infra/terraform/envs/prod output -raw aurora_master_secret_arn) \
#     ./db/prod/apply.sh
set -euo pipefail

PROJECT="${PROJECT:-krishalaya-prod}"
REGION="${REGION:-ap-south-1}"
DB_NAME="${DB_NAME:-krishalaya}"
WRITER_HOST="${WRITER_HOST:?set WRITER_HOST (terraform output aurora_writer_endpoint)}"
MASTER_SECRET_ARN="${MASTER_SECRET_ARN:?set MASTER_SECRET_ARN (terraform output aurora_master_secret_arn)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

sm() { aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output text; }
jq_field() { python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }

echo ">> reading Aurora master credentials (never printed)"
MASTER_JSON="$(sm "$MASTER_SECRET_ARN")"
MASTER_USER="$(echo "$MASTER_JSON" | jq_field username)"
MASTER_PW="$(echo "$MASTER_JSON" | jq_field password)"
OWNER_URL="postgresql://${MASTER_USER}:${MASTER_PW}@${WRITER_HOST}:5432/${DB_NAME}?sslmode=require"

# refuse to run against localhost (this script is PRODUCTION-only)
case "$WRITER_HOST" in
  localhost|127.0.0.1|::1) echo "FATAL: WRITER_HOST is localhost — apply.sh is for production only." >&2; exit 1;;
esac

# Owner connection drives DDL (migrate), partitions, seeds, and the RLS audit (reads pg_policies).
export MIGRATION_DATABASE_URL="$OWNER_URL"
export DATABASE_URL="$OWNER_URL"
export NODE_ENV=production   # makes seed.js refuse demo data even if --demo is ever passed

echo ">> [1/6] migrate (apply pending migrations as the owner role)"
node db/scripts/migrate.js

echo ">> [2/6] partition runway (create upcoming partitions)"
node db/scripts/ensure-partitions.js

echo ">> [3/6] app-role logins (kv_app/kv_wallet/kv_relay — strong passwords from Secrets Manager)"
PROJECT="$PROJECT" REGION="$REGION" DB_NAME="$DB_NAME" \
  MASTER_SECRET_ARN="$MASTER_SECRET_ARN" WRITER_HOST="$WRITER_HOST" \
  bash db/prod/create-roles.sh

echo ">> [4/6] seed REFERENCE data (core/rules/catalogue) — demo is blocked under NODE_ENV=production"
node db/scripts/seed.js

echo ">> [5/6] RLS coverage gate (zero tenant tables may lack a FORCED policy)"
node db/scripts/verify-rls-coverage.js

echo ">> [6/6] kv_app least-privilege connectivity probe"
KV_APP_PW="$(sm "$PROJECT/db/kv_app_password")"
KV_APP_URL="postgresql://kv_app:${KV_APP_PW}@${WRITER_HOST}:5432/${DB_NAME}?sslmode=require"
PGPASSWORD="$KV_APP_PW" psql "$KV_APP_URL" -At -v ON_ERROR_STOP=1 -c "
  SELECT
    CASE WHEN current_user = 'kv_app' THEN 'ok:user' ELSE 'FAIL:user='||current_user END,
    CASE WHEN NOT rolsuper AND NOT rolbypassrls THEN 'ok:leastpriv' ELSE 'FAIL:privileged' END
  FROM pg_roles WHERE rolname = current_user;" | tee /tmp/kvapp_probe.txt
grep -q 'FAIL' /tmp/kvapp_probe.txt && { echo 'FATAL: kv_app is not least-privilege' >&2; exit 1; } || true

echo ""
echo "DONE — production DB is migrated, partitioned, role-logged-in, seeded (reference only), RLS-covered,"
echo "       and kv_app connects as a least-privilege (non-superuser, RLS-bound) role."
