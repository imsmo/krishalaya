#!/usr/bin/env bash
# db/prod/create-roles.sh · grant LOGIN to the app DB roles in PRODUCTION using strong passwords from
# AWS Secrets Manager. Run ONCE after migrations, and again on password rotation. Requires aws + psql.
#
#   PROJECT=krishalaya-prod REGION=ap-south-1 ./db/prod/create-roles.sh
#
# Expects in Secrets Manager (create these first — see SECRETS-RUNBOOK):
#   <PROJECT>/db/kv_app_password, <PROJECT>/db/kv_wallet_password, <PROJECT>/db/kv_relay_password
# and the Aurora master credentials secret (from Terraform output aurora_master_secret_arn).
set -euo pipefail

PROJECT="${PROJECT:-krishalaya-prod}"
REGION="${REGION:-ap-south-1}"
MASTER_SECRET_ARN="${MASTER_SECRET_ARN:?set MASTER_SECRET_ARN (terraform output aurora_master_secret_arn)}"
WRITER_HOST="${WRITER_HOST:?set WRITER_HOST (terraform output aurora_writer_endpoint)}"
DB_NAME="${DB_NAME:-krishalaya}"

sm() { aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output text; }

echo ">> reading secrets (values never printed)"
MASTER_JSON="$(sm "$MASTER_SECRET_ARN")"
MASTER_USER="$(echo "$MASTER_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])')"
MASTER_PW="$(echo "$MASTER_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')"
APP_PW="$(sm "$PROJECT/db/kv_app_password")"
WALLET_PW="$(sm "$PROJECT/db/kv_wallet_password")"
RELAY_PW="$(sm "$PROJECT/db/kv_relay_password")"

# refuse weak/dev passwords (fail closed)
for n in APP_PW WALLET_PW RELAY_PW; do
  v="${!n}"
  if [ "${#v}" -lt 16 ] || echo "$v" | grep -qiE 'dev|change|password|^postgres$'; then
    echo "FATAL: $n is weak/dev — refusing to set it in production." >&2; exit 1
  fi
done

MASTER_URL="postgresql://${MASTER_USER}:${MASTER_PW}@${WRITER_HOST}:5432/${DB_NAME}?sslmode=require"

echo ">> granting LOGIN to kv_app / kv_wallet / kv_relay (strong passwords)"
PGPASSWORD="$MASTER_PW" psql "$MASTER_URL" \
  -v ON_ERROR_STOP=1 \
  -v kv_app_pw="$APP_PW" -v kv_wallet_pw="$WALLET_PW" -v kv_relay_pw="$RELAY_PW" \
  -f "$(dirname "$0")/bootstrap-roles.sql"

echo ">> done. (Build each service's DATABASE_URL from these passwords in Secrets Manager — never echo them.)"
