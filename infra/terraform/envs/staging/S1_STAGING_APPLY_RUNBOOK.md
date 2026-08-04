# S1 — Staging/Pilot Apply Runbook (founder-executable)

Stands up the **PILOT-sized** staging environment on your own AWS account, using the terraform.tfvars written this
sprint (`infra/terraform/envs/staging/terraform.tfvars`) against the **same, unmodified** terraform modules prod
will later use. This is the STAGING-PILOT overlay/sequence — it does not repeat content that's already correct in
the existing runbooks; it tells you which one to run, with what override, in what order, and where staging's shape
genuinely differs from prod's. Read each linked runbook once; this document is the glue between them.

**You run every command below on your own Mac with your own AWS credentials.** Nothing here was applied for you —
no Terraform binary or AWS creds are available in the authoring sandbox.

Cross-referenced runbooks (do not duplicate — follow the link when noted):
- `krishalaya/infra/terraform/APPLY-RUNBOOK-prod.md` — the foundation apply mechanics (state bootstrap, kubectl
  connect, PITR test-restore). Every step maps 1:1 to staging with `envs/staging` substituted for `envs/prod`.
- `krishalaya/infra/DEPLOY-RUNBOOK.md` — image build/push + Helm install mechanics.
- `krishalaya/infra/EDGE-RUNBOOK.md` — ALB/WAF/ACM/Route53/external-dns mechanics.
- `krishalaya/infra/SECRETS-RUNBOOK.md` — the full secrets chain + the `assertProductionSecurity` table.
- `krishalaya/db/prod/DB-BOOTSTRAP-RUNBOOK.md` — migrate/partition/role-login/seed/RLS-gate, run as-is against staging.
- `krishalaya/ops/runbooks/restore-drill.md` — the PITR drill script/log this runbook's §7 exercises.

---

## 0. What's different from prod (read this first)

| Area | Prod | Staging/pilot | Why |
|---|---|---|---|
| Terraform dir | `envs/prod` | `envs/staging` (built this sprint — was an empty scaffold, see `PROGRESS-P0-1.md` "still deferred") | Mirrors prod's exact module set, pilot-sized |
| EKS nodes | 2× t3.large, max 5 | 2× **t3.medium**, max 3 | Founder decision: 2-node pilot, cost ceiling |
| Aurora | 0.5–4 ACU, 1 reader | **0.5–2 ACU, 0 readers** | Founder decision; accept single-AZ read path at pilot |
| Redis | 1 replica (HA) | **0 replicas** (single node) | Founder decision: single Redis at pilot |
| OpenSearch | 2-node domain | **not created at all** | No enable/disable flag exists on the module (see finding below) — the pilot module composition simply never calls `module "opensearch"`. Search is SQL at pilot (`unified_search` flag OFF, verified S0). |
| Kafka/MSK | not wired in prod either | not wired | `stream-processor` is GA-only per founder decision — consistent with prod, no staging-specific gap |
| Domain | `krishalaya.com` (apex) | `staging.krishalaya.com` (delegated subdomain, own Route 53 zone) | Isolation; doesn't require the prod apex to be delegated first |
| `deletion_protection` (Aurora) | `true` | **`false`** | Staging must be destroyable while you iterate |
| `NODE_ENV` in every Helm chart | `production` (hardcoded in `values.yaml`) | **same — `production`, unchanged** | Deliberate: this is what makes `assertProductionSecurity` exercisable in staging (§6) |

**Finding — OpenSearch has no off-switch.** `infra/terraform/modules/opensearch/variables.tf` has no `enabled`/`count`
variable; instantiating the module always creates a 2-node `t3.small.search` domain (the single largest line item
prod's cost table carries). The correct pilot action is therefore NOT a module edit — it's an environment-composition
choice: `envs/staging/main.tf` simply never declares `module "opensearch" { ... }`. If a future GA wave needs it,
copy the block from `envs/prod/main.tf` verbatim (it's additive). No `-target` exclusion needed for this one —
staging's `main.tf` was authored without the module in the first place, so a plain `terraform plan`/`apply` never
even considers it.

---

## 1. Prerequisites

Tools (same as prod, see `APPLY-RUNBOOK-prod.md` §0):
```bash
brew install terraform awscli kubernetes-cli helm   # terraform >=1.6, aws CLI v2, kubectl, helm >=3.12
aws configure                                        # IAM admin user, region ap-south-1
aws sts get-caller-identity                          # confirm you're the right account
```

Account-level items from `Development_Program/S0_LONG_LEAD_CHECKLIST.md` that gate this runbook:
- **#6 AWS account + billing** — done before this runbook starts (billing alarm at ₹25k/mo already set per S0).
- **#5 Domain + DNS delegation** — you need registrar access for `krishalaya.com` to delegate the `staging` subdomain (§4).
- **#2 Razorpay** — you only need **test-mode** keys for staging (`rzp_test_...` + a webhook secret you invent yourself,
  ≥16 chars, not `sandbox-secret`) — `assertProductionSecurity` only checks presence + strength, not test-vs-live.
- **#8 eKYC provider agreement** — you need the provider's **sandbox/UAT** endpoint + API key (S0 checklist already
  scopes this as "obtain sandbox + prod keys" from the same agreement) — see the important gate in §6.2.
- **#1 DLT SMS** — has a 1–3 week lead time. **Do not block staging on it**: use `SMS_PROVIDER=twilio` for staging
  (Twilio needs no India DLT registration) as a stopgap; switch to `msg91` once DLT approval lands. See §6.2.

---

## 2. Backend/state bootstrap (one time per AWS account, not per environment)

The repo's Terraform state lives in S3 with a DynamoDB lock (`infra/terraform/envs/prod/backend.tf` and the new
`envs/staging/backend.tf` both point at the same bucket/table, keyed differently — `prod/foundation.tfstate` vs
`staging/foundation.tfstate`). This bootstrap is account-level, not prod-specific — run it once, regardless of
which environment you apply first:

```bash
ACC=$(aws sts get-caller-identity --query Account --output text)
REGION=ap-south-1

aws s3api create-bucket --bucket "krishalaya-tfstate-$ACC" \
  --region $REGION --create-bucket-configuration LocationConstraint=$REGION
aws s3api put-bucket-versioning --bucket "krishalaya-tfstate-$ACC" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "krishalaya-tfstate-$ACC" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
aws s3api put-public-access-block --bucket "krishalaya-tfstate-$ACC" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws dynamodb create-table --table-name krishalaya-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region $REGION

echo "Your suffix is: $ACC"   # this is the bucket_suffix value for BOTH envs' tfvars
```

> If you already did this for prod, **skip it** — reuse the same bucket + table for staging (that's the point of
> the shared bootstrap; only the state `key` differs).

---

## 3. Fill in the placeholders

`infra/terraform/envs/staging/backend.tf` — replace `<ACCOUNT_ID_OR_ORG>`:
```hcl
bucket = "krishalaya-tfstate-123456789012"
```

`infra/terraform/envs/staging/terraform.tfvars` — replace two values:
```hcl
bucket_suffix           = "123456789012"          # same suffix as step 2
eks_public_access_cidrs = ["<YOUR_PUBLIC_IP>/32"] # https://checkip.amazonaws.com
```
Everything else in that file is the pilot sizing already set for you (see the file's own cost comments) — you
should not need to change any other value to bring staging up.

---

## 4. Init + plan + apply (two passes — DNS validation gate)

Staging's `main.tf` composes every module in one file (secrets → vpc → eks → aurora/redis/media → irsa →
dns/acm/waf/alb-edge-iam) — unlike prod's three-runbook history, there's only one `terraform apply` sequence to
run, but it still needs **two passes** because `module.acm`'s certificate validation blocks on DNS being delegated
(same underlying constraint `EDGE-RUNBOOK.md` §1 describes for prod — you're just seeing it inside a single
`main.tf` instead of a separate edge wave).

```bash
cd infra/terraform/envs/staging
terraform init            # downloads providers, connects to the S3 backend
terraform validate        # semantic check — MUST be clean before applying
```

**Pass A — everything except the ACM cert** (DNS isn't delegated yet, so exclude `module.acm` or apply will hang):
```bash
terraform plan \
  -target=module.secrets -target=module.vpc -target=module.eks \
  -target=module.aurora -target=module.redis -target=module.media -target=module.irsa \
  -target=module.dns -target=module.waf -target=module.alb_edge_iam \
  -out=tf-a.plan
terraform apply tf-a.plan     # ~15-20 min (EKS + Aurora are the slow ones)
terraform output route53_name_servers
```

**Delegate DNS** — go to step 5, come back once `dig` confirms.

**Pass B — full apply** (now that DNS resolves, `module.acm`'s DNS-validated cert can complete):
```bash
terraform plan -out=tf-b.plan
terraform apply tf-b.plan
terraform output -json > staging-outputs.json
```

---

## 5. DNS delegation (staging subdomain)

Staging gets its **own** Route 53 hosted zone for `staging.krishalaya.com` — a subdomain, not the apex — so this
does not require the `krishalaya.com` apex to be on Route 53 yet (it may not be, if staging is applied before prod).

```bash
terraform output route53_name_servers    # 4 ns-xxxx.awsdns-xx.* values
```
At your registrar (wherever `krishalaya.com` is registered), add an **NS record for the host `staging`** (not the
apex) pointing at those 4 nameservers. Most registrars support delegating a subdomain independently of the apex.
Verify:
```bash
dig +short NS staging.krishalaya.com      # should list the same 4 ns-xxxx.awsdns servers
```
Propagation is usually minutes, up to 48h. Once it resolves, go back to Pass B in §4.

> If the `krishalaya.com` apex is *already* on Route 53 by the time you run this (e.g. prod was applied first,
> reversing the founder's stated order), you can alternatively add the NS record inside that existing zone instead
> of at the registrar — functionally identical, one less registrar round-trip.

---

## 6. Secrets — what MUST exist before any pod boots

Follow `SECRETS-RUNBOOK.md` in full, substituting `krishalaya-staging` for `krishalaya-prod` everywhere and using
the `staging` Terraform outputs. Terraform already created (Pass A): the KMS key, the generated
`krishalaya-staging/jwt/access_secret` + `krishalaya-staging/api/shared_secret`, the Aurora master secret, the
Redis auth token, and **empty containers** for the 9 external-provider keys. You still owe it the rest.

### 6.1 The exact enumerated list (cross-referencing `SECRETS-RUNBOOK.md` §1 + `assertProductionSecurity` in
`apps/api/src/core/config/app-config.ts`) — **every one of these is fail-closed**; a missing/weak value crashes
boot with `FATAL: insecure production config -> ...`, it does not silently start unsafe:

| # | Secret / env var | Requirement | Source |
|---|---|---|---|
| 1 | `JWT_ACCESS_SECRET` | ≥32 chars, random | Terraform-generated (`krishalaya-staging/jwt/access_secret`) |
| 2 | `JWT_REFRESH_SECRET` | ≥32 chars, random, **≠** access secret | You generate: `openssl rand -base64 32` |
| 3 | `AUTH_HASH_PEPPER` | ≥32 chars, random | You generate: `openssl rand -base64 32` |
| 4 | `AUTH_EXPOSE_OTP` | must be unset or `false` | Never set it |
| 5 | `DATABASE_URL` / `DATABASE_REPLICA_URL` | `kv_app` role (not `kv_owner`/superuser), strong password ≥12 chars, `sslmode=require`, non-localhost host | Built from `aurora_writer_endpoint` output + a password you create per `DB-BOOTSTRAP-RUNBOOK.md` — see §6.3, staging has **no reader**, point the replica URL at the writer |
| 6 | `REDIS_URL` | `rediss://` (TLS), non-localhost | Built from `redis_primary_endpoint` output + `redis_auth_secret_arn` value |
| 7 | `S3_MEDIA_BUCKET` | set; **no** `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_ENDPOINT` | `media_bucket_name` output; IRSA role handles auth |
| 8 | `MEDIA_SCAN_SECRET` | ≥16 chars, strong | You generate |
| 9 | `RAZORPAY_KEY_ID` + `RAZORPAY_WEBHOOK_SECRET` | key set (test mode OK), webhook secret ≥16 chars strong | S0 checklist #2 (test keys) |
| 10 | `SMS_PROVIDER` | `msg91` or `twilio`, never `noop` | See §6.2 stopgap |
| 11 | `EKYC_PROVIDER_KIND` | a real provider name, **never** the literal `"sandbox"` | See §6.2 — this is a genuine sequencing gate |
| 12 | `BANK_VAULT_KIND` | `razorpayx` (never `"sandbox"`), + `RAZORPAYX_KEY_ID`/`RAZORPAYX_KEY_SECRET` if so | See §6.2 |
| 13 | `PAYMENTS_DEFAULT_PROVIDER` | never `"sandbox"` | Set to your real gateway id |
| 14 | `OPENSEARCH_*` | **N/A at pilot** — leave `OPENSEARCH_URL` unset entirely (the check only fires "if configured") | Consistent with OpenSearch not being deployed |

Also fail-closed per service (SECRETS-RUNBOOK §4): `wallet-service` (kv_wallet URL, non-dev password),
`admin-api` (admin JWT + IP allowlist + hardware key), `realtime-gateway` (JWT), `ai-services` (shared secret + log DB).

### 6.2 The gate you need to plan around: eKYC and bank-vault are ALWAYS required, not optional

`assertProductionSecurity` treats `EKYC_PROVIDER_KIND` and `BANK_VAULT_KIND` as **defaulting to `"sandbox"` when
unset**, and then rejects `"sandbox"` unconditionally in production — there is no "leave it off for now" path.
Because every chart's `values.yaml` already hardcodes `NODE_ENV: production` (this is true in staging too — see
the table in §0, and it's exactly what lets you run the §7 fail-closed test against a realistic environment), the
`api`/`admin-api` pods **will crash-loop on boot in staging** until:
- `EKYC_PROVIDER_KIND` is set to the real provider identifier (e.g. `digilocker`) with its **sandbox/UAT** URL +
  API key — S0 checklist item #8 already scopes obtaining "sandbox + prod keys" from the same signed agreement, so
  you do not need full production eKYC activation, just the agreement signed far enough to get sandbox creds.
- `BANK_VAULT_KIND=razorpayx` with RazorpayX **test-mode** key/secret — same story as the Razorpay payments keys.

**Practical sequencing implication:** WS2 (provider wiring, `01_SPRINT_SEQUENCE.md`) needs to progress far enough
to obtain *sandbox* keys for eKYC and RazorpayX before staging pods can boot at all — this is earlier in the
timeline than "gates GA launch" the master plan implies; it also gates a clean staging bring-up. If those keys
aren't ready yet, `worker`/`realtime-gateway`/`ai-services` can still be deployed and smoke-tested (they don't carry
these two checks) while `api`/`admin-api` wait.

**SMS stopgap:** DLT SMS registration (S0 checklist #1) has a 1–3 week lead time. Don't block staging on it — set
`SMS_PROVIDER=twilio` with a real Twilio trial/paid account (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM`);
Twilio needs no India DLT registration. Switch to `msg91` once DLT approval lands, well before any real farmer is
onboarded (production only).

### 6.3 Build the per-service env JSON + install ESO

Follow `SECRETS-RUNBOOK.md` §1b/§1c and `DEPLOY-RUNBOOK.md` §3 verbatim, with `krishalaya-staging` substituted for
`krishalaya-prod`, using the staging Terraform outputs. Staging has no reader, so:
```
"DATABASE_REPLICA_URL": "<same value as DATABASE_URL — staging has no separate reader instance>"
```
Omit every `OPENSEARCH_*` key entirely (unset, not empty-string).

**Important — the shipped ExternalSecret manifests are hardcoded to `krishalaya-prod/*`.** `infra/k8s/external-secrets/*.yaml`
each hardcode `key: krishalaya-prod/<service>/env`. Applying them unmodified to the staging cluster would try to
sync the **prod** secrets namespace. Generate staging equivalents on the fly rather than editing the shared files
(keeps prod's manifests untouched):
```bash
mkdir -p /tmp/eso-staging
for f in infra/k8s/external-secrets/*.yaml; do
  sed 's#krishalaya-prod/#krishalaya-staging/#' "$f" > "/tmp/eso-staging/$(basename "$f")"
done

EDNS=$(terraform -chdir=infra/terraform/envs/staging output -raw external_secrets_role_arn)
helm repo add external-secrets https://charts.external-secrets.io && helm repo update
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$EDNS

kubectl apply -f /tmp/eso-staging/00-cluster-secret-store.yaml
kubectl apply -f /tmp/eso-staging/   # one ExternalSecret per service
kubectl -n krishalaya get externalsecret     # all should report SecretSynced=True
```

---

## 7. Database bootstrap

Run `DB-BOOTSTRAP-RUNBOOK.md`'s "one command" as-is, pointed at staging outputs:
```bash
cd <repo-root>
PROJECT=krishalaya-staging REGION=ap-south-1 \
WRITER_HOST=$(terraform -chdir=infra/terraform/envs/staging output -raw aurora_writer_endpoint) \
MASTER_SECRET_ARN=$(terraform -chdir=infra/terraform/envs/staging output -raw aurora_master_secret_arn) \
  ./db/prod/apply.sh
```
This migrates, partitions, creates `kv_app`/`kv_wallet`/`kv_relay` with LOGIN + strong passwords, seeds
**reference data only** (never demo — `NODE_ENV=production` blocks `--demo` regardless of environment name), and
runs the RLS coverage gate. Same script, same guarantees, staging connection string.

---

## 8. Helm install (image build/push + charts + edge)

Follow `DEPLOY-RUNBOOK.md` §1–§4 and then `EDGE-RUNBOOK.md` §3–§5, substituting:
- `terraform -chdir=infra/terraform/envs/staging` for every `terraform output` call
- ECR tag convention: keep the git SHA tag scheme, but consider prefixing (`staging-$TAG`) if you want the same
  commit built for both envs to have distinguishable image tags in one shared ECR — optional, your call.
- Ingress hosts: `api.staging.krishalaya.com`, `admin.staging.krishalaya.com`, etc. — i.e. every host in
  `terraform output app_hostnames` for the staging env, NOT the prod hostnames baked into each chart's
  `values.yaml` default (`ingress.hosts`). Override with `--set ingress.hosts[0]=api.staging.krishalaya.com` etc.
  on every `helm upgrade --install`.
- `--set image.repository=...` / `--set image.tag=...` / `--set serviceAccount.roleArn=...` exactly as those
  runbooks describe, using the staging IRSA role ARNs (`terraform output -json irsa_role_arns`).

---

## 9. Verify — healthz over public HTTPS

```bash
kubectl -n krishalaya get pods,svc,hpa,ingress
kubectl -n krishalaya rollout status deploy/api
curl -sS https://api.staging.krishalaya.com/healthz     # expect 200
curl -sSI https://staging.krishalaya.com                # storefront 200; http:// should 301->https
```

---

## 10. PITR test-restore (required — same bar as prod, per `APPLY-RUNBOOK-prod.md` §6 / `restore-drill.md`)

```bash
SRC=krishalaya-staging-aurora
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier $SRC \
  --db-cluster-identifier ${SRC}-pitr-test \
  --use-latest-restorable-time --region ap-south-1
aws rds describe-db-clusters --db-cluster-identifier ${SRC}-pitr-test \
  --query 'DBClusters[0].Status' --output text   # poll until "available"
# add a temporary instance, confirm row counts / ledger zero-sum (restore-drill.md §Drill steps 2-3), then:
aws rds delete-db-cluster --db-cluster-identifier ${SRC}-pitr-test --skip-final-snapshot
```
Record the measured restore time in `ops/runbooks/restore-drill.md`'s drill log (RTO target ≤60 min). This is
cheap to rehearse now on staging, before it matters for real on prod.

---

## 11. `assertProductionSecurity` fail-closed verification (exact steps)

This proves the P0-2 guarantee actually holds in a real cluster, not just in the 22 unit tests
(`cd apps/api && pnpm test:unit --testPathPattern app-config.security`). Do this **once staging is healthy**
(§9 green), as a deliberate negative test:

1. Pick one already-synced k8s Secret, e.g. `krishalaya-api-env`, and note its current `JWT_ACCESS_SECRET` value
   (so you can restore it after).
2. Overwrite the AWS Secrets Manager source value with something deliberately weak:
   ```bash
   aws secretsmanager put-secret-value --secret-id krishalaya-staging/api/env \
     --secret-string '{"...same JSON as before but..." , "JWT_ACCESS_SECRET": "dev-weak-secret"}'
   ```
   (Use the real full JSON body you built in §6.3, only `JWT_ACCESS_SECRET` changed — the weak-value regex in
   `app-config.ts` matches `/change-?me|dev-|^test|secret-secret|placeholder|sandbox-secret|^changeme/i` or length
   `<32`, so `dev-weak-secret` trips both the prefix match and the length check.)
3. Force ESO to resync early (or wait out `refreshInterval: 1h`):
   ```bash
   kubectl -n krishalaya annotate externalsecret api-env force-sync=$(date +%s) --overwrite
   kubectl -n krishalaya get secret krishalaya-api-env -o jsonpath='{.data.JWT_ACCESS_SECRET}' | base64 -d
   # confirm it now shows the weak value
   ```
4. Roll the deployment so pods pick up the new Secret (Kubernetes Secrets don't hot-reload env vars):
   ```bash
   kubectl -n krishalaya rollout restart deploy/api
   kubectl -n krishalaya get pods -l app=api -w
   ```
5. **Confirm the failure**: the new pod(s) should go `CrashLoopBackOff`, and the logs should show the exact fail-closed message:
   ```bash
   kubectl -n krishalaya logs deploy/api --tail=50
   # expect: FATAL: insecure production config -> JWT_ACCESS_SECRET (unique random >=32 chars); ...
   ```
   If you see this, the gate works end-to-end in a real cluster — not just in unit tests.
6. **Restore**: put the original strong value back in Secrets Manager, force-resync, `rollout restart` again,
   confirm `kubectl -n krishalaya rollout status deploy/api` goes healthy and `/healthz` returns 200.

---

## 12. Rollback / destroy notes

- **Roll back a bad Helm release:** `helm rollback <release> <revision> -n krishalaya` — charts keep
  `revisionHistoryLimit: 5`.
- **Roll back a bad migration:** migrations are forward-only (per `DB-BOOTSTRAP-RUNBOOK.md`) — restore from the
  PITR snapshot to just before the run (§10 mechanics), fix the migration, re-run `db/prod/apply.sh`. Never edit
  an applied migration in place.
- **Tear down staging entirely** (safe — `deletion_protection=false` here, unlike prod):
  ```bash
  cd infra/terraform/envs/staging
  terraform destroy
  ```
  This is explicitly why staging's `aurora_deletion_protection` defaults to `false` (§0 table) — you should be able
  to destroy/rebuild this environment freely while iterating, right up until real pilot data starts landing on it.
- Do **not** run `terraform destroy` against `envs/prod` under any circumstance once real data exists there
  (`APPLY-RUNBOOK-prod.md`'s own warning applies unchanged).

---

## 13. Expected monthly cost (staging/pilot)

| Component | ₹/month (approx) | Note |
|---|---|---|
| EKS control plane | ~6,000 | fixed AWS fee, same as prod |
| 2× t3.medium SPOT nodes | ~2,700 | half of prod's t3.large line |
| Aurora Serverless v2 (0.5–2 ACU avg ~0.75) | ~4,500 | scales toward the floor overnight |
| Redis (cache.t4g.micro, single node) | ~1,200 | no replica |
| NAT gateway (single) | ~3,200 | biggest avoidable line — public-subnet-only is the next cut if needed |
| Route 53 + ACM + WAF | ~1,050 | hosted zone + WAF ACL; ACM certs are free |
| S3 + data transfer | ~500 | negligible at pilot volume |
| Misc (CloudWatch, KMS, Secrets Manager API calls) | ~1,000 | |
| **OpenSearch** | **0** | not deployed — the single largest line item this shape avoids (~₹15,000+/mo if it were) |
| **Kafka/MSK** | **0** | not deployed |
| **Total** | **~₹20,150/mo (~$240)** | under the ₹25k/mo (~$280) ceiling, with headroom |

---

## 14. Founder time estimate

| Phase | Wall-clock | Notes |
|---|---|---|
| §1–3 prereqs + placeholders | 30 min | mostly typing, assuming AWS account already exists (S0 #6) |
| §4 Pass A apply | 20–30 min | EKS + Aurora provisioning time, mostly waiting |
| §5 DNS delegation + propagation | 10 min hands-on + up to 48h wait (usually <1h) | registrar-dependent |
| §4 Pass B apply | 5–10 min | just the ACM cert validation + WAF/edge IAM |
| §6 secrets (incl. eKYC/RazorpayX sandbox key wait, if not already in hand) | 1–3 hours hands-on **if keys are ready**; days if S0 #8/#2 haven't produced sandbox keys yet | the real variable — see §6.2 |
| §7 DB bootstrap | 15 min | one script |
| §8 image build/push + Helm installs | 1–1.5 hours | 8 services + web apps, mostly copy/paste per DEPLOY-RUNBOOK |
| §9 verify | 15 min | |
| §10 PITR drill | 30–45 min | mostly waiting on the restore |
| §11 fail-closed test | 20 min | |
| **Total hands-on (keys already in hand)** | **~5–6 hours**, comfortably a single focused day | |
| **Total wall-clock if eKYC/Razorpay sandbox keys aren't issued yet** | add the S0 checklist lead times (days) | this is the real critical-path risk, not the Terraform apply itself |
