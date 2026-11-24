# Runbook: payout stuck, or payout books ≠ gateway — SEV1 (money out)

**Page source:** `PayoutQueueNotDraining`, `PayoutGatewayConfirmationMissing`, `PayoutReconMismatch`, `PayoutReconStale`
(ops/alerts/payout-alerts.yml). Ticket: `PayoutUnreservedBatchPayouts`. Gauges come from apps/worker
(`payout-queue-monitor`, `payout-gateway-recon`); the daily run's detail is the newest `daily_gateway` row on the admin
reconciliation board (or `SELECT * FROM reconciliation_runs WHERE run_type='daily_gateway' ORDER BY created_at DESC LIMIT 1`).

**Never** re-send a payout by hand, and never edit a payout or ledger row. Every fix goes through the payout service,
which is idempotent per payout.

| Alert | What it means | First moves |
|---|---|---|
| PayoutQueueNotDraining | Payouts allowed to go (unbatched, or in an approved batch) have waited >15 min. | Is the api's `payout-execution` cadence job running (api logs "payout-execution cycle")? RazorpayX breaker open (`dep_failure{dep="razorpayx"}`)? A batch held for approval is NOT counted — that is `kv_payouts_awaiting_approval`. |
| PayoutGatewayConfirmationMissing | A payout went to the gateway >2 h ago and no webhook confirmed it. | Look the payout up in the RazorpayX dashboard by its `gateway_payout_id`. If RazorpayX shows it processed/reversed, the webhook was lost: check the webhook endpoint's delivery log and the `RAZORPAYX_WEBHOOK_SECRET`. Do not mark it by hand. |
| PayoutReconMismatch `reservation_missing` | A live payout has no reservation in the ledger, from a path that should have reserved. | Freeze further payouts for that tenant (kill-switch flag) and escalate to the wallet owner — the money path is broken. |
| PayoutReconMismatch `settled_without_gateway` | The books say sent/processing, the gateway has no id. | Usually the executor crashed between claiming and calling the gateway. Check RazorpayX by the payout's idempotency key before anything else. |
| PayoutReconMismatch `stuck_processing` | Processing >24 h. | As "confirmation missing", but older — contact RazorpayX support with the payout ids. |
| PayoutReconStale | No daily run for >30 h. | The worker is down or the job is failing: worker logs "job payout-gateway-recon failed". |
| PayoutUnreservedBatchPayouts (ticket) | Loan-disbursement / co-op-run payouts are queued without a reservation. | Known gap until the founder-signed money wave; only a ticket. If it appears while those flags are OFF, investigate. |
