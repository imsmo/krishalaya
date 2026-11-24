# Deploy runbook — build images + ship services to EKS

Follows `infra/terraform/APPLY-RUNBOOK-prod.md` (the cluster + data stores must already exist). This wave added:
the **Dockerfiles** (`infra/docker/`), the **Helm charts** (`infra/helm/`), and the **IRSA** roles
(`infra/terraform/modules/irsa`, wired into `envs/prod`). Here's how to go from code → running pods.

> Prereqs on your Mac: `docker`, `aws` CLI v2, `kubectl`, `helm` (v3.12+), and `kubectl` already pointed at the
> cluster (`aws eks update-kubeconfig --name <cluster> --region ap-south-1`).

---

## 1. Apply the IRSA roles (Terraform)

These were added to `envs/prod`. Re-apply to create the per-app IAM roles:
```bash
cd infra/terraform/envs/prod
terraform plan -out tf.plan && terraform apply tf.plan
terraform output -json irsa_role_arns    # map: service-account -> role ARN (used in step 4)
```

---

## 2. Build + push all images to ECR

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ACCOUNT=$ACCOUNT REGION=ap-south-1 TAG=$(git rev-parse --short HEAD) \
  ./infra/docker/build-and-push.sh
```
This creates the ECR repos (scan-on-push) and pushes: `krishalaya-node-base:20`, `krishalaya-api`,
`krishalaya-admin-api`, `krishalaya-wallet-service`, `krishalaya-worker`, `krishalaya-realtime-gateway`,
`krishalaya-web-storefront`, `krishalaya-web-tenant`, `krishalaya-web-admin`, `krishalaya-web-partner`,
`krishalaya-ai-services` — all tagged with the short git SHA (`$TAG`).

> **Web apps bake `NEXT_PUBLIC_*` at build time.** Before building web images, set the public API URL as a build
> arg in `build-and-push.sh` (or build web images separately) so the browser bundle points at your prod API
> gateway domain. Server-only env is injected at runtime (step 3).

---

## 3. Create the namespace + the env Secrets (synced from AWS Secrets Manager)

```bash
kubectl create namespace krishalaya
```

Each backend chart reads its env from a Kubernetes Secret (`envFromSecretNames`). The **recommended** way to keep
these in sync with AWS Secrets Manager is the **External Secrets Operator** (ESO):
```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
```
Then create an `ExternalSecret` per service that pulls from `krishalaya-prod/*` into the k8s Secret names the
charts expect: `krishalaya-api-env`, `krishalaya-admin-api-env`, `krishalaya-wallet-env`,
`krishalaya-worker-env`, `krishalaya-realtime-env`, `krishalaya-ai-env`.

> **Quick manual alternative (to test before wiring ESO)** — create one secret by hand. Build the connection
> strings from the Terraform outputs (`aurora_writer_endpoint`, `redis_primary_endpoint`, …) and the generated
> secrets in Secrets Manager. Example for the API:
> ```bash
> kubectl -n krishalaya create secret generic krishalaya-api-env \
>   --from-literal=DATABASE_URL='postgres://kv_app:***@<aurora_writer>:5432/krishalaya' \
>   --from-literal=READ_REPLICA_URL='postgres://kv_app:***@<aurora_reader>:5432/krishalaya' \
>   --from-literal=REDIS_URL='rediss://:***@<redis_primary>:6379' \
>   --from-literal=JWT_ACCESS_SECRET="$(aws secretsmanager get-secret-value --secret-id krishalaya-prod/jwt/access_secret --query SecretString --output text)" \
>   --from-literal=WALLET_GRPC_URL='krishalaya-wallet-service.krishalaya.svc.cluster.local:50051' \
>   --from-literal=OPENSEARCH_URL='https://<opensearch_endpoint>' \
>   --from-literal=S3_BUCKET='<media_bucket_name>'
> ```
> (The DB roles `kv_app`/`kv_wallet`/`kv_relay` are created in **P0-5** from the Aurora master secret — with strong
> passwords from Secrets Manager, never the dev SQL.)

---

## 4. Install the charts (one Helm release per service)

First vendor the library chart into each service chart:
```bash
cd infra/helm
for c in api admin-api wallet-service worker realtime-gateway ai-services web web-partner; do
  helm dependency build ./$c
done
```

Set the ECR + IRSA placeholders and install. Example for the API (repeat per service, using its image repo + the
matching role ARN from step 1):
```bash
ECR=$ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com
API_ROLE=$(terraform -chdir=../terraform/envs/prod output -json irsa_role_arns | jq -r '.api')

helm upgrade --install api ./api -n krishalaya \
  --set image.repository=$ECR/krishalaya-api \
  --set image.tag=$TAG \
  --set serviceAccount.roleArn=$API_ROLE
```

Service-by-service notes:
- **wallet-service** → role `wallet-service`, gRPC service on 50051.
- **worker** → role `worker`, no Service (background only).
- **realtime-gateway** → role `realtime-gateway`, sticky ClientIP service on 8090.
- **ai-services** → role `ai-services`.
- **web apps** → the generic `web` chart, one release each (no IRSA needed):
  ```bash
  helm upgrade --install web-storefront ./web -n krishalaya --set image.repository=$ECR/krishalaya-web-storefront --set image.tag=$TAG
  helm upgrade --install web-tenant     ./web -n krishalaya --set image.repository=$ECR/krishalaya-web-tenant     --set image.tag=$TAG
  helm upgrade --install web-admin      ./web -n krishalaya --set image.repository=$ECR/krishalaya-web-admin      --set image.tag=$TAG
  helm upgrade --install web-partner    ./web-partner -n krishalaya --set image.repository=$ECR/krishalaya-web-partner --set image.tag=$TAG
  ```

---

## 5. Verify

```bash
kubectl -n krishalaya get pods,svc,hpa
kubectl -n krishalaya rollout status deploy/api
kubectl -n krishalaya logs deploy/api --tail=50
# in-cluster smoke (no public ingress yet — that's the edge wave):
kubectl -n krishalaya run curl --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://api.krishalaya.svc.cluster.local/healthz
```
All pods `Running`/`Ready`, HPAs showing targets, `/healthz` returns ok = the services are live in the cluster.

---

## 6. Validate the charts before installing (recommended)

```bash
cd infra/helm
for c in api admin-api wallet-service worker realtime-gateway ai-services web web-partner; do
  helm lint ./$c
  helm template test ./$c >/dev/null && echo "$c renders OK"
done
```
(These run `helm` locally — they were NOT runnable in the authoring sandbox, so run them here first.)

---

## What's still needed to serve PUBLIC traffic (edge wave — separate task)
The services run **inside** the cluster now, but there is no public entrypoint yet. The **edge wave** adds:
AWS Load Balancer Controller + an `Ingress` per web/api, an **ACM TLS cert** for your domain, the **WAF**, and
**Route 53** DNS records. That wave needs your **production domain name**. Until then, reach services via
`kubectl port-forward` for testing.

---

## 7. Deploying from GitHub Actions (PC-56 DEPLOY-1)

Everything above, as code: `.github/workflows/deploy-environment.yml` (the procedure) called by
`deploy-staging.yml` (daily 18:00 IST from `main`, or on demand) and `deploy-prod.yml` (manual, from `main`, Tue/Fri IST,
promotes only a commit already healthy on staging). Neither runs on a push. Until an environment is configured, its run
ends green with a "Deploy skipped — not configured" notice.

### One-time setup per environment (staging first, then production)
1. **Terraform** — `terraform apply` in `envs/<env>` now also creates the GitHub deploy role (`modules/github-deploy`:
   OIDC, no stored AWS keys; ECR push to `krishalaya-*`, describe this cluster, Kubernetes *edit* in the `krishalaya`
   namespace only) and switches the cluster to EKS access entries (`API_AND_CONFIG_MAP`, in place; existing access
   unchanged). If staging and prod share one AWS account, set `create_github_oidc_provider = false` in the env applied
   second (the provider is one per account).
2. **GitHub → Settings → Environments** — create `staging` and `production`. On `production` add **required
   reviewers** (the approval gate) and restrict deployment branches to `main`.
3. **Environment variables** (per environment, from `terraform output`):
   | Variable | Value |
   |---|---|
   | `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_deploy_role_arn` |
   | `EKS_CLUSTER_NAME` | `terraform output -raw eks_cluster_name` |
   | `IRSA_ROLE_ARNS` | `terraform output -json irsa_role_arns` (one line of JSON) |
   | `AWS_REGION` | optional; default `ap-south-1` |
   | `NEXT_PUBLIC_ENV_WEB_STOREFRONT` … `_WEB_TENANT`, `_WEB_ADMIN`, `_WEB_PARTNER`, `_WEB_GOV`, `_WEB_OPS` | each web app's **public** build-time settings as dotenv lines (e.g. `NEXT_PUBLIC_API_URL=https://api.staging.krishalaya.com`). They are baked into the browser bundle — never a secret. |
4. Steps 3 (namespace + env Secrets from Secrets Manager) of this runbook must be done once per cluster; the workflow
   deploys into an existing `krishalaya` namespace and never handles server secrets.

### Migrations (the workflow does not run them)
The database is in isolated subnets, unreachable from GitHub. Before deploying, the workflow compares `db/migrations`
between the commit running now (read from the `api` release's image tag) and the commit being deployed. If anything
changed it **stops**: apply the migrations to that environment first (`pnpm migrate` with `MIGRATION_DATABASE_URL`
from a host inside the VPC, e.g. a pod in the cluster), then re-run the workflow with **migrations_applied = true**.
A first deploy always counts as "every migration".

### What a deploy does
CI must have passed on the commit → OIDC login → build + push all images tagged `<sha>-staging|prod` (linux/amd64) →
`helm upgrade --install --atomic --wait` per service, wallet-service first (a release that does not become healthy
rolls back on its own) → in-cluster `/healthz` smoke → commit status `deploy/<environment> = success`
(production requires `deploy/staging = success` on the same commit).

### Corrections to §2 and §4 found while wiring this (PC-56 DEPLOY-1)
- Backend images never built: `node-service.Dockerfile` used `pnpm deploy --legacy`, a pnpm 10 flag (the repo pins
  pnpm 9.15.9). Fixed.
- Web images: no way to pass the required `NEXT_PUBLIC_*` (builds refused), and the runtime stage could not find
  `next`, so `npx` downloaded next@latest (16.x) on every container start. Fixed: `NEXT_PUBLIC_ENV` build arg and a
  prod-only `pnpm deploy` tree started with the app's own pinned `next`.
- Images are built for `linux/amd64` (the nodes are t3); a plain `docker build` on an Apple-silicon Mac makes arm64
  images that fail with "exec format error".
- `web-gov` and `web-ops` are built and deployed too (generic `web` chart).
- Installs inside images use `--frozen-lockfile` (the exact versions CI tested).
- The 5 P1/P2 charts (`analytics-pipeline`, `ivr-ussd-gateway`, `outbox-relay`, `stream-processor`, `whatsapp-bot`)
  are placeholders that `helm lint` rejects; they are not deployed.
