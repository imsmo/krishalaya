# P0-1 progress — production cloud infrastructure

Tracks what was built in this wave vs. what is **explicitly deferred** to follow-on waves (per the contract: never
silently skip — flag it).

## Decisions (from the user)
- **Cloud / region:** AWS **ap-south-1 (Mumbai)** — DPDP data residency for Indian PII.
- **Scope this session:** foundation data-plane modules + apply runbook (the user's option 1 & 3).
- **Scale tier:** lean / minimal (cost-aware), but **security fundamentals kept non-negotiable** regardless of tier
  (KMS encryption everywhere, Aurora PITR + backups + deletion-protection, private/isolated data subnets,
  least-privilege SGs, TLS-only S3, generated secrets in Secrets Manager).

## ✅ Built this wave (real, parses clean; `terraform validate` to be run by the user per the runbook)
| Component | Path | Notes |
|-----------|------|-------|
| VPC | `modules/vpc` | 2-AZ, public/private/**isolated data** subnets, single NAT (lean), S3 gateway endpoint, flow logs |
| EKS | `modules/eks` | private+restricted-public API, SPOT managed node group w/ autoscaling, IRSA OIDC, core addons, KMS secret encryption |
| Aurora PostgreSQL 16 | `modules/aurora` | Serverless v2 writer **+ reader**, KMS-encrypted, **PITR ≥7d**, master secret in Secrets Manager, `statement_timeout`/`lock_timeout`, force-SSL |
| Redis 7 | `modules/redis` | ElastiCache, at-rest+in-transit encryption, AUTH token, multi-AZ failover |
| OpenSearch 2 | `modules/opensearch` | in-VPC, encrypted, node-to-node TLS, fine-grained access, enforce-HTTPS |
| S3 media + logs | `modules/s3-cdn` | SSE-KMS, versioning, all-public-blocked, TLS-only policy, CORS for presigned, lifecycle |
| KMS + Secrets | `modules/secrets` | rotated CMK, generated JWT + s2s secrets, empty containers for provider keys (values set out-of-band) |
| **Prod composition** | `envs/prod` | `versions.tf`, `backend.tf` (S3+DynamoDB), `main.tf` (wires all modules), `variables.tf`, `terraform.tfvars` (lean), `outputs.tf` |
| Apply runbook | `APPLY-RUNBOOK-prod.md` | bootstrap state → init/plan/apply → kubeconfig → **PITR test restore** → hand-off |

Static verification done in-sandbox: every `.tf` parses (python-hcl2), and a reference checker confirmed every
`module.*.*` output and every variable passed into a module resolves. Authoritative `terraform init && validate &&
plan` runs in the user's environment (no Terraform binary / AWS creds available here) — runbook §3.

## ✅ Built in the DEPLOY wave (this follow-on)
| Component | Path | Notes |
|-----------|------|-------|
| Root `.dockerignore` | `.dockerignore` | excludes node_modules/.git/.env*/dist/mobile — never ship secrets/junk |
| Canonical Dockerfiles | `infra/docker/` | hardened `node-base`, generic `node-service` (ARG APP), generic `web` (Next.js), `ai-services` (Python); all non-root + tini |
| Image build/push | `infra/docker/build-and-push.sh` + `README.md` | ECR login, repo create (scan-on-push), build+push all 10 images |
| Helm library chart | `infra/helm/krishalaya-common` | deployment/service/hpa/pdb/serviceaccount + probe renderer; non-root, RO-rootfs, topology spread, IRSA SA annotation |
| 8 launch-critical charts | `infra/helm/{api,admin-api,wallet-service,worker,realtime-gateway,ai-services,web,web-partner}` | complete `values.yaml` (full key set) + thin `templates/main.yaml` over the library |
| IRSA module | `infra/terraform/modules/irsa` + wired in `envs/prod` | per-app IAM roles via OIDC: Secrets Manager read + KMS decrypt (all), S3 media r/w (api, worker); outputs `irsa_role_arns` |
| Deploy runbook | `infra/DEPLOY-RUNBOOK.md` | IRSA apply → ECR push → namespace+secrets (External Secrets Operator) → `helm dependency build` → per-service install → verify |

Static verification: all Terraform parses + the cross-reference checker passes with `irsa` wired; all Chart.yaml /
values.yaml are valid YAML and **complete** (verified each has the full key set, since library defaults don't
propagate to a parent); every template `include` resolves to a defined block. `helm lint`/`helm template` and
`terraform validate` run in your environment (no helm/terraform binary available in the authoring sandbox) — see
DEPLOY-RUNBOOK §6.

## ✅ Built in the EDGE wave (this follow-on) — domain: krishalaya.com
| Component | Path | Notes |
|-----------|------|-------|
| Route 53 zone | `modules/dns` | hosted zone for krishalaya.com; outputs NS for registrar delegation |
| Wildcard TLS | `modules/acm` | ACM cert `krishalaya.com` + `*.krishalaya.com`, DNS-validated in the zone |
| WAF | `modules/waf` (filled) | WAFv2 REGIONAL web ACL: AWS managed common + known-bad + SQLi + IP-reputation + per-IP rate limit |
| Edge IAM | `modules/alb-edge-iam` | IRSA roles for aws-load-balancer-controller + external-dns (zone-scoped) |
| Prod wiring | `envs/prod` | dns/acm/waf/alb-edge-iam modules + `root_domain` var/tfvars + outputs (NS, cert ARN, WAF ARN, role ARNs, host map) |
| Helm Ingress | `krishalaya-common/templates/_ingress.tpl` + per-app `ingress` values | shared ALB (group `krishalaya-edge`), ssl-redirect, cert + WAF annotations; api/admin-api/realtime + storefront(apex+www)/tenant/admin/partner hosts; wallet/worker/ai-services internal |
| Edge runbook | `infra/EDGE-RUNBOOK.md` | NS delegation → install LB controller + external-dns (Helm, IRSA) → install charts with cert/WAF → verify public HTTPS |

Static verification: all 12 Terraform modules parse + cross-reference checker passes; WAF/ACM/DNS/edge-IAM wired;
every Helm `include` resolves (incl. new `ingress`); all 8 values.yaml carry a complete `ingress` block + valid YAML.

## ✅ P0-1 IS NOW FULLY SCOPED (foundation + deploy + edge)
Running the three runbooks in order — `APPLY-RUNBOOK-prod.md` → `DEPLOY-RUNBOOK.md` → `EDGE-RUNBOOK.md` — stands up
the entire platform on AWS with a public HTTPS entrypoint. When `curl https://api.krishalaya.com/healthz` returns
200, P0-1's "Done when" (clean apply, healthy services, public HTTPS, PITR verified) is met.

## ⛔ Still deferred (NOT silently skipped — separate backlog items)
| Deferred | Where | Belongs to |
|----------|-------|-----------|
| CloudFront CDN for media/web (optional optimisation) | `modules/cdn` (scaffold) | post-launch perf |
| External Secrets Operator `ExternalSecret` manifests | — | small follow-on (DEPLOY-RUNBOOK §3 has manual interim) |
| MSK (Kafka) + 5 Phase-2 service Helm charts | `modules/msk`, `infra/helm/{stream-processor,…}` (scaffolds) | Phase-2 |
| Observability stack wiring | `modules/observability` (scaffold) | **P0-6** |
| Disaster recovery (cross-region) | `envs/prod/dr.tf` (deferral note) | **P0-7** |
| `dev` + `staging` env compositions | `envs/dev`, `envs/staging` (scaffolds) | mirror prod once proven |

> When the deploy + edge waves are done and a public HTTPS health check passes through the gateway, P0-1's full
> "Done when" is met. This wave delivered the data-plane foundation + the runbook to stand it up.
