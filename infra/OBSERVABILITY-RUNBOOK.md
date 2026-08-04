# Observability runbook — go-live (P0-6)

Stand up metrics + dashboards + alerting on the EKS cluster, then prove SLOs hold under load. Lean tier =
self-hosted kube-prometheus-stack (no managed-service cost). The app already exposes valid Prometheus metrics at
`/metrics` (P0-6a).

## 1. Install the stack
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts && helm repo update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f infra/k8s/observability/values-kube-prometheus-stack.yaml
```

## 2. Wire scraping + rules + dashboards + routing
```bash
# scrape our pods
kubectl apply -f infra/k8s/observability/servicemonitor.yaml
# alert + SLO rules (PrometheusRule)
kubectl apply -n monitoring -f ops/alerts/
# dashboards → ConfigMaps the Grafana sidecar auto-imports
for d in ops/dashboards/*.json; do
  kubectl create configmap "dash-$(basename "$d" .json)" -n monitoring \
    --from-file="$(basename "$d")=$d" --dry-run=client -o yaml \
    | kubectl label --local -f - grafana_dashboard=1 -o yaml | kubectl apply -f -
done
# PagerDuty/Slack keys (from Secrets Manager via External Secrets) then routing:
kubectl apply -f infra/k8s/observability/alertmanager-config.yaml
```

## 3. Verify telemetry is flowing
- Grafana → the six `Krishalaya ·` dashboards show live data.
- `up{namespace="krishiverse"}` = 1 for every service in Prometheus.
- Some app series exist after traffic: `auth_verify_otp_count`, `dep_call`, `payments_webhook_count`.

## 4. Arm + test alerting (must page on a real fault)
- Scale a deployment to 0 → `ApiTargetDown` fires → PagerDuty pages the primary on-call. Ack, then restore.
- Confirm `severity: ticket` alerts land in Slack `#kv-alerts`, `severity: page` go to PagerDuty.

## 5. Load + soak at target scale (cluster-only)
```bash
BASE=https://api.krishiverse.ai k6 run ops/load-tests/k6-order-flow.js      # ramp to 500 VUs; SLO gates inline
k6 run -e WS_URL=wss://rt.krishiverse.ai -e TOKEN=... ops/load-tests/k6-realtime-sockets.js   # socket soak
k6 run ops/load-tests/soak-72h.js                                            # 72h endurance (dedicated box)
```
Watch golden-signals + db-health + wallet-invariants throughout. **The run passes when SLOs (slo.md) hold and no
`page` alert fires for legitimate load** (only injected faults should page).

## Required app counters (flag if missing)
A few alerts/dashboards reference counters the **jobs** must emit; add them where not already present:
`kv_recon_mismatches` + `kv_recon_age_seconds` (reconciliation job), `kv_outbox_pending` (outbox relay),
`kv_stream_dlq_total` (stream-processor), `kv_partition_days_ahead` (partition job), `kv_sms_spend_paise` (SMS
sender). These are small `metrics.inc/observe` additions in their owning service — wire them as those jobs go live.

## Done when
Dashboards show real traffic; alerts fire on injected faults and page on-call; the k6 load run holds SLOs; the 72h
soak passes on the cluster.
