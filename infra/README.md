# infra — Terraform + Helm (AWS ap-south-1 primary, ap-south-2 DR)
terraform/modules: vpc, eks, aurora (writer+replicas, RDS proxy), redis,
opensearch, s3-cdn, secrets, observability (Datadog), waf.
envs/dev|staging|prod compose the modules; prod adds cross-region snapshots.
helm/: one chart per app; HPA on api/worker; PDBs; canary via Argo Rollouts.
Cell principle: a country = one full env instantiation (Phase 4+).

**Start here (beginner, end to end):** [AWS-GUIDEBOOK.md](AWS-GUIDEBOOK.md) — staging → production on AWS, step by step, in order. The runbooks below are the detailed references it links to.
