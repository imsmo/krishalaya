# infra/terraform/envs/staging/terraform.tfvars · STAGING/PILOT values (ap-south-1)
#
# This IS the "PILOT tfvars" for Sprint S1 (Master Plan §5, founder decision: pilot infra <₹25k/mo (~$280/mo),
# scale-ready — not throwaway, staging applied before prod). Every override below is commented with WHY and its
# monthly cost contribution. See S1_STAGING_APPLY_RUNBOOK.md for the full apply sequence.
#
# Edit bucket_suffix + eks_public_access_cidrs before apply (same two placeholders as prod).

region        = "ap-south-1"      # Mumbai — DPDP data residency (unchanged from prod)
project       = "krishalaya-staging"
vpc_cidr      = "10.50.0.0/16"    # distinct /16 from prod (10.40.0.0/16) — no future peering collision
az_count      = 2                 # module minimum; a 3rd AZ buys nothing at pilot node counts
bucket_suffix = "REPLACE_WITH_ACCOUNT_ID_OR_ORG"

# SECURITY (fail-closed): replace with your public IP, e.g. ["203.0.113.7/32"] — see https://checkip.amazonaws.com
# The placeholder below is an INVALID CIDR on purpose: terraform plan/apply FAILS until you substitute a real
# value, so a forgotten edit can never silently ship a world-open EKS API endpoint. If you truly need a transient
# open bootstrap, set ["0.0.0.0/0"] explicitly and tighten immediately after first connect.
eks_public_access_cidrs = ["REPLACE_WITH_YOUR_IP/32"]

# ---------------------------------------------------------------------------------------------------------------
# PILOT sizing — every line below is a deliberate down-size from envs/prod/terraform.tfvars. Raise these later
# (no rewrite) when the pilot outgrows this shape. Approx costs are per Master Plan §5.1's ₹/month table (~₹83/USD).
# ---------------------------------------------------------------------------------------------------------------

# EKS — 2 small nodes instead of prod's 2× t3.large. t3.medium (2 vCPU/4GiB, x86_64) chosen over the cheaper
# Graviton t4g.medium because infra/docker/build-and-push.sh does not pin --platform: it builds whatever
# architecture the founder's build machine is. Mismatched image/node arch = ImagePullBackOff/"exec format error"
# at pilot with only one operator to debug it. Revisit t4g once build-and-push.sh is confirmed to emit arm64
# (or multi-arch via buildx) — that swap alone saves ~20% of the node line below.
#   Cost: EKS control plane ~₹6,000/mo (fixed, same as prod) + 2× t3.medium SPOT ~₹2,700/mo  ≈ ₹8,700/mo
eks_node_instance_types = ["t3.medium"]
eks_node_capacity_type  = "SPOT"
eks_node_desired        = 2
eks_node_max_size       = 3   # autoscaler ceiling — caps a runaway HPA from silently blowing the cost ceiling

# Aurora Serverless v2 — 0.5-2 ACU (prod runs 0.5-4), single writer instance, no reader, deletion_protection off
# (staging must be destroyable while you iterate; flip true once real pilot traffic depends on this data).
#   Cost: ~₹4,500/mo at avg ~0.75 ACU (scales toward the 0.5 floor overnight/low-traffic)
aurora_min_acu             = 0.5
aurora_max_acu             = 2
aurora_reader_count        = 0     # no CQRS read replica at pilot — accept single-AZ read path (Master Plan §5 risk #10)
aurora_deletion_protection = false

# Redis — single node, no replica (prod runs replicas_per_node_group=1 for HA/failover).
#   Cost: cache.t4g.micro single node ~₹1,200/mo
redis_node_type               = "cache.t4g.micro"
redis_replicas_per_node_group = 0

# OpenSearch — INTENTIONALLY ABSENT. There is no variable here because modules/opensearch has no enable/disable
# flag and this file's module composition (main.tf) never calls the module at all — see main.tf's header note.
# Founder decision: search is SQL at pilot scale (unified_search flag OFF, verified S0), so this isn't a sizing
# choice, it's a module that plainly is not invoked. Saves the ~₹15,000+/mo a 2-node t3.small.search domain would
# add — the single largest line item this file avoids.

# Kafka/MSK — also absent for the same reason (stream-processor is GA-only per founder decision); modules/msk is
# never referenced by main.tf, matching prod's own composition (prod doesn't wire it either).

# S3 — module defaults as-is (no override needed; negligible cost at pilot volume, ~₹500/mo incl. transfer).

# Route 53 + ACM + WAF — ON, same as prod (founder decision: prove the exact edge path prod will use).
#   Cost: hosted zone ~₹350/mo + WAF web ACL + rules ~₹700/mo ≈ ₹1,050/mo (ACM certs are free)
root_domain = "staging.krishalaya.com"

# ---------------------------------------------------------------------------------------------------------------
# NOT overridden (module defaults kept, all effectively free or already lean):
#   - single_nat_gateway = true (hardcoded in main.tf, same as prod)          -> ~₹3,200/mo (NAT is the first
#     thing to cut further per Master Plan §5.1 if margin is needed — e.g. public subnets + SG-only for pilot)
#   - node_disk_gib = 40 (module default)                                     -> negligible (gp3 EBS)
#   - engine_version / kubernetes_version (module defaults, PG16 / 1.30)      -> no cost impact
# ---------------------------------------------------------------------------------------------------------------
