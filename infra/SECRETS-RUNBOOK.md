# Secrets runbook — wiring real secrets for production (P0-2)

How secrets flow in production, the exact AWS Secrets Manager layout, and the boot-time fail-closed guarantees.
**No secret is ever in git or in an `.env` file** — they live only in Secrets Manager and are injected at runtime.

---

## The chain (no static keys anywhere)

```
AWS Secrets Manager  ──(External Secrets Operator, IRSA jwt auth)──▶  k8s Secret  ──envFrom──▶  pod env
        ▲                                                                                          │
        └ you populate values once (CLI/console)                          AppConfig validates at boot ─┘
                                                                          (assertProductionSecurity)
```

- The pod authenticates to AWS with its **IRSA role** (no access keys). The ESO controller has its own role
  (`terraform output external_secrets_role_arn`) that can read `krishalaya-prod/*`.
- The app reads env via **AppConfig** only; on boot in production it **fails closed** on any weak/dev/misconfigured
  value (`apps/api/src/core/config/app-config.ts` → `collectProductionProblems`, 22 regression tests).

---

## 1. Secrets Manager layout (create these after `terraform apply`)

Terraform already created (P0-1): the platform KMS key, the generated `krishalaya-prod/jwt/access_secret` and
`krishalaya-prod/api/shared_secret`, the Aurora master secret, the Redis auth + OpenSearch master secrets, and
**empty containers** for the external provider keys. You populate the rest:

**a) App DB-role passwords** (strong, ≥16 chars, no dev words):
```bash
for role in kv_app kv_wallet kv_relay; do
  aws secretsmanager create-secret --name "krishalaya-prod/db/${role}_password" \
    --secret-string "$(openssl rand -base64 24)" --region ap-south-1
done
```

**b) Per-service env JSON** — one JSON secret per service, holding every env var that service needs. The
ExternalSecrets `dataFrom.extract` turns each JSON key into a key in the k8s Secret. Example for the API
(assemble the URLs from the Terraform outputs + the passwords from (a)):
```bash
aws secretsmanager create-secret --name krishalaya-prod/api/env --region ap-south-1 --secret-string '{
  "DATABASE_URL":      "postgresql://kv_app:<APP_PW>@<aurora_writer>:5432/krishalaya?sslmode=require",
  "DATABASE_REPLICA_URL":"postgresql://kv_app:<APP_PW>@<aurora_reader>:5432/krishalaya?sslmode=require",
  "REDIS_URL":         "rediss://:<redis_auth>@<redis_primary>:6379",
  "JWT_ACCESS_SECRET": "<from krishalaya-prod/jwt/access_secret>",
  "JWT_REFRESH_SECRET":"<unique random >=32>",
  "AUTH_HASH_PEPPER":  "<unique random >=32>",
  "S3_MEDIA_BUCKET":   "<media_bucket_name>",
  "OPENSEARCH_URL":    "https://<opensearch_endpoint>",
  "OPENSEARCH_USERNAME":"kv_search_admin",
  "OPENSEARCH_PASSWORD":"<from krishalaya-prod/opensearch/master>",
  "WALLET_GRPC_URL":   "krishalaya-wallet-service.krishalaya.svc.cluster.local:50051",
  "RAZORPAY_KEY_ID":   "<live>",
  "RAZORPAY_KEY_SECRET":"<live>",
  "RAZORPAY_WEBHOOK_SECRET":"<live, strong>"
}'
```
Repeat for `krishalaya-prod/{admin-api,wallet,worker,realtime,ai}/env` with each service's vars (wallet uses the
`kv_wallet` URL; worker + ai-services use `kv_relay`; realtime needs the SAME `JWT_ACCESS_SECRET` as the API).
**Never** set `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (S3 uses the pod's IRSA role) and **never** set
`AUTH_EXPOSE_OTP=true` — boot will refuse either.

> **SMS/OTP (P0-3):** add the provider selection to the API env JSON so real users get OTP texts. For India:
> `"SMS_PROVIDER":"msg91"`, `"MSG91_AUTH_KEY":"<live>"`, `"MSG91_SENDER_ID":"<DLT 6-char header>"`,
> `"MSG91_OTP_TEMPLATE_ID":"<DLT OTP template id>"`. (Global fallback: `"SMS_PROVIDER":"twilio"` +
> `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM`.) Boot **refuses** `noop` in production.

**c) External provider keys** — fill the empty containers Terraform made:
```bash
aws secretsmanager put-secret-value --secret-id krishalaya-prod/sms/provider_api_key   --secret-string '<...>'
aws secretsmanager put-secret-value --secret-id krishalaya-prod/ekyc/provider_api_key  --secret-string '<...>'
# ...weather, ai model key, push token, razorpay/webhook as needed
```

---

## 2. Grant the DB roles LOGIN with those strong passwords

App roles are `NOLOGIN` until you run the **production-safe** bootstrap (never the dev `local-login-roles.sql`):
```bash
PROJECT=krishalaya-prod REGION=ap-south-1 \
MASTER_SECRET_ARN=$(terraform -chdir=infra/terraform/envs/prod output -raw aurora_master_secret_arn) \
WRITER_HOST=$(terraform -chdir=infra/terraform/envs/prod output -raw aurora_writer_endpoint) \
  ./db/prod/create-roles.sh
```
It reads the passwords from Secrets Manager, **refuses weak/dev passwords**, and `ALTER ROLE … LOGIN` with
`NOSUPERUSER NOCREATEDB NOCREATEROLE` (and `NOBYPASSRLS` for kv_app/kv_wallet). Re-run on rotation.

---

## 3. Install External Secrets Operator + apply the manifests

```bash
EDNS=$(terraform -chdir=infra/terraform/envs/prod output -raw external_secrets_role_arn)
helm repo add external-secrets https://charts.external-secrets.io && helm repo update
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$EDNS

kubectl apply -f infra/k8s/external-secrets/00-cluster-secret-store.yaml
kubectl apply -f infra/k8s/external-secrets/   # creates one ExternalSecret per service
kubectl -n krishalaya get externalsecret      # all should report SecretSynced=True
kubectl -n krishalaya get secret krishalaya-api-env   # the synced k8s Secret the chart envFroms
```

---

## 4. Boot-time fail-closed guarantee (the heart of P0-2)

In production, **every service refuses to start on insecure config**:

| Check (api `assertProductionSecurity`) | Fails boot if… |
|----------------------------------------|----------------|
| JWT access/refresh/pepper | weak (<32 chars / dev words) or access==refresh |
| `AUTH_EXPOSE_OTP` | is `true` |
| `DATABASE_URL`/replica | localhost, superuser role, dev/weak password, or `sslmode=disable` |
| `REDIS_URL` | missing, not `rediss://` (TLS), or localhost |
| S3 | static keys present, no bucket, or a MinIO endpoint set |
| OpenSearch | non-https or missing credentials (when configured) |
| Payments | `RAZORPAY_KEY_ID` unset, or webhook secret weak/`sandbox-secret`; RazorpayX payout webhook secret weak |
| Notify/Masking | provider URL set but webhook HMAC secret weak |

Also fail-closed: `wallet-service` (kv_wallet URL + non-dev password), `admin-api` (admin JWT + IP allowlist +
hardware key), `realtime-gateway` (JWT), `ai-services` (shared secret + log DB). The payout webhook handler and the
payment gateway registry **never** fall back to a shared `sandbox-secret` in production — a forged callback can't be
accepted, and no sandbox gateway is registered for real money.

**Verify the gate locally** (no real secrets needed):
```bash
cd apps/api && pnpm test:unit --testPathPattern app-config.security   # 42 green [DEV-29 2026-07-28: recounted fresh — was stale at "22", the suite has grown]
```

---

## 5. CI secret hygiene
`.github/workflows/security-scan.yml` runs **gitleaks** (committed-secret scan, allowlisting our documented
placeholders via `.gitleaks.toml`), a guard that no `.env` (only `.env.example`) is tracked, and a `pnpm audit`
that fails on high/critical advisories. `.gitignore` already excludes `.env*`.
