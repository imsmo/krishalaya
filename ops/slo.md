# Service Level Objectives — Krishalaya (P0-6)

SLOs for the four hot paths. Latency is measured from the per-use-case summaries the API emits (`<name>{quantile}`
+ `<name>_count{ok}`); availability from the `ok="true"` ratio. Recording + burn-rate alerts:
`ops/alerts/slo-recording-rules.yml`. Error budgets are monthly (30d).

| Path | Metric base | Availability SLO | Latency SLO | Error budget (30d) |
|------|-------------|------------------|-------------|--------------------|
| **Auth (OTP verify)** | `auth_verify_otp` | 99.9% verify success | p99 < 1.5 s | 43m |
| **Payment capture** | `payments_webhook` (captured/total) | 99.9% of webhooks processed | p99 < 2 s | 43m |
| **Auction bid** | `auctions_place_bid` | 99.9% accepted-or-cleanly-rejected | p99 < 1 s | 43m |
| **Listings read** | `listings_search` | 99.95% | p99 < 800 ms | 21m |

## Burn-rate policy (multi-window)
- **Fast burn** (14.4× budget over 5m) → **page** (severity: page). Something is actively broken.
- **Slow burn** (3× over 1h) → ticket. Degrading; investigate same-day.

## Dashboards
- `ops/dashboards/api-golden-signals.json` (rate/errors/latency per use-case + dep health)
- `ops/dashboards/wallet-invariants.json` (ledger zero-sum + recon age — the money SLO is correctness, not latency)

## Reviewing SLOs
Revisit after the first month of real traffic and after each P0-6 load run. Tighten only when the budget is
consistently underspent; loosen only with a written justification (never silently).
