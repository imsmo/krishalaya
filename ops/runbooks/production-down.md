# Runbook: production down (ApiTargetDown / total outage) — SEV0/1

**Page source:** `ApiTargetDown`, `ApiPodCrashLooping` (ops/alerts/api-alerts.yml).
1. Ack in PagerDuty. Open the incident channel; assign IC + comms.
2. Triage fast: `kubectl -n krishalaya get pods` → which service? `kubectl logs deploy/<svc> --tail=200`.
3. Common causes: bad deploy (→ `helm rollback <release>`), DB unreachable (check `db-alerts`), secret missing
   (pod CrashLoop on boot = `assertProductionSecurity` failing — check the env Secret), node pressure (HPA/scale).
4. Mitigate first (rollback / scale / restore), root-cause after. Update statuspage every 30m.
5. Postmortem (blameless) within 48h → ops/runbooks/incident-sev0.md template.
