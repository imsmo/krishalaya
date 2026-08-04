#!/usr/bin/env bash
# infra/scripts/dr-failover.sh · controlled DR failover helper. For an in-region AZ failure Aurora fails over
# automatically; this drives the DELIBERATE cross-region promotion (when the cross-region Aurora Global secondary
# from the DR wave exists — P0-7 DR / deferred dr.tf). Prints the runbook steps + executes the promote if -y.
set -euo pipefail
REGION_DR="${REGION_DR:-ap-south-2}"; GLOBAL="${GLOBAL_CLUSTER:-krishalaya-global}"; SECONDARY="${SECONDARY:-krishalaya-dr-aurora}"
echo "DR failover plan (cross-region):"
echo "  1. Confirm the primary region is truly down (not a transient blip) — incident commander decision."
echo "  2. Promote the DR-region secondary to standalone writer:"
echo "       aws rds failover-global-cluster --region $REGION_DR --global-cluster-identifier $GLOBAL --target-db-cluster-identifier arn:aws:rds:$REGION_DR:...:cluster:$SECONDARY"
echo "  3. Repoint Route53 (DNS) + the app DATABASE_URL secrets at the DR writer; redeploy/restart pods."
echo "  4. Verify wallet reconciliation zero-sum on the promoted cluster BEFORE reopening writes."
if [ "${1:-}" = "-y" ]; then
  echo ">> executing global failover…"
  aws rds failover-global-cluster --region "$REGION_DR" --global-cluster-identifier "$GLOBAL" \
    --target-db-cluster-identifier "$SECONDARY"
else
  echo "(dry-run; pass -y to execute. Requires the cross-region Aurora Global secondary — DR wave / dr.tf.)"
fi
