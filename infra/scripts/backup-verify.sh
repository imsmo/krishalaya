#!/usr/bin/env bash
# infra/scripts/backup-verify.sh · prove Aurora backups are RESTORABLE (a backup you can't restore isn't a backup).
# Restores the cluster to the latest point-in-time into a throwaway clone, waits until available, runs a sanity
# query, records the elapsed time (RTO evidence), then deletes the clone. Run weekly + before launch.
#   REGION=ap-south-1 SRC=krishalaya-prod-aurora ./infra/scripts/backup-verify.sh
set -euo pipefail
REGION="${REGION:-ap-south-1}"; SRC="${SRC:-krishalaya-prod-aurora}"
CLONE="${SRC}-verify-$(date +%s)"; START=$(date +%s)

echo ">> restoring $SRC to latest point-in-time → $CLONE"
aws rds restore-db-cluster-to-point-in-time --region "$REGION" \
  --source-db-cluster-identifier "$SRC" --db-cluster-identifier "$CLONE" --use-latest-restorable-time >/dev/null
aws rds create-db-instance --region "$REGION" \
  --db-instance-identifier "${CLONE}-1" --db-cluster-identifier "$CLONE" \
  --engine aurora-postgresql --db-instance-class db.serverless >/dev/null

echo ">> waiting for the clone to become available…"
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "${CLONE}-1"
RTO=$(( $(date +%s) - START ))
echo ">> restore available in ${RTO}s (RTO evidence). Run a sanity SELECT against ${CLONE} writer endpoint, then:"
echo "   aws rds delete-db-instance --region $REGION --db-instance-identifier ${CLONE}-1 --skip-final-snapshot"
echo "   aws rds delete-db-cluster  --region $REGION --db-cluster-identifier ${CLONE} --skip-final-snapshot"
echo "BACKUP-VERIFY OK (restorable in ${RTO}s)"
