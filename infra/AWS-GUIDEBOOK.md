# Krishalaya on AWS — the beginner's guidebook (staging → production)

**Who this is for:** you, the founder, with beginner-level AWS/DevOps knowledge.
**What you get at the end:** a **staging** environment and a **production** environment for Krishalaya on AWS (Mumbai
region), secured, monitored, backed up, auto-scaling, and deployed automatically from GitHub.
**How to use it:** do the steps **in order**, one at a time. Every step has the same shape:

> **Why** — what this step is for, in plain words.
> **Do** — exactly what to click or type.
> **Check** — what you should see if it worked.
> **If it fails** — the usual cause.
> 💰 — what it costs.

Tick the box `- [ ]` → `- [x]` as you finish each step (edit this file, or print it).
If anything looks different from what this guide says, **stop** and paste the exact screen text or command output to
Claude — don't guess. Nothing in this guide needs you to invent a command.

---

## Contents

- [Part 0 — Read this first](#part-0--read-this-first)
- [Part 1 — Your Mac](#part-1--your-mac)
- [Part 2 — Start the slow business approvals now](#part-2--start-the-slow-business-approvals-now)
- [Part 3 — AWS accounts, the safe way](#part-3--aws-accounts-the-safe-way)
- [Part 4 — Protect your money (budgets + alerts)](#part-4--protect-your-money-budgets--alerts)
- [Part 5 — Account security baseline](#part-5--account-security-baseline)
- [Part 6 — Your domain name plan](#part-6--your-domain-name-plan)
- [Part 7 — Build STAGING](#part-7--build-staging)
- [Part 8 — Automatic deploys from GitHub](#part-8--automatic-deploys-from-github)
- [Part 9 — Monitoring and alerts](#part-9--monitoring-and-alerts)
- [Part 10 — Prove it: drills and load tests on staging](#part-10--prove-it-drills-and-load-tests-on-staging)
- [Part 11 — Build PRODUCTION](#part-11--build-production)
- [Part 12 — Go-live security checklist](#part-12--go-live-security-checklist)
- [Part 13 — Running it: daily, weekly, monthly](#part-13--running-it-daily-weekly-monthly)
- [Appendix A — Words you will see](#appendix-a--words-you-will-see)
- [Appendix B — Costs in detail](#appendix-b--costs-in-detail)
- [Appendix C — When something goes wrong](#appendix-c--when-something-goes-wrong)
- [Appendix D — Growing to millions of users](#appendix-d--growing-to-millions-of-users)

---

## Part 0 — Read this first

### 0.1 What you are building (one picture)

```
  Users (browser / mobile app)
        │  HTTPS
        ▼
  Route 53 (DNS)  →  WAF (web firewall: blocks attacks, rate-limits abusers)  →  ALB (load balancer, TLS)
                                                                                   │
                  ┌──────────────────── EKS (Kubernetes cluster, private) ─────────┴───────────────┐
                  │  web-storefront · web-tenant · web-admin · web-partner · web-gov · web-ops      │
                  │  api · admin-api · realtime-gateway   (public, through the ALB)                  │
                  │  wallet-service · worker · ai-services (internal only)                           │
                  └─────────┬─────────────────────┬──────────────────────┬──────────────────────────┘
                            ▼                     ▼                      ▼
                   Aurora PostgreSQL        Redis (ElastiCache)     S3 (media files)
                   (isolated subnets,       (TLS + password)        (encrypted, private)
                    encrypted, backups)
  Secrets: AWS Secrets Manager → External Secrets Operator → pods (no passwords in git, ever)
  Deploys: GitHub Actions → (OIDC, no stored AWS keys) → ECR images → Helm → EKS
```

Everything above is **already written as code** in this repository (`infra/`). You are not designing anything — you
are **running** what exists, in the right order, with the right settings. This guide is the order.

### 0.2 The two environments

| | Staging | Production |
|---|---|---|
| Purpose | Your test copy. Every change lands here first. | Real farmers, real money. |
| Domain | `staging.krishalaya.com` | `krishalaya.com` |
| Size | Small (cheap). Can be destroyed and rebuilt. | Highly available. Never destroyed. |
| Deploys | Automatic every day at 6 PM IST from `main` | Manual, Tue/Fri, needs your approval, only what staging proved |
| AWS account | `krishalaya-staging` | `krishalaya-prod` |

**Two separate AWS accounts** (not one) is the single most important safety decision in this guide: a mistake in
staging physically cannot touch production. It costs nothing extra.

### 0.3 Time and money (honest numbers)

| | Hands-on time | Waiting time | Monthly bill |
|---|---|---|---|
| Parts 1–6 (setup) | ~4 hours | up to 48 h (DNS) | ~₹0–500 |
| Part 7–10 (staging) | ~1–2 days | provider approvals (days–weeks) | **~₹26,000** |
| Part 11–12 (production) | ~1 day | — | **~₹55,000–70,000** at launch traffic (highly available: on-demand nodes, 2 NATs, DB reader, 35-day backups) |

Prices are approximate (assume ₹85 = US$1 — check today's rate) and **grow with real traffic** — that is normal
and is covered in [Appendix B](#appendix-b--costs-in-detail) and [Appendix D](#appendix-d--growing-to-millions-of-users).
Check any number yourself with the [AWS Pricing Calculator](https://calculator.aws/).

### 0.4 Seven golden rules (read twice)

1. **Never** paste a password, secret key, or `.env` file into git, Slack, email, or a chat. Secrets live only in
   **AWS Secrets Manager** and GitHub is given **no** AWS keys at all.
2. **Never** use the AWS *root* user for daily work (Part 3 explains). Root = emergencies only.
3. **Never** run `terraform destroy` in production. Ever.
4. **Always** read a `terraform plan` before `apply`. If it says it will **destroy** something you did not expect,
   stop and ask.
5. **Region is always `ap-south-1` (Mumbai)** — Indian users' personal data stays in India (DPDP Act). If the AWS
   console top-right shows another region, switch it back before doing anything.
6. **Staging first, always.** Nothing reaches production that has not run on staging.
7. **When unsure, stop.** Paste the exact output to Claude. A wrong guess in AWS can cost money or data.

### 0.5 How to run commands

Commands go in the **Terminal** app on your Mac (`⌘ Space` → type "Terminal"). Copy one block at a time.
Lines starting with `#` are comments (explanations) — Terminal ignores them.
`<SOMETHING>` in angle brackets means **replace it with your value** (and delete the `< >`).

---

## Part 1 — Your Mac

### 1.1 Install the tools — [ ]

**Why:** these are the programs that talk to AWS, Kubernetes and GitHub.

**Do:**
1. Install Homebrew (the Mac package manager) if you don't have it: follow <https://brew.sh> (one command).
2. Then:
   ```bash
   brew install awscli terraform kubernetes-cli helm jq libpq gh k6
   brew link --force libpq          # makes `psql` (database client) available
   ```
   (Terraform official install page: <https://developer.hashicorp.com/terraform/install>.)
3. Docker Desktop (needed only if you ever build images on your Mac): <https://www.docker.com/products/docker-desktop/>.

**Check:**
```bash
aws --version          # aws-cli/2.x
terraform -version     # Terraform v1.6 or newer
kubectl version --client
helm version           # v3.12 or newer
psql --version
gh --version
k6 version
```
**If it fails:** `command not found` → close and reopen Terminal, then retry.

### 1.2 Get the code ready — [ ]

**Why:** every command in this guide runs from the repository folder.

**Do:**
```bash
cd ~/Documents/Personal/farmer/krishalaya      # your repo folder
git checkout main && git pull
# One-time clean-up: an old symlink left over from before PC-56 CI-1 (git no longer tracks it).
[ -L apps/mobile/node_modules ] && rm apps/mobile/node_modules
corepack enable && pnpm install
```
**Check:** `pnpm install` ends with `Done`. `git status` shows nothing unexpected.

### 1.3 Make a private folder for secrets on your Mac — [ ]

**Why:** while you prepare secret values you need somewhere **outside the repository** to type them. You delete
these files once the values are in AWS (Part 7.9).

**Do:**
```bash
mkdir -p ~/krishalaya-secrets && chmod 700 ~/krishalaya-secrets
```
**Check:** `ls -ld ~/krishalaya-secrets` shows `drwx------` (only you can read it).

### 1.4 Turn on FileVault — [ ]

**Why:** your Mac will hold admin access to production. If the laptop is stolen, disk encryption protects it.

**Do:** System Settings → Privacy & Security → **FileVault** → Turn On. Also set a screen-lock password.

---

## Part 2 — Start the slow business approvals now

**Why:** some providers take **days to weeks** to approve you. The apps **refuse to start** in staging and production
without real (or sandbox) keys from these — on purpose (`assertProductionSecurity`). Start all of these **today**,
then continue with Part 3 while you wait.

| # | What | Needed for | Staging can use | Production needs | Lead time | Link |
|---|---|---|---|---|---|---|
| 2.1 | **Domain** `krishalaya.com` registrar login | everything public | — | — | have it | your registrar |
| 2.2 | **Razorpay** (payments) | `api` boot | **test mode** keys | live keys (KYC done) | 1–7 days | <https://dashboard.razorpay.com> |
| 2.3 | **RazorpayX** (payouts / bank vault) | `api` boot (`BANK_VAULT_KIND`) | **test mode** key/secret | live | 3–14 days | <https://x.razorpay.com> |
| 2.4 | **eKYC provider** (e.g. DigiLocker partner) | `api` boot (`EKYC_PROVIDER_KIND`) | **sandbox/UAT** URL + key | production | 1–4 weeks | <https://partners.digilocker.gov.in> |
| 2.5 | **SMS — DLT registration** (TRAI rule for India) + **MSG91** | OTP login | use **Twilio** instead (no DLT needed) | MSG91 + DLT templates | 1–3 weeks | <https://msg91.com> |
| 2.6 | **Twilio** (SMS for staging only) | OTP in staging | trial/paid | — | same day | <https://www.twilio.com/try-twilio> |
| 2.7 | **Hardware security keys** (2× YubiKey or similar FIDO2) | `admin-api` requires one for every admin login; also your AWS root MFA | — | **yes** | delivery 2–5 days | <https://www.yubico.com> |
| 2.8 | **GitHub** admin on `imsmo/krishalaya` | deploys | — | — | have it | <https://github.com/imsmo/krishalaya/settings> |

- [ ] 2.1 · [ ] 2.2 · [ ] 2.3 · [ ] 2.4 · [ ] 2.5 · [ ] 2.6 · [ ] 2.7 · [ ] 2.8

**Also create these email addresses** (aliases are fine, e.g. Google Workspace groups) — never use one personal inbox
for everything: `aws-root@`, `aws-staging@`, `aws-prod@`, `alerts@`, `security@` at your domain.

---

## Part 3 — AWS accounts, the safe way

You will end up with **three** AWS accounts in one **Organization**, all billed together:

| Account | Used for | You log in to it… |
|---|---|---|
| **Management** (the first one you create) | billing + creating the other two. **No servers here.** | rarely |
| `krishalaya-staging` | staging | through IAM Identity Center |
| `krishalaya-prod` | production | through IAM Identity Center |

### 3.1 Create the management account — [ ]

**Do:**
1. Go to <https://portal.aws.amazon.com/billing/signup>. Email: `aws-root@<your-domain>`. Account name:
   `krishalaya-management`.
2. With an **Indian billing address** your account is with **AWS India (AISPL)** and bills in ₹ with GST — enter your
   company PAN/GSTIN when asked so you get GST invoices. (<https://aws.amazon.com/legal/aispl/>)
3. Choose the **Basic (free)** support plan for now.

**Check:** you can sign in at <https://console.aws.amazon.com> as the root user.

### 3.2 Lock the root user — [ ]

**Why:** root can do *anything*, including closing the account. It must be protected by a hardware key.

**Do:**
1. Top-right account name → **Security credentials** → **Multi-factor authentication** → **Assign MFA device** →
   *Passkey or security key* → your YubiKey. Add the **second** YubiKey too (backup).
   Guide: <https://docs.aws.amazon.com/IAM/latest/UserGuide/enable-mfa-for-root.html>
2. On the same page, make sure there are **no access keys** for root (delete any).
3. Store the root password in a password manager (1Password/Bitwarden), and the backup YubiKey in a safe place.

**Check:** sign out and back in — it asks for the key.

### 3.3 Let admins see billing — [ ]

**Do:** Account menu → **Account** → "IAM user and role access to Billing information" → **Edit** → tick
**Activate IAM Access** → Update. (<https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/control-access-billing.html>)

### 3.4 Create the Organization and the two accounts — [ ]

**Do:**
1. Open **AWS Organizations**: <https://console.aws.amazon.com/organizations/v2/home> → **Create an organization**.
2. **Add an AWS account** → *Create an AWS account* →
   name `krishalaya-staging`, email `aws-staging@<your-domain>`.
3. Again: name `krishalaya-prod`, email `aws-prod@<your-domain>`.

**Check:** Organizations → AWS accounts lists all three. Write down the two new **12-digit account IDs**:
`STAGING_ACCOUNT_ID = ____________` · `PROD_ACCOUNT_ID = ____________`

💰 Organizations is free.

### 3.5 Set up IAM Identity Center (your daily login) — [ ]

**Why:** instead of permanent passwords/keys per account, you get **one** login (with your YubiKey) that gives
short-lived access to staging or prod. It is AWS's recommended way and it is free.

**Do:**
1. Open IAM Identity Center **in Mumbai**: <https://ap-south-1.console.aws.amazon.com/singlesignon/home?region=ap-south-1>
   → **Enable**.
2. **Users** → **Add user**: your name, your work email. Accept the email invite, set a password, and register your
   **YubiKey** as MFA (Settings → Authentication → require MFA for every sign-in).
3. **Permission sets** → **Create** → *Predefined* → **AdministratorAccess** → session duration **4 hours**.
4. **AWS accounts** → tick `krishalaya-staging` **and** `krishalaya-prod` → **Assign users** → you →
   permission set **AdministratorAccess**.
5. Note the **AWS access portal URL** (Dashboard, looks like `https://d-xxxxxxxxxx.awsapps.com/start`).

**Check:** open the portal URL → you see both accounts → clicking one opens its console.

### 3.6 Log the command line in — [ ]

**Do:**
```bash
aws configure sso
#   SSO session name: krishalaya
#   SSO start URL:   <your access portal URL>
#   SSO region:      ap-south-1
#   (a browser opens → approve)
#   pick account krishalaya-staging → role AdministratorAccess
#   CLI default region: ap-south-1   ·   output format: json
#   profile name: krishalaya-staging
aws configure sso      # run again for the prod account → profile name: krishalaya-prod
```
Guide: <https://docs.aws.amazon.com/cli/latest/userguide/sso-configure-profile-token.html>

From now on you pick the account by setting **`AWS_PROFILE`** at the top of every Terminal session:
```bash
export AWS_PROFILE=krishalaya-staging      # or krishalaya-prod
aws sso login                               # once a day (opens the browser)
aws sts get-caller-identity                 # ALWAYS check which account you are in
```
**Check:** the `Account` number printed equals the account you meant. **Make this a habit before every command
session** — it is the #1 way to avoid changing production by accident.

---

## Part 4 — Protect your money (budgets + alerts)

Do **both** steps in **each** of the two accounts (`krishalaya-staging`, `krishalaya-prod`) — switch accounts from the
access portal.

### 4.1 Monthly budget with email alerts — [ ]

**Do:** Billing and Cost Management → **Budgets** (<https://console.aws.amazon.com/costmanagement/home#/budgets>) →
**Create budget** → *Use a template* → **Monthly cost budget** →
- Staging account: amount **₹30,000** (≈ US$350) · Prod account: **₹80,000** (≈ US$940) to start.
- Email recipients: `alerts@<your-domain>` and you.
- It alerts at **85% actual** and **100% forecasted**. Add one more threshold: **50% actual**.

💰 The first two budgets per account are free.

### 4.2 Cost Anomaly Detection — [ ]

**Why:** catches a sudden spike (a runaway job, an attack) within a day instead of at month end.

**Do:** <https://console.aws.amazon.com/costmanagement/home#/anomaly-detection/overview> → **Create monitor** →
*AWS services* → alert subscription: **daily summary** to `alerts@`, threshold **₹1,000** (≈ $12) impact.

💰 Free.

### 4.3 (Management account) Consolidated billing view — [ ]

**Do:** in the management account, Billing → **Bills** shows all accounts. Turn on **Cost Explorer** (Billing →
Cost Explorer → Launch). It takes ~24 h to fill with data.

---

## Part 5 — Account security baseline

Do Part 5 in **each** of `krishalaya-staging` and `krishalaya-prod` (console region top-right: **Asia Pacific
(Mumbai) ap-south-1**). These are switches AWS gives you; they are not in the repo's Terraform, so you turn them on here.

### 5.1 Block public S3 for the whole account — [ ]

**Why:** one switch that makes it impossible to accidentally make any file bucket public.

**Do:** S3 → **Block Public Access settings for this account** → Edit → tick **Block all public access** → Save.
(<https://s3.console.aws.amazon.com/s3/settings>)

### 5.2 Encrypt all new disks by default — [ ]

**Do:** EC2 (<https://ap-south-1.console.aws.amazon.com/ec2/home?region=ap-south-1#Settings:>) → **Data protection
and security** → **EBS encryption** → Manage → **Enable** → Save.

### 5.3 CloudTrail — the audit log of every action — [ ]

**Why:** records who did what, when, from where. Essential after any security incident.

**Do:** <https://ap-south-1.console.aws.amazon.com/cloudtrail/home?region=ap-south-1> → **Create trail** →
name `krishalaya-audit` → *Create new S3 bucket* → **Log file SSE-KMS encryption: enabled** (new key, alias
`cloudtrail`) → **Log file validation: enabled** → Next → **Management events** (Read + Write) → Create.

💰 The first trail of management events is free; you pay only a few rupees of S3 storage.

### 5.4 GuardDuty — automatic threat detection — [ ]

**Why:** watches for hacking signs (stolen keys used from strange places, crypto-mining, malicious IPs talking to
your cluster) and tells you.

**Do:** <https://ap-south-1.console.aws.amazon.com/guardduty/home?region=ap-south-1> → **Get started** →
**Enable GuardDuty**. Then **Protection plans** → turn on **S3 Protection** and **EKS Protection (Audit Log
Monitoring)**. Leave *Runtime Monitoring* and *Malware Protection* **off** for staging (cost); turn them on in **prod**
at go-live (Part 12).

**Alerts by email:** Amazon SNS (<https://ap-south-1.console.aws.amazon.com/sns/v3/home?region=ap-south-1#/topics>) →
Create topic `security-alerts` (Standard) → Create subscription → Email → `security@<your-domain>` → confirm the
email. Then EventBridge (<https://ap-south-1.console.aws.amazon.com/events/home?region=ap-south-1#/rules>) →
Create rule `guardduty-findings` → *Rule with an event pattern* → AWS service **GuardDuty**, event type **GuardDuty
Finding** → Target: **SNS topic** `security-alerts` → Create.

💰 30-day free trial, then usage-based — typically ₹500–2,000/month per account at our size. The GuardDuty console
shows your estimated cost under **Usage**.

### 5.5 IAM Access Analyzer — [ ]

**Why:** warns if anything (a bucket, a key, a role) is shared outside your organization.

**Do:** IAM → **Access analyzer** (<https://console.aws.amazon.com/access-analyzer/home?region=ap-south-1>) →
**Create analyzer** → zone of trust **current account** → Create. 💰 Free.

### 5.6 Security Hub — **production account only**, at go-live — [ ]

Leave for [Part 12.3](#123-security-hub--production-only---). (It costs per check; staging doesn't need it.)

**Check for all of Part 5:** in each account, CloudTrail shows `krishalaya-audit` *Logging: On*; GuardDuty shows
*Enabled*; Access Analyzer shows an *Active* analyzer.

---

## Part 6 — Your domain name plan

| Host | App | Staging | Production |
|---|---|---|---|
| storefront (buyers) | `web-storefront` | `staging.krishalaya.com`, `www.staging…` | `krishalaya.com`, `www.krishalaya.com` |
| API (mobile + web) | `api` | `api.staging.krishalaya.com` | `api.krishalaya.com` |
| tenant console (FPOs) | `web-tenant` | `tenant.staging…` | `tenant.krishalaya.com` |
| admin console | `web-admin` | `admin.staging…` | `admin.krishalaya.com` |
| admin API | `admin-api` | `admin-api.staging…` | `admin-api.krishalaya.com` |
| partner console | `web-partner` | `partner.staging…` | `partner.krishalaya.com` |
| government console | `web-gov` | `gov.staging…` | `gov.krishalaya.com` |
| operations console | `web-ops` | `ops.staging…` | `ops.krishalaya.com` |
| realtime (live bids, chat) | `realtime-gateway` | `rt.staging…` | `rt.krishalaya.com` |

**How DNS works here, simply:** Terraform creates a **Route 53 hosted zone** (AWS's DNS) for each environment, and one
**wildcard TLS certificate** (`*.domain`) so every host above gets HTTPS. You tell your **registrar** (where you
bought the domain) to send DNS questions to AWS. Staging only delegates the `staging` sub-part, so it never touches
your main domain — do that first. Production moves the whole domain later (Part 11, with a safety checklist for email).

### 6.1 Write down what your domain has today — [ ]

**Why:** if your domain already has email (MX records) or verification records (TXT), production DNS must copy them
before the switch in Part 11, or **company email stops**.

**Do:** at your registrar's DNS page, screenshot or copy **every record** (type, name, value) into
`~/krishalaya-secrets/dns-records-before.txt`.

---

## Part 7 — Build STAGING

> Every command in Part 7 runs with:
> ```bash
> cd ~/Documents/Personal/farmer/krishalaya
> export AWS_PROFILE=krishalaya-staging && aws sso login
> aws sts get-caller-identity      # Account MUST be your STAGING_ACCOUNT_ID
> export AWS_REGION=ap-south-1
> TF="terraform -chdir=infra/terraform/envs/staging"
> ```
> Opening a new Terminal window? Run that block again first.

### 7.1 Create the place Terraform remembers what it built — [ ]

**Why:** Terraform keeps a "state" file listing every resource it created. It lives in an encrypted S3 bucket, with a
small lock table so two runs can never collide. This is created once per AWS account.

**Do:**
```bash
ACC=$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket --bucket "krishalaya-tfstate-$ACC" --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket "krishalaya-tfstate-$ACC" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "krishalaya-tfstate-$ACC" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
aws s3api put-public-access-block --bucket "krishalaya-tfstate-$ACC" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws dynamodb create-table --table-name krishalaya-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region ap-south-1
echo "Your suffix is: $ACC"
```
**Check:** the last line prints your staging account ID. 💰 a few rupees a month.

### 7.2 Fill in the three placeholders — [ ]

**Do:** edit these files (any text editor, e.g. `open -e <file>`):

1. [`infra/terraform/envs/staging/backend.tf`](terraform/envs/staging/backend.tf) — replace `<ACCOUNT_ID_OR_ORG>` with
   your **staging account ID** → `bucket = "krishalaya-tfstate-123456789012"`.
2. [`infra/terraform/envs/staging/terraform.tfvars`](terraform/envs/staging/terraform.tfvars):
   - `bucket_suffix = "<STAGING_ACCOUNT_ID>"`
   - `eks_public_access_cidrs = ["0.0.0.0/0"]` — **read the decision below first.**

> **Decision — who can reach the Kubernetes API endpoint.** GitHub Actions deploys from GitHub's machines, whose IP
> addresses change all the time, so the endpoint cannot be locked to your home IP *and* receive automatic deploys.
> The endpoint stays **authenticated**: nobody gets in without an AWS IAM identity that has an EKS access entry
> (only you, and the GitHub deploy role, which may edit only the `krishalaya` namespace); anonymous access is off on
> EKS; GuardDuty (Part 5.4) watches the cluster's audit log. This is AWS's default setup. **Later hardening** (when
> you have a DevOps hire): run deploys from a self-hosted runner inside the VPC and set this back to your office IPs.

3. Commit them (account IDs are not secrets):
   ```bash
   git add infra/terraform/envs/staging/backend.tf infra/terraform/envs/staging/terraform.tfvars
   git commit -m "staging: terraform state bucket + account suffix" && git push
   ```

### 7.3 Build the base infrastructure (pass A) — [ ]

**Why:** creates the network, the Kubernetes cluster, the database, Redis, storage, IAM roles, the DNS zone and the
firewall. Two passes, because the HTTPS certificate can only be validated after DNS points at AWS (step 7.4).

**Do:**
```bash
$TF init
$TF validate                    # must say: Success! The configuration is valid.
$TF plan -out=tf-a.plan \
  -target=module.secrets -target=module.vpc -target=module.eks \
  -target=module.aurora -target=module.redis -target=module.media -target=module.irsa \
  -target=module.dns -target=module.waf -target=module.alb_edge_iam -target=module.github_deploy
```
**Read the plan.** The last line looks like `Plan: NN to add, 0 to change, 0 to destroy.` — on a first build it must
say **0 to destroy**. Then:
```bash
$TF apply tf-a.plan             # 20–30 minutes; the cluster and the database are the slow parts
$TF output route53_name_servers # 4 lines like "ns-123.awsdns-45.com"
```
**Check:** `Apply complete!`. **If it fails:** copy the red `Error:` block to Claude. Re-running the same `plan` +
`apply` is safe — Terraform continues where it stopped.

💰 From this moment staging costs ~₹850/day. If you must pause for weeks, see [Appendix B.3](#b3-cutting-the-bill-without-breaking-anything).

### 7.4 Point `staging.krishalaya.com` at AWS — [ ]

**Do:** at your registrar, add **4 NS records** with host/name **`staging`** (not `@`), one for each name server from
the last command. (Every registrar's screen differs; look for "DNS records" → add record → type **NS**.)

**Check** (can take minutes, up to 48 h):
```bash
dig +short NS staging.krishalaya.com      # shows the same 4 ns-… names
```

### 7.5 Finish the build (pass B) — [ ]

```bash
$TF plan -out=tf-b.plan         # adds the TLS certificate (+ anything left)
$TF apply tf-b.plan
$TF output -json > ~/krishalaya-secrets/staging-outputs.json
```
**Check:** `Apply complete!`. **If it waits a long time on `aws_acm_certificate_validation`:** DNS (7.4) hasn't
propagated yet — wait and re-run.

### 7.6 Connect to the cluster — [ ]

```bash
aws eks update-kubeconfig --name "$($TF output -raw eks_cluster_name)" --region ap-south-1 --alias krishalaya-staging
kubectl config use-context krishalaya-staging
kubectl get nodes                # 3 nodes, STATUS Ready
kubectl create namespace krishalaya
```
> **Habit:** before any `kubectl`/`helm` command, run `kubectl config current-context` — it must say the environment
> you mean. (Production will be `krishalaya-prod`.)

### 7.7 Install the cluster's helpers — [ ]

**Why:** five small system programs the apps rely on:
**metrics-server** (lets auto-scaling see CPU), **Cluster Autoscaler** (adds/removes machines with load),
**AWS Load Balancer Controller** (creates the public load balancer from the apps' settings), **external-dns** (writes DNS
records automatically), **External Secrets Operator** (copies secrets from AWS into the cluster — installed in 7.9).

**Do:**
```bash
CLUSTER=$($TF output -raw eks_cluster_name)
VPC_ID=$(aws eks describe-cluster --name $CLUSTER --query 'cluster.resourcesVpcConfig.vpcId' --output text)
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo add autoscaler https://kubernetes.github.io/autoscaler
helm repo add eks https://aws.github.io/eks-charts
helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/
helm repo update

# 1) metrics-server
helm upgrade --install metrics-server metrics-server/metrics-server -n kube-system

# 2) Cluster Autoscaler — its version must match Kubernetes 1.36. Find the newest 1.36 patch:
gh release list -R kubernetes/autoscaler -L 60 | grep 'cluster-autoscaler-1.36' | head -1   # e.g. cluster-autoscaler-1.36.2
CA_TAG=v1.36.<PATCH>      # ← from the line above, e.g. v1.36.2
helm upgrade --install cluster-autoscaler autoscaler/cluster-autoscaler -n kube-system \
  --set autoDiscovery.clusterName=$CLUSTER --set awsRegion=ap-south-1 \
  --set rbac.serviceAccount.name=cluster-autoscaler \
  --set rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$($TF output -raw cluster_autoscaler_role_arn) \
  --set image.tag=$CA_TAG \
  --set extraArgs.balance-similar-node-groups=true --set extraArgs.scale-down-unneeded-time=10m

# 3) AWS Load Balancer Controller
kubectl -n kube-system create serviceaccount aws-load-balancer-controller --dry-run=client -o yaml | kubectl apply -f -
kubectl -n kube-system annotate serviceaccount aws-load-balancer-controller \
  eks.amazonaws.com/role-arn=$($TF output -raw alb_controller_role_arn) --overwrite
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName=$CLUSTER --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller --set region=ap-south-1 --set vpcId=$VPC_ID

# 4) external-dns (staging zone only)
helm upgrade --install external-dns external-dns/external-dns -n external-dns --create-namespace \
  --set provider.name=aws --set policy=upsert-only --set txtOwnerId=krishalaya-staging \
  --set "domainFilters[0]=staging.krishalaya.com" \
  --set "extraArgs[0]=--zone-id-filter=$($TF output -raw route53_zone_id)" \
  --set serviceAccount.name=external-dns \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$($TF output -raw external_dns_role_arn)
```
**Check:**
```bash
kubectl -n kube-system get deploy | grep -E 'metrics-server|autoscaler|load-balancer'
kubectl -n external-dns get deploy external-dns
kubectl top nodes                # shows CPU/memory numbers (metrics-server works)
```
All `READY` columns show `1/1` (or `2/2`). Docs if needed: [ALB controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/),
[Cluster Autoscaler on AWS](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/cloudprovider/aws/README.md),
[external-dns](https://kubernetes-sigs.github.io/external-dns/).

### 7.8 Collect your staging provider keys — [ ]

You need these from Part 2 before 7.9: Razorpay **test** key id/secret + a webhook secret you invent (≥16 random chars),
RazorpayX **test** key/secret, eKYC **sandbox** provider name/URL/key, Twilio account SID/auth token/phone number.
Without them `api` and `admin-api` will not start (by design). The other services can still go live first — see
[S1 runbook §6.2](terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md).

### 7.9 Put the secrets into AWS Secrets Manager — [ ]

**Why:** each service reads its settings from one secret in AWS (e.g. `krishalaya-staging/api/env`). External Secrets
Operator copies them into the cluster; nothing secret is ever in git or GitHub.

**a) Database passwords for the three app roles** (random, strong):
```bash
for role in kv_app kv_wallet kv_relay; do
  aws secretsmanager create-secret --name "krishalaya-staging/db/${role}_password" \
    --secret-string "$(openssl rand -base64 24 | tr -d '/+=')" --region ap-south-1
done
```

**b) Gather the values you will paste.** Print them (they appear only on your screen):
```bash
echo "DB host:      $($TF output -raw aurora_writer_endpoint)"
echo "Redis host:   $($TF output -raw redis_primary_endpoint)"
echo "Media bucket: $($TF output -raw media_bucket_name)"
for s in kv_app kv_wallet kv_relay; do echo "$s pw: $(aws secretsmanager get-secret-value --secret-id krishalaya-staging/db/${s}_password --query SecretString --output text)"; done
echo "Redis auth:   $(aws secretsmanager get-secret-value --secret-id $($TF output -raw redis_auth_secret_arn) --query SecretString --output text)"
echo "JWT access:   $(aws secretsmanager get-secret-value --secret-id $($TF output -raw jwt_access_secret_arn) --query SecretString --output text)"
echo "Shared s2s:   $(aws secretsmanager get-secret-value --secret-id $($TF output -raw api_shared_secret_arn) --query SecretString --output text)"
openssl rand -base64 32   # run 4 more times for: JWT_REFRESH_SECRET, AUTH_HASH_PEPPER, MEDIA_SCAN_SECRET, admin JWT
```

**c) Write one settings file per service** in your private folder. Start each from the service's own example file —
it lists every setting and marks which are `REQUIRED-HARD` in production:
```bash
for app in api admin-api wallet-service worker realtime-gateway ai-services; do
  cp apps/$app/.env.example ~/krishalaya-secrets/staging-$app.env
done
open -e ~/krishalaya-secrets/staging-api.env     # edit each file in turn
```
Fill them using the table in [S1 runbook §6.1](terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md) (every value is
explained there). The connection strings look like this (put **your** passwords/hosts in):
```
DATABASE_URL=postgresql://kv_app:<kv_app pw>@<DB host>:5432/krishalaya?sslmode=require
DATABASE_REPLICA_URL=<same as DATABASE_URL — staging has no reader>
REDIS_URL=rediss://:<Redis auth>@<Redis host>:6379
S3_MEDIA_BUCKET=<Media bucket>
WALLET_GRPC_URL=krishalaya-wallet-service.krishalaya.svc.cluster.local:50051
SMS_PROVIDER=twilio
```
Rules: `wallet-service` uses the **kv_wallet** user in its URL; `worker` and `ai-services` use **kv_relay**;
`realtime-gateway` must have the **same** `JWT_ACCESS_SECRET` as `api`; in `admin-api` set `ADMIN_IP_ALLOWLIST` to
your office/home IP (<https://checkip.amazonaws.com>) and `ADMIN_REQUIRE_HARDWARE_KEY=true`. **Every secret must be
newly generated** (`openssl rand -base64 32`) — never keep a value from an example file, a test, or your laptop's
`.env`: the repository is public, and a production service refuses to start if any of its secrets matches a value
ever committed to it (the error names the setting to replace). Leave a value **empty**
to mean "not set" (e.g. all `OPENSEARCH_*` in staging). **Never** set `AUTH_EXPOSE_OTP=true`, `S3_ACCESS_KEY_ID` or
`S3_SECRET_ACCESS_KEY`.

**d) Upload each file as one secret** (empty values are left out):
```bash
to_json() { node -e 'const fs=require("fs");const o={};for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;const v=m[2].replace(/\s+#.*$/,"").trim().replace(/^"(.*)"$/,"$1");if(v!=="")o[m[1]]=v;}process.stdout.write(JSON.stringify(o));' "$1"; }
up() { aws secretsmanager create-secret --name "krishalaya-staging/$2/env" --secret-string "$(to_json ~/krishalaya-secrets/staging-$1.env)" --region ap-south-1 >/dev/null \
     || aws secretsmanager put-secret-value --secret-id "krishalaya-staging/$2/env" --secret-string "$(to_json ~/krishalaya-secrets/staging-$1.env)" >/dev/null; echo "uploaded $2"; }
up api api; up admin-api admin-api; up wallet-service wallet; up worker worker; up realtime-gateway realtime; up ai-services ai
```
**Check:** `aws secretsmanager list-secrets --query 'SecretList[].Name' --output text | tr '\t' '\n' | grep staging`
lists the six `…/env` secrets plus the db passwords.

**e) Copy them into the cluster** (External Secrets Operator):
```bash
helm repo add external-secrets https://charts.external-secrets.io && helm repo update
helm upgrade --install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$($TF output -raw external_secrets_role_arn)
kubectl -n external-secrets rollout status deploy/external-secrets
kubectl apply -f infra/k8s/external-secrets/staging/00-cluster-secret-store.yaml
kubectl apply -f infra/k8s/external-secrets/staging/
kubectl -n krishalaya get externalsecret        # every row: STATUS SecretSynced, READY True
```
**If a row is not synced:** `kubectl -n krishalaya describe externalsecret <name>` — usually a secret name typo in d).

**f) Delete the local files** once synced (AWS is now the only copy — it is backed up and encrypted):
```bash
rm ~/krishalaya-secrets/staging-*.env
```
To change a value later: `aws secretsmanager get-secret-value --secret-id krishalaya-staging/api/env` → edit →
`put-secret-value`, then `kubectl -n krishalaya rollout restart deploy/api`.

### 7.10 Prepare the database (migrate, partitions, roles, reference data, security gate) — [ ]

**Why:** creates every table, gives the three app users their passwords, loads reference data (never demo data), and
proves every tenant table is protected by row-level security. One script does it all: [`db/prod/apply.sh`](../db/prod/DB-BOOTSTRAP-RUNBOOK.md).

**The catch:** the database sits in private subnets — your Mac cannot reach it directly (that's good security). So you
open a **temporary tunnel** through the cluster for the few minutes the script runs.

**Do — Terminal window 1:**
```bash
WRITER=$($TF output -raw aurora_writer_endpoint)
lsof -i :5432 && echo "STOP: something on your Mac uses port 5432 (local Postgres/Docker) — stop it first"
kubectl -n krishalaya run db-tunnel --image=alpine/socat --restart=Never -- \
  tcp-listen:5432,fork,reuseaddr tcp-connect:$WRITER:5432
kubectl -n krishalaya wait --for=condition=Ready pod/db-tunnel --timeout=120s
echo "127.0.0.1 $WRITER" | sudo tee -a /etc/hosts      # asks your Mac password; temporary
```
**Do — Terminal window 2** (leave it running):
```bash
kubectl config use-context krishalaya-staging
kubectl -n krishalaya port-forward pod/db-tunnel 5432:5432
```
**Do — back in window 1:**
```bash
PROJECT=krishalaya-staging REGION=ap-south-1 WRITER_HOST=$WRITER \
MASTER_SECRET_ARN=$($TF output -raw aurora_master_secret_arn) \
  ./db/prod/apply.sh
```
**Check:** it ends without any `FATAL:` line, after the steps *Migrate → Partitions → Role logins → Seed reference →
RLS gate → kv_app probe*.

**Then close the tunnel (always):**
```bash
sudo sed -i '' "/$WRITER/d" /etc/hosts          # removes the temporary line
kubectl -n krishalaya delete pod db-tunnel       # and Ctrl-C in window 2
```

---

## Part 8 — Automatic deploys from GitHub

How it works (details: [`DEPLOY-RUNBOOK.md` §7](DEPLOY-RUNBOOK.md)): GitHub builds the app images, logs in to AWS
**without any stored key** (OIDC — AWS trusts GitHub for this one repository and environment only), pushes images to
ECR, installs each service with automatic rollback if it is unhealthy, then checks `/healthz` inside the cluster and
over public HTTPS.

### 8.1 Protect the `main` branch — [ ]

**Do:** GitHub → repo **Settings → Branches** (<https://github.com/imsmo/krishalaya/settings/branches>) → Add rule for
`main` → tick **Require a pull request before merging** (if you work alone set *required approvals* to **0** — you
still get a PR record and CI must pass), **Require status checks to pass** → add **`build-test`** and **`security`** (both
from the `CI` workflow, which runs on every PR). Don't add `gates` (mobile-ci): it only runs when mobile files change,
so other PRs would wait for it forever. Docs: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>

### 8.2 Create the two GitHub Environments — [ ]

**Do:** **Settings → Environments** (<https://github.com/imsmo/krishalaya/settings/environments>) →
- **New environment** `staging` → *Deployment branches*: **Selected branches** → `main`.
- **New environment** `production` → **Required reviewers**: you (and a co-founder/CTO if you have one) →
  *Prevent self-review* if you have two reviewers → *Deployment branches*: `main` only.
Docs: <https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment>

### 8.3 Give the `staging` environment its settings — [ ]

These are **not secrets** (no passwords) — just names and addresses. Run from the repo with the staging profile:
```bash
gh auth login            # once
E=staging
gh variable set AWS_DEPLOY_ROLE_ARN --env $E --body "$($TF output -raw github_deploy_role_arn)"
gh variable set EKS_CLUSTER_NAME   --env $E --body "$($TF output -raw eks_cluster_name)"
gh variable set IRSA_ROLE_ARNS     --env $E --body "$($TF output -json irsa_role_arns | jq -c .)"
gh variable set ACM_CERT_ARN       --env $E --body "$($TF output -raw acm_certificate_arn)"
gh variable set WAF_ACL_ARN        --env $E --body "$($TF output -raw waf_web_acl_arn)"
gh variable set ROOT_DOMAIN        --env $E --body "staging.krishalaya.com"
```
**The web apps' public settings** (built into the browser code, so **never put a secret here**). For each web app,
look at the `NEXT_PUBLIC_…` lines in its `.env.example` and give staging values. Example for the storefront:
```bash
gh variable set NEXT_PUBLIC_ENV_WEB_STOREFRONT --env staging --body "$(cat <<'EOF'
NEXT_PUBLIC_API_URL=https://api.staging.krishalaya.com
NEXT_PUBLIC_SITE_URL=https://staging.krishalaya.com
NEXT_PUBLIC_TENANT_APP_URL=https://tenant.staging.krishalaya.com
NEXT_PUBLIC_PLATFORM_COUNTRY=IN
NEXT_PUBLIC_PLATFORM_TENANT_SLUG=<your platform tenant slug>
NEXT_PUBLIC_RAZORPAY_KEY_ID=<rzp_test_… key id — the PUBLIC key id only, never the secret>
EOF
)"
```
Do the same for `NEXT_PUBLIC_ENV_WEB_TENANT`, `…_WEB_ADMIN` (uses `NEXT_PUBLIC_ADMIN_API_URL=https://admin-api.staging.krishalaya.com`),
`…_WEB_PARTNER`, `…_WEB_GOV`, `…_WEB_OPS` — each from its own `apps/<app>/.env.example`.
**Check:** <https://github.com/imsmo/krishalaya/settings/environments> → staging → 12 variables.

### 8.4 The first staging deploy — [ ]

**Do:** GitHub → **Actions** → **deploy-staging** → **Run workflow** → branch `main` → tick **migrations_applied**
(you applied every migration in 7.10) → Run. It takes ~25–40 minutes the first time.

**Check:** the run turns green and its **Summary** says *Deployed to staging*. Then in your browser:
- <https://staging.krishalaya.com> — the storefront loads with a padlock (HTTPS).
- <https://api.staging.krishalaya.com/healthz> — shows OK.
- `http://staging.krishalaya.com` redirects to `https://`.
```bash
kubectl -n krishalaya get pods        # all Running, READY 1/1
kubectl -n krishalaya get ingress     # ADDRESS shows one k8s-krishala-… load balancer name for every host
```
**If it fails:** open the red step in the run and paste its log to Claude. Common causes: a missing variable (the run
says which), a pod that won't start (`kubectl -n krishalaya logs deploy/api` usually shows `FATAL: insecure
production config -> …` naming the setting to fix in 7.9).

From now on staging **redeploys itself every day at 6 PM IST** from `main`. If a day's changes include new
`db/migrations`, the run **stops** and tells you — apply them with 7.10 (tunnel + `apply.sh`, it only runs what is
new), then *Run workflow* with **migrations_applied** ticked.

### 8.5 Housekeeping that stops two silent cost leaks — [ ]

**Why:** (1) every deploy pushes 13 images (a few hundred MB each) to ECR and nothing deletes old ones — storage grows
every month forever; (2) the cluster's audit logs go to CloudWatch with **no expiry** by default.

**Do (after the first deploy, once per environment):**
```bash
# keep the newest 30 images per repository, delete older ones automatically
for r in $(aws ecr describe-repositories --query 'repositories[?starts_with(repositoryName,`krishalaya-`)].repositoryName' --output text); do
  aws ecr put-lifecycle-policy --repository-name $r --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep last 30","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":30},"action":{"type":"expire"}}]}' >/dev/null
  echo "lifecycle set: $r"
done
# keep cluster logs 30 days in staging (use 365 in production — audit evidence)
aws logs put-retention-policy --log-group-name "/aws/eks/$($TF output -raw eks_cluster_name)/cluster" --retention-in-days 30
```
**Check:** ECR console → any `krishalaya-…` repository → *Lifecycle policy* shows the rule.

---

## Part 9 — Monitoring and alerts

**Why:** you must know about a problem **before** farmers tell you. The repo ships dashboards (`ops/dashboards/`),
alert rules (`ops/alerts/`) and the alert routing; this installs them. Full reference: [`OBSERVABILITY-RUNBOOK.md`](OBSERVABILITY-RUNBOOK.md).

### 9.1 Where alerts go — [ ]

**Do:**
1. **Slack** (free): create a channel `#kv-alerts` → add an **Incoming Webhook** app → copy the webhook URL.
   (<https://api.slack.com/messaging/webhooks>)
2. **PagerDuty** (free plan, up to 5 users): create a service "Krishalaya production" → *Events API v2* integration →
   copy the **routing key**. Install the PagerDuty phone app so a real outage **rings your phone at night**.
   (<https://www.pagerduty.com/sign-up/>)

### 9.2 Install the monitoring stack — [ ]

```bash
kubectl config current-context                 # staging first
kubectl create namespace monitoring
kubectl -n monitoring create secret generic krishalaya-alerting \
  --from-literal=slack_webhook_url='<SLACK WEBHOOK URL>' \
  --from-literal=pagerduty_routing_key='<PAGERDUTY ROUTING KEY>'
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts && helm repo update
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack -n monitoring \
  -f infra/k8s/observability/values-kube-prometheus-stack.yaml
kubectl apply -f infra/k8s/observability/servicemonitor.yaml
kubectl apply -n monitoring -f ops/alerts/
for d in ops/dashboards/*.json; do
  kubectl create configmap "dash-$(basename "$d" .json)" -n monitoring --from-file="$(basename "$d")=$d" \
    --dry-run=client -o yaml | kubectl label --local -f - grafana_dashboard=1 -o yaml | kubectl apply -f -
done
kubectl apply -f infra/k8s/observability/alertmanager-config.yaml
```
**Check:**
```bash
kubectl -n monitoring get pods                        # all Running (Prometheus may take 2–3 min: it creates a 50 GiB disk)
kubectl -n monitoring get pvc                         # STATUS Bound
```
**Open Grafana** (private — only through your own kubectl, never public):
```bash
kubectl -n monitoring get secret kube-prometheus-stack-grafana -o jsonpath='{.data.admin-password}' | base64 -d; echo
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```
Browse <http://localhost:3000> → user `admin` + the password above → Dashboards → the six **Krishalaya ·** dashboards.

### 9.3 Prove an alert really reaches you — [ ]

```bash
kubectl -n krishalaya scale deploy/api --replicas=0     # simulate the API dying (staging!)
# within ~5 minutes: PagerDuty rings / Slack #kv-alerts gets "ApiTargetDown"
kubectl -n krishalaya scale deploy/api --replicas=1     # restore
```
**Check:** you received the alert, and a "resolved" message after restoring. **Do not skip this** — an alert that has
never been tested is an alert that doesn't work.

### 9.4 Watch the AWS-managed parts too — [ ]

Prometheus watches the cluster; AWS watches the managed services. Create these CloudWatch alarms (CloudWatch →
Alarms → Create alarm, <https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#alarmsV2:>),
each sending to the SNS topic `security-alerts` from 5.4 (or a new `ops-alerts` topic):

| Metric (namespace) | Condition | Why |
|---|---|---|
| Aurora `CPUUtilization` (AWS/RDS, your cluster) | > 80% for 10 min | database overloaded |
| Aurora `ServerlessDatabaseCapacity` | ≥ your max ACU for 15 min | at the ceiling — raise `aurora_max_acu` |
| Aurora `FreeLocalStorage` | < 5 GB | disk filling |
| ElastiCache `DatabaseMemoryUsagePercentage` | > 80% | Redis full |
| ApplicationELB `HTTPCode_Target_5XX_Count` | > 50 in 5 min | users seeing errors |
| WAFV2 `BlockedRequests` (rule `rate-limit`) | > 1000 in 5 min | attack **or** real users being blocked (see 12.6) |

💰 ₹8–10 per alarm per month.

---

## Part 10 — Prove it: drills and load tests on staging

Do these on **staging** before production exists. Each one proves a safety net works *before* you need it.

### 10.1 Restore the database from backup (PITR drill) — [ ]

Follow [S1 runbook §10](terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md) exactly. Record how long the restore took in
[`ops/runbooks/restore-drill.md`](../ops/runbooks/restore-drill.md). Target: back in **≤ 60 minutes**.

### 10.2 Prove a weak secret stops the app (fail-closed drill) — [ ]

Follow [S1 runbook §11](terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md): set a deliberately weak `JWT_ACCESS_SECRET`
in staging, confirm `api` **refuses to start** with `FATAL: insecure production config`, then restore the real value.

### 10.3 Lose a machine on purpose (resilience drill) — [ ]

```bash
NODE=$(kubectl get nodes -o name | head -1)
kubectl drain ${NODE#node/} --ignore-daemonsets --delete-emptydir-data     # pods move to the other nodes
kubectl -n krishalaya get pods -o wide                                      # all Running again on other nodes
kubectl uncordon ${NODE#node/}
```
**Check:** the storefront and `/healthz` stayed reachable throughout (staging runs 1 replica, so expect a few seconds of
blips; production runs 2+ replicas and should show none).

### 10.4 Load test — [ ]

**Why:** find the breaking point on staging, not on launch day.
**Rules:** only test **your own** systems; never point load at production during business hours; tell your team.
```bash
BASE=https://api.staging.krishalaya.com k6 run ops/load-tests/k6-order-flow.js
```
While it runs, watch Grafana (*API golden signals*, *DB health*) and:
```bash
kubectl -n krishalaya get hpa -w          # replicas rising with load
kubectl get nodes -w                      # Cluster Autoscaler adding a node when pods don't fit
```
**Check:** the test's built-in SLO thresholds pass (green), the HPA scaled up and back down afterwards, and no `page`
alert fired. The other scripts in [`ops/load-tests/`](../ops/load-tests/) (auction burst, morning milk-collection peak,
payout batch, realtime sockets, 72-hour soak) follow the same pattern — run each before the feature it covers launches.
Staging is deliberately small: it proves the **mechanisms** (autoscaling, alerts) work; production's numbers come from
running the same scripts against production in a quiet window before launch (Part 12.7).

---

## Part 11 — Build PRODUCTION

Production is the **same recipe** as staging (Part 7–9) in the **prod account**, with the differences below. Before you
start: staging has been green for at least a week, Part 10 drills passed, and you have **live** provider keys
(Razorpay/RazorpayX live, eKYC production, MSG91 with **DLT-approved** sender + OTP template).

> Every command in Part 11 runs with:
> ```bash
> cd ~/Documents/Personal/farmer/krishalaya
> export AWS_PROFILE=krishalaya-prod && aws sso login
> aws sts get-caller-identity      # Account MUST be your PROD_ACCOUNT_ID
> export AWS_REGION=ap-south-1
> TF="terraform -chdir=infra/terraform/envs/prod"
> ```

### 11.1 State bucket — [ ]
Same as [7.1](#71-create-the-place-terraform-remembers-what-it-built---) (in the prod account — it gets its own bucket).

### 11.2 Placeholders — [ ]
Same as [7.2](#72-fill-in-the-three-placeholders---) but in `infra/terraform/envs/prod/` with the **prod** account ID.
Already set for you in prod (on purpose): `ON_DEMAND` nodes, one NAT per zone, 35-day backups, a database reader,
deletion protection, OpenSearch.

### 11.3 Pass A — [ ]
```bash
$TF init && $TF validate
$TF plan -out=tf-a.plan \
  -target=module.secrets -target=module.vpc -target=module.eks -target=module.aurora -target=module.redis \
  -target=module.opensearch -target=module.media -target=module.irsa -target=module.dns -target=module.waf \
  -target=module.alb_edge_iam -target=module.github_deploy
$TF apply tf-a.plan
$TF output route53_name_servers
```

### 11.4 Move `krishalaya.com` to AWS DNS — the careful way — [ ]

**Why careful:** changing the **whole domain's** name servers replaces your registrar's DNS. Anything you don't copy
first — **email (MX)**, SPF/DKIM/DMARC (TXT), Google/Microsoft verification — **stops working**. And the `staging`
delegation you added at the registrar in 7.4 disappears too.

**Do, in this order:**
1. Route 53 (prod account) → Hosted zones → `krishalaya.com` → **Create record** for **every** record in your
   `~/krishalaya-secrets/dns-records-before.txt` (6.1) **except** NS and SOA. Same type, name, value, TTL.
2. In the same zone, add the **staging delegation**: record name `staging`, type **NS**, value = the 4 staging name
   servers (from the staging account: `terraform -chdir=infra/terraform/envs/staging output route53_name_servers`).
3. Compare before switching — each pair must match:
   ```bash
   Z=$($TF output route53_name_servers | head -1 | tr -d '",[ ')
   dig +short MX krishalaya.com ; dig +short MX krishalaya.com @$Z
   dig +short TXT krishalaya.com ; dig +short TXT krishalaya.com @$Z
   ```
4. At the registrar, set the domain's **name servers** to the 4 Route 53 ones (this is a *different* screen from DNS
   records — usually "Nameservers" → "Custom").
5. **Check** after 1–48 h: `dig +short NS krishalaya.com` shows `awsdns`; send yourself a test email; staging still
   loads.

### 11.5 Pass B, connect, helpers — [ ]
- `$TF plan -out=tf-b.plan && $TF apply tf-b.plan` then `$TF output -json > ~/krishalaya-secrets/prod-outputs.json`
- [7.6](#76-connect-to-the-cluster---) with `--alias krishalaya-prod` (and `kubectl config use-context krishalaya-prod`).
- [7.7](#77-install-the-clusters-helpers---) exactly, except external-dns: `--set txtOwnerId=krishalaya-prod` and
  `--set "domainFilters[0]=krishalaya.com"`.

### 11.6 Production secrets — [ ]
[7.9](#79-put-the-secrets-into-aws-secrets-manager---) with these changes:
- Every name is `krishalaya-prod/…` (not `-staging`), files `prod-<app>.env`.
- `DATABASE_REPLICA_URL` uses the **reader** endpoint: `$TF output -raw aurora_reader_endpoint`.
- OpenSearch is on: `OPENSEARCH_URL=https://<$TF output -raw opensearch_endpoint>`, username/password from the
  `krishalaya-prod/opensearch/master` secret ([SECRETS-RUNBOOK §1b](SECRETS-RUNBOOK.md)).
- **Live** keys: Razorpay/RazorpayX live, `SMS_PROVIDER=msg91` + `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`,
  `MSG91_OTP_TEMPLATE_ID` (DLT), eKYC production.
- `ADMIN_IP_ALLOWLIST` = your **office** fixed IP(s) only.
- In **e)** apply the production manifests: `kubectl apply -f infra/k8s/external-secrets/00-cluster-secret-store.yaml`
  then `kubectl apply -f infra/k8s/external-secrets/` (the top-level files, not `staging/`).

### 11.7 Database — [ ]
[7.10](#710-prepare-the-database-migrate-partitions-roles-reference-data-security-gate---) with `PROJECT=krishalaya-prod`.

### 11.8 GitHub `production` environment — [ ]
[8.3](#83-give-the-staging-environment-its-settings---) with `E=production`, `ROOT_DOMAIN=krishalaya.com`, the prod
`$TF` outputs, and production public settings (e.g. `NEXT_PUBLIC_API_URL=https://api.krishalaya.com`, the **live**
Razorpay key **id**).

### 11.9 First production deploy — [ ]
1. Make sure today's `main` commit deployed **green** on staging (Actions → deploy-staging).
2. It must be **Tuesday or Friday (IST)** — the release window. (Emergency outside it: tick *out_of_window* and write
   a reason.)
3. Actions → **deploy-prod** → Run workflow → branch `main` → tick **migrations_applied** (you ran 11.7) → Run.
4. GitHub asks the `production` reviewers to **approve** — approve it.
5. **Check:** green run; <https://krishalaya.com>, <https://api.krishalaya.com/healthz>, every host from Part 6.
6. Do [8.5](#85-housekeeping-that-stops-two-silent-cost-leaks---) (with **365** days log retention) and [Part 9](#part-9--monitoring-and-alerts) in prod.

**Every later production release:** merge to `main` → staging deploys at 6 PM → check staging → on Tue/Fri run
**deploy-prod** → approve. It refuses any commit that staging hasn't proven.

---

## Part 12 — Go-live security checklist

Do all of these in **production** before real users arrive.

### 12.1 GuardDuty full protection — [ ]
GuardDuty (prod account) → Protection plans → also turn on **Runtime Monitoring (EKS, automated agent)** and
**Malware Protection for EC2/EBS**. 💰 ~₹1,500–3,000/month more; worth it for a payments platform.

### 12.2 Admin access — [ ]
- `admin-api` rejects every IP not on `ADMIN_IP_ALLOWLIST` (production refuses to start with it empty) — set it to
  your office/VPN egress IPs.
- ⚠️ **Not built yet — a launch blocker on the development side:** the production admin sign-in (`/auth/sso/start`,
  identity provider + hardware-key/WebAuthn ceremony) does not exist in the code today. The hardware-key *check*
  (`hardware-key.guard.ts`) is there, but nothing issues the token it checks, and the dev login is correctly blocked
  in production. Until the sign-in is built, **nobody can log in to the production admin console**. When it ships,
  this step becomes: register both YubiKeys for each admin.
- IAM Identity Center: only people who truly need production get the prod account. Review every quarter
  ([`security/access-review-quarterly.md`](../security/access-review-quarterly.md)).
- Turn on **MFA required** for GitHub organization members (<https://github.com/settings/security>).

### 12.3 Security Hub — production only — [ ]
<https://ap-south-1.console.aws.amazon.com/securityhub/home?region=ap-south-1> → Enable → standards: **AWS
Foundational Security Best Practices**. Fix every *Critical* and *High* it lists (paste them to Claude one at a time).
💰 ~₹1,000–2,500/month.

### 12.4 DDoS protection — [ ]
**AWS Shield Standard** protects every ALB and Route 53 zone automatically, free. The WAF (managed rule sets for common
attacks, SQL injection, known-bad inputs, bad-reputation IPs, plus a per-IP rate limit) is already attached to every
public host. Shield **Advanced** (~US$3,000/month) is not needed at launch.

### 12.5 Penetration test — [ ]
Before launch, have an external firm test production (scope: [`security/pentest-scope.md`](../security/pentest-scope.md)).
AWS allows testing your own resources for most services **without asking first** — read the rules:
<https://aws.amazon.com/security/penetration-testing/>. Publish the vulnerability-disclosure policy
([`security/bug-bounty-policy.md`](../security/bug-bounty-policy.md), [`security/security.txt`](../security/security.txt)).

### 12.6 The rate limit vs. Indian mobile networks — [ ]
The WAF blocks any single IP sending more than **2,000 requests per 5 minutes**. Indian mobile carriers put **many users
behind one IP** (carrier NAT). In the first weeks, watch the WAF alarm from 9.4: if real users are blocked, raise
`rate_limit_per_5min` in [`modules/waf`](terraform/modules/waf/variables.tf) (via the env's `module "waf"` block) and
re-apply — don't switch the limit off.

### 12.7 Production load test in a quiet window — [ ]
Run [10.4](#104-load-test---) against `https://api.krishalaya.com` **before launch** (night, no users). It proves the
real sizes and lets the autoscaler show it can add nodes up to `max_size` (5).

### 12.8 Data protection (DPDP Act) — [ ]
Run [`db/prod/dpdp-verify.sh`](../db/prod/dpdp-verify.sh) and work through
[`docs/security/DPDP-COMPLIANCE.md`](../docs/security/DPDP-COMPLIANCE.md). Everything stays in `ap-south-1` (India).

### 12.9 Incident readiness — [ ]
Read [`security/incident-response-plan.md`](../security/incident-response-plan.md) and the runbooks in
[`ops/runbooks/`](../ops/runbooks/) (production down, payment mismatch, wallet reconciliation, tenant leak suspected,
SMS cost spike). Put the PagerDuty app on two phones.

---

## Part 13 — Running it: daily, weekly, monthly

| When | Do | Where |
|---|---|---|
| **Daily** (5 min) | Glance at Slack `#kv-alerts`; read any GuardDuty / budget emails | Slack, email |
| **Every release** | PR → CI green → merge → staging deploys 6 PM → check staging → Tue/Fri `deploy-prod` → approve | GitHub Actions |
| **Weekly** (30 min) | Cost Explorer: anything unusual? GuardDuty findings: none open? Grafana: error rate and latency trends | AWS console, Grafana |
| **Monthly** (2 h) | Restore drill (10.1) on staging; review budgets; review WAF blocked requests; dependency audit still green | runbooks |
| **Quarterly** | Rotate secrets (JWT refresh, pepper, DB passwords — `db/prod/create-roles.sh` re-applies) and access review | [SECRETS-RUNBOOK](SECRETS-RUNBOOK.md) |
| **Before 2027-05** | Upgrade Kubernetes 1.36 → 1.37 (13.2) | — |

### 13.1 Roll back a bad release
```bash
helm -n krishalaya history api                 # find the last good REVISION
helm -n krishalaya rollback api <REVISION>     # instant; repeat per affected service
```
A bad **migration** cannot be rolled back by Helm — restore the database to just before it (Point-in-time restore,
[S1 §12](terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md)), fix the migration, release again.

### 13.2 Keep Kubernetes current (do not skip — it is also a cost rule)
Each Kubernetes version gets ~14 months of standard support on EKS; after that AWS charges **6×** for the control plane.
The cluster is set to **standard support only**, so if you forget, AWS force-upgrades it — on its schedule, not yours.
Calendar: 1.36 standard support ends **2 Aug 2027** (<https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html>).
How: change `default = "1.36"` → `"1.37"` in [`modules/eks/variables.tf`](terraform/modules/eks/variables.tf) → `plan` +
`apply` **staging** → run Part 10 checks → then production → update the Cluster Autoscaler `image.tag` to the matching
`v1.37.x` (7.7). One minor version at a time.

### 13.3 Remove the audit exceptions
The 26 accepted advisories in [`docs/security/AUDIT-EXCEPTIONS.md`](../docs/security/AUDIT-EXCEPTIONS.md) all disappear
with the **Expo SDK upgrade** of the mobile app. Schedule it; then delete the exceptions.

---

## Appendix A — Words you will see

| Word | Plain meaning |
|---|---|
| **Region / AZ** | A region is a city (Mumbai, `ap-south-1`). An AZ (availability zone) is one data-centre building group in it; we use 2. |
| **VPC / subnet** | Your private network in AWS. *Public* subnets face the internet (load balancer); *private* ones hold the cluster; *isolated* ones hold the database (no internet at all). |
| **NAT gateway** | Lets private machines call out to the internet (Razorpay, SMS) without being reachable from it. |
| **EKS / Kubernetes / node / pod** | EKS runs Kubernetes for you. *Nodes* are the machines; *pods* are running copies of an app. |
| **Helm / chart / release** | Helm installs an app into Kubernetes from a *chart* (template). One installed app = one *release*. |
| **HPA** | Horizontal Pod Autoscaler: adds/removes pods of an app with CPU load. |
| **Cluster Autoscaler** | Adds/removes **nodes** when pods don't fit / nodes are idle. |
| **Ingress / ALB** | The rule that exposes an app at a hostname / the AWS load balancer that serves it. |
| **WAF** | Web Application Firewall: filters attacks and abusive traffic before it reaches the apps. |
| **ACM** | AWS's free TLS (HTTPS) certificates. |
| **Route 53** | AWS DNS. |
| **Aurora / ACU** | AWS's managed PostgreSQL. Serverless v2 grows and shrinks in *ACUs* (capacity units). |
| **ElastiCache / Redis** | Fast in-memory store for sessions, queues, rate limits. |
| **S3 / ECR** | File storage / container image storage. |
| **IAM / role / IRSA / OIDC** | Who may do what. A *role* is a set of permissions something can borrow. *IRSA* gives a pod its own role; *OIDC* lets GitHub borrow a role with no stored key. |
| **Secrets Manager / ESO** | AWS's encrypted secret store / the operator that copies those secrets into the cluster. |
| **Terraform / state / plan / apply** | Infrastructure as code: *plan* shows the changes, *apply* makes them; *state* is its memory. |
| **PITR** | Point-in-time restore: rebuild the database as it was at any second within the retention window. |
| **SPOT / ON_DEMAND** | Spare AWS capacity at ~70% off that can be taken back with 2 minutes' notice / normal price that is never taken back. |

---

## Appendix B — Costs in detail

Approximate monthly costs at **₹85 = US$1**, Mumbai prices, low (launch) traffic. Verify any line with
<https://calculator.aws/>. Traffic-driven lines (data transfer out, WAF requests, Aurora ACUs, extra nodes) grow with
users — that's expected; your budgets (Part 4) tell you when.

### B.1 Staging (~₹26,000–28,000/month)

| Item | ₹/month | Notes |
|---|---|---|
| EKS control plane | ~6,200 | fixed per cluster |
| 3× t3.medium nodes (SPOT) + disks | ~4,700 | autoscaler can drop to 2 when idle |
| Aurora Serverless v2 (0.5–2 ACU, no reader) | ~4,500 | |
| NAT gateway (1) + data | ~3,500 | |
| Load balancer (ALB) | ~2,000 | one ALB shared by all hosts |
| Redis (t4g.micro, single) | ~1,200 | |
| WAF + Route 53 | ~1,100 | |
| CloudWatch logs, Secrets Manager, KMS, GuardDuty | ~2,500 | |
| S3 / ECR / transfer | ~500 | with 8.5's lifecycle rule |
| Prometheus disk (50 GiB) | ~400 | |

### B.2 Production at launch (~₹55,000–70,000/month)

| Item | ₹/month | Notes |
|---|---|---|
| 2× t3.large ON_DEMAND (+ up to 3 more under load) | ~11,000 (→ ~27,500 at max) | the biggest scaling line |
| Aurora (writer + reader, 0.5–4 ACU) + storage | ~12,000–16,000 | grows with database work |
| NAT gateways (2) + data | ~7,000+ | |
| EKS control plane | ~6,200 | |
| OpenSearch (2 small nodes) | ~5,500 | |
| GuardDuty (full) + Security Hub | ~3,000–5,500 | |
| ALB + WAF + Route 53 | ~4,000+ | WAF adds ~₹50 per million requests |
| Redis (primary + replica) | ~2,400 | |
| Logs, Secrets, KMS, backups | ~3,000 | 35-day backups mostly free up to DB size |
| Data transfer out to users | ~2,000+ | ~₹9 per GB leaving AWS — media-heavy pages drive it |

### B.3 Cutting the bill without breaking anything

1. **Staging idle for 2+ weeks?** Destroy it (`$TF destroy` in `envs/staging` only — never prod). It rebuilds from
   this guide in about half a day. Saves ~₹26,000/month.
2. **After 2–3 months of steady production use:** buy a **Compute Savings Plan** (1 year, no upfront) for your steady
   node usage — typically 20–30% off EC2. (<https://aws.amazon.com/savingsplans/>) Don't buy before usage is stable.
3. **Images and media:** keep the ECR lifecycle (8.5) and S3 lifecycle (already in Terraform) on.
4. **Never** cut by disabling backups, GuardDuty, WAF, the second NAT, or the database reader — those are what keep
   production up and safe.

---

## Appendix C — When something goes wrong

| Symptom | Most likely cause | Do |
|---|---|---|
| `ExpiredToken` / `Unable to locate credentials` | SSO session expired | `aws sso login` |
| Terraform `Error acquiring the state lock` | a previous run was interrupted | make sure no other run is active, then `$TF force-unlock <LOCK_ID>` (ID is in the error) |
| `apply` hangs on `aws_acm_certificate_validation` | DNS not delegated/propagated | check `dig +short NS staging.krishalaya.com` (or the apex) and wait |
| Pod `CrashLoopBackOff` | a missing/weak setting | `kubectl -n krishalaya logs deploy/<app>` → the `FATAL:` line names it → fix in Secrets Manager → `rollout restart` |
| Pod `Pending` | no room on nodes | `kubectl -n krishalaya describe pod <pod>`; the autoscaler should add a node within ~3 min (`kubectl -n kube-system logs deploy/cluster-autoscaler-aws-cluster-autoscaler` or `get deploy` to find its name) |
| ExternalSecret not `SecretSynced` | wrong secret name, or ESO role | `kubectl -n krishalaya describe externalsecret <name>` |
| Site shows 502/504 | app not Ready, or wrong health path | `kubectl -n krishalaya get pods`; ALB checks `/healthz` (APIs) or `/` (web) |
| Ingress has no ADDRESS | load balancer controller unhappy | `kubectl -n kube-system logs deploy/aws-load-balancer-controller` |
| Host doesn't resolve | external-dns or delegation | `kubectl -n external-dns logs deploy/external-dns` |
| deploy run "skipped — not configured" | a GitHub Environment variable is missing | the run's notice names it (Part 8.3) |
| deploy run "Migrations pending" | new `db/migrations` | do 7.10 (prod: 11.7), then re-run with *migrations_applied* |
| deploy-prod "Not proven on staging" | that commit didn't deploy green to staging | run deploy-staging for it first |
| Bill jumped | anomaly | Cost Explorer → *Group by: Service* → paste the top lines to Claude |

---

## Appendix D — Growing to millions of users

The foundation you just built **scales by changing numbers, not code** — but scale is earned step by step, each step
proven with a load test (10.4 / 12.7) on the real system. Don't pre-buy capacity you aren't using.

| When you see… | Turn this knob | Where |
|---|---|---|
| Nodes at `max_size`, pods Pending at peak | raise `eks_node_max_size`; later bigger/more varied instance types | `envs/prod/terraform.tfvars` |
| Aurora at max ACU (alarm 9.4) | raise `aurora_max_acu` (up to 256); add readers | tfvars / `envs/prod/main.tf` |
| Redis memory > 80% | larger `redis_node_type` | tfvars |
| One app's HPA at max replicas | raise `autoscaling.maxReplicas` in that chart | `infra/helm/<app>/values.yaml` |
| Real users blocked by WAF | raise `rate_limit_per_5min` | `modules/waf` (12.6) |
| Data transfer bill growing with media | put images/media behind a CDN (CloudFront) | a future infra wave |
| Very high event volume | stream processing on Kafka/MSK (the `stream-processor` app, GA plan) | a future infra wave |

Planning references already in the repo: [`ops/capacity-plan.md`](../ops/capacity-plan.md),
[`ops/slo.md`](../ops/slo.md), and the model [`ops/load-tests/k6-billion-scale-model.js`](../ops/load-tests/k6-billion-scale-model.js).
Honest note: "millions of users and billions of operations" is reached by **measuring, then growing** — the system is
built for horizontal growth (more pods, more nodes, more database capacity, partitioned tables), and every step above
is a configuration change you can make in minutes once the numbers say you need it.

---

*Built from — and kept consistent with — the repo's own runbooks: [`terraform/APPLY-RUNBOOK-prod.md`](terraform/APPLY-RUNBOOK-prod.md),
[`terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md`](terraform/envs/staging/S1_STAGING_APPLY_RUNBOOK.md),
[`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md), [`EDGE-RUNBOOK.md`](EDGE-RUNBOOK.md), [`SECRETS-RUNBOOK.md`](SECRETS-RUNBOOK.md),
[`OBSERVABILITY-RUNBOOK.md`](OBSERVABILITY-RUNBOOK.md), [`../db/prod/DB-BOOTSTRAP-RUNBOOK.md`](../db/prod/DB-BOOTSTRAP-RUNBOOK.md).
If this guide and a runbook ever disagree, stop and ask — and fix whichever is wrong.*
