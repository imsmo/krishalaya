# infra/k8s/observability

Self-hosted observability for the lean launch tier (kube-prometheus-stack on EKS — no extra managed-service cost).
Apply order is in `infra/OBSERVABILITY-RUNBOOK.md`. Contents:
- `values-kube-prometheus-stack.yaml` — Helm values (Prometheus retention/storage, Grafana, Alertmanager).
- `servicemonitor.yaml` — scrapes `/metrics` on every `part-of: krishalaya` pod.
- `alertmanager-config.yaml` — severity routing (page → PagerDuty, ticket → Slack; keys from a Secret).
- The alert rules live in `ops/alerts/*.yml` (PrometheusRule); dashboards in `ops/dashboards/*.json` (load as
  ConfigMaps labelled `grafana_dashboard`).
