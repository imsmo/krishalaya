# Apply runbook — Krishalaya production foundation (AWS ap-south-1)

Beginner-followable steps to stand up the **foundation data plane** (VPC, EKS, Aurora PostgreSQL, Redis,
OpenSearch, S3, Secrets Manager) built in `infra/terraform/modules/*` and composed in `infra/terraform/envs/prod`.

> This provisions infrastructure that **costs real money** and is **destructive if mis-run**. Read each step. Do it
> in a throwaway AWS account first if you've never used Terraform. Nothing here was applied for you — you run it
> with your own AWS credentials.

---

## 0. Prerequisites (one time, on your Mac)

```bash
brew install terraform awscli kubernetes-cli   # terraform >= 1.6, aws CLI v2, kubectl
aws configure                                  # access key for an IAM admin user, region ap-south-1
aws sts get-caller-identity                    # confirm you're the right account
```

You need an AWS account with admin (or enough) permissions to create VPC/EKS/RDS/ElastiCache/OpenSearch/S3/KMS/IAM.

---

## 1. Bootstrap the Terraform state backend (one time)

Terraform stores its state in S3 with a DynamoDB lock. Create them once (they can't be managed by the same state
they hold). Pick a unique suffix — your **account id** works well:

```bash
ACC=$(aws sts get-caller-identity --query Account --output text)
REGION=ap-south-1

aws s3api create-bucket --bucket "krishalaya-tfstate-$ACC" \
  --region $REGION --create-bucket-configuration LocationConstraint=$REGION
aws s3api put-bucket-versioning --bucket "krishalaya-tfstate-$ACC" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "krishalaya-tfstate-$ACC" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
aws s3api put-public-access-block --bucket "krishalaya-tfstate-$ACC" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws dynamodb create-table --table-name krishalaya-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region $REGION

echo "Your suffix is: $ACC"
```

---

## 2. Fill in the two placeholders

Edit `infra/terraform/envs/prod/backend.tf` — replace `<ACCOUNT_ID_OR_ORG>` with the suffix from step 1:
```hcl
bucket = "krishalaya-tfstate-123456789012"
```

Edit `infra/terraform/envs/prod/terraform.tfvars`:
```hcl
bucket_suffix           = "123456789012"          # same suffix
eks_public_access_cidrs = ["<YOUR_PUBLIC_IP>/32"] # https://checkip.amazonaws.com — tighten from 0.0.0.0/0
```

> `eks_public_access_cidrs` controls who can reach the Kubernetes API. Lock it to your IP/VPN. `0.0.0.0/0` is only
> acceptable for the very first bootstrap, then tighten it.

---

## 3. Init + plan + apply

```bash
cd infra/terraform/envs/prod
terraform init        # downloads providers, connects to the S3 backend
terraform fmt -check  # style check (optional)
terraform validate    # semantic check — MUST be clean before applying
terraform plan -out tf.plan   # READ THIS. It lists every resource it will create.
terraform apply tf.plan       # ~15–25 min (EKS + Aurora are the slow ones)
```

When it finishes, save the outputs:
```bash
terraform output            # endpoints + secret ARNs
terraform output -json > prod-outputs.json
```

---

## 4. Connect kubectl to the cluster

```bash
aws eks update-kubeconfig --name $(terraform output -raw eks_cluster_name) --region ap-south-1
kubectl get nodes           # you should see your worker node(s) Ready
```

---

## 5. Verify the data plane is healthy

```bash
# Aurora writer/reader endpoints + the auto-generated master secret
terraform output aurora_writer_endpoint
terraform output aurora_reader_endpoint
aws secretsmanager get-secret-value \
  --secret-id $(terraform output -raw aurora_master_secret_arn) --query SecretString --output text
# Redis / OpenSearch
terraform output redis_primary_endpoint
terraform output opensearch_endpoint
```

These data stores live in **isolated subnets with no public route** — you reach them from inside the VPC (an EKS
pod, or a bastion). That's by design.

---

## 6. ⭐ Verify PITR with a real test restore (required by P0-1 "Done when")

Point-in-time restore proves your backups work. Restore the cluster to a throwaway clone, confirm it's available,
then delete it:
```bash
SRC=krishalaya-prod-aurora
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier $SRC \
  --db-cluster-identifier ${SRC}-pitr-test \
  --use-latest-restorable-time --region ap-south-1
# wait until status = available, then add an instance to read it, confirm, and clean up:
aws rds describe-db-clusters --db-cluster-identifier ${SRC}-pitr-test \
  --query 'DBClusters[0].Status' --output text
# ... verify ... then:
aws rds delete-db-cluster --db-cluster-identifier ${SRC}-pitr-test --skip-final-snapshot
```
Record the restore time — that's part of your RTO/RPO evidence for P0-7.

---

## 7. Next (handing off to other P0 tasks)

- **P0-2** (secrets): the JWT + s2s secrets are already generated in Secrets Manager (`jwt_access_secret_arn`,
  `api_shared_secret_arn`). Populate the **external** provider secrets (Razorpay/SMS/eKYC/weather/AI/push) — their
  empty containers exist; set values with:
  ```bash
  aws secretsmanager put-secret-value --secret-id krishalaya-prod/razorpay/key_id --secret-string '...'
  ```
- **P0-5** (DB): create the least-privilege roles (`kv_app`/`kv_wallet`/`kv_relay`) using the Aurora master secret,
  run `pnpm migrate` against the writer endpoint, seed **reference** data (NOT demo), `pnpm db:partitions`, then run
  `verify-rls-coverage.js`. (This is the prod equivalent of the local `db/local/local-login-roles.sql`, but with
  **strong** passwords from Secrets Manager — never the dev SQL.)
- Deploy the apps: the **Helm charts are still scaffolds** — see `infra/terraform/PROGRESS-P0-1.md` for the deferred
  follow-on waves before you can `helm install`.

---

## Tear-down (throwaway/test accounts only)

```bash
cd infra/terraform/envs/prod
terraform destroy        # Aurora has deletion_protection=true — set it false + apply first, or it will refuse
```
Then delete the state bucket + lock table from step 1. **Never run destroy against real production.**

---

## Cost note (lean tier)

This lean/minimal sizing (SPOT t3.large nodes, Aurora Serverless v2 @ 0.5 ACU floor, t4g.micro Redis, t3.small
OpenSearch, single NAT) is the cheap end while keeping HA + encryption + PITR. The biggest fixed costs are the NAT
gateway, the EKS control plane (~$0.10/hr), and the OpenSearch nodes. Scale up later by raising the variables in
`terraform.tfvars` — no code changes.
