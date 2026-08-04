# infra/terraform/envs/staging/main.tf · STAGING/PILOT composition (ap-south-1)
# Same modules as envs/prod/main.tf, PILOT-sized, with OpenSearch intentionally NOT instantiated (see note below).
# Foundation data-plane: secrets(KMS) -> vpc -> eks -> {aurora, redis, media}. Edge: dns/acm/waf/alb-edge-iam.
#
# *** OpenSearch: deliberately omitted, not disabled ***
# infra/terraform/modules/opensearch has NO enable/disable variable — it always creates a 2-node domain if
# instantiated (see modules/opensearch/variables.tf: instance_count default 2, no `count`/`enabled` flag). Rather
# than add a flag to the module (this file is the environment COMPOSITION layer, not module code — the correct
# place for an env to opt out of a module is simply not calling it), staging's main.tf never declares
# `module "opensearch" {...}`. This matches the founder decision (Master Plan §5.1: "Skip OpenSearch at pilot —
# unified_search flag OFF, NullSearchClient fallback already handles this per P1-14") and the module's own
# comment that OPENSEARCH_URL is optional in app-config (only validated *if* set).
# If a future GA wave needs it: copy the module block from envs/prod/main.tf verbatim (kms_key_arn, subnet ids,
# and the two generated-secret resources it needs already exist in this file's pattern below) — that is additive,
# not a rewrite.

# 1) Secrets + KMS first (everything encrypts with this CMK)
module "secrets" {
  source = "../../modules/secrets"
  name   = var.project
}

# 2) Network
module "vpc" {
  source             = "../../modules/vpc"
  name               = var.project
  cidr_block         = var.vpc_cidr
  az_count           = var.az_count
  single_nat_gateway = true # lean: one NAT (same trade-off as prod)
}

# 3) Runtime plane — pilot sizing (2 nodes, smaller instance, lower autoscale ceiling)
module "eks" {
  source                       = "../../modules/eks"
  name                         = var.project
  vpc_id                       = module.vpc.vpc_id
  private_subnet_ids           = module.vpc.private_subnet_ids
  endpoint_public_access_cidrs = var.eks_public_access_cidrs
  node_instance_types          = var.eks_node_instance_types
  node_capacity_type           = var.eks_node_capacity_type
  node_desired_size            = var.eks_node_desired
  node_max_size                = var.eks_node_max_size # wired here; prod leaves this at the module default (5)
  kms_key_arn                  = module.secrets.kms_key_arn
}

# --- generated datastore credentials, stored in Secrets Manager (never in git/tfvars) ---
# NOTE: no opensearch_master password here — OpenSearch is not instantiated at pilot (see header note).
resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name       = "${var.project}/redis/auth_token"
  kms_key_id = module.secrets.kms_key_arn
}
resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

# 4) Data stores (isolated data subnets; reachable only from EKS nodes) — pilot sizing
module "aurora" {
  source                     = "../../modules/aurora"
  name                       = var.project
  vpc_id                     = module.vpc.vpc_id
  data_subnet_ids            = module.vpc.data_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_primary_security_group_id]
  kms_key_arn                = module.secrets.kms_key_arn
  min_acu                    = var.aurora_min_acu
  max_acu                    = var.aurora_max_acu
  reader_count               = var.aurora_reader_count      # 0 at pilot — single instance, no CQRS reader cost
  backup_retention_days      = 7                            # PITR floor — module validation requires >= 7, keep even at pilot
  deletion_protection        = var.aurora_deletion_protection # false at pilot — allow destroy/rebuild while iterating
}

module "redis" {
  source                     = "../../modules/redis"
  name                       = var.project
  vpc_id                     = module.vpc.vpc_id
  data_subnet_ids            = module.vpc.data_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_primary_security_group_id]
  node_type                  = var.redis_node_type
  replicas_per_node_group    = var.redis_replicas_per_node_group # 0 at pilot — single node, no failover
  auth_token                 = random_password.redis_auth.result
  kms_key_arn                = module.secrets.kms_key_arn
}

module "media" {
  source        = "../../modules/s3-cdn"
  name          = var.project
  bucket_suffix = var.bucket_suffix
  kms_key_arn   = module.secrets.kms_key_arn
}

# 5) IRSA — per-app IAM roles assumed by EKS service accounts (no static keys)
data "aws_caller_identity" "current" {}

module "irsa" {
  source             = "../../modules/irsa"
  name               = var.project
  oidc_provider_arn  = module.eks.oidc_provider_arn
  oidc_provider_url  = module.eks.oidc_provider_url
  namespace          = "krishalaya"
  kms_key_arn        = module.secrets.kms_key_arn
  secrets_arn_prefix = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.project}/*"
  media_bucket_arn   = module.media.media_bucket_arn
}

# 6) EDGE — DNS zone for the staging.krishalaya.com SUBDOMAIN (its own Route 53 zone, NS-delegated at the
#    registrar or inside the prod zone once it exists — see S1_STAGING_APPLY_RUNBOOK.md §5), wildcard TLS, WAF,
#    and IAM for the ALB controller + external-dns. Founder decision: WAF/ACM/Route53 ON at pilot (cheap, and
#    staging should prove the exact same edge path prod will use).
module "dns" {
  source      = "../../modules/dns"
  root_domain = var.root_domain
}

module "acm" {
  source      = "../../modules/acm"
  root_domain = var.root_domain
  zone_id     = module.dns.zone_id
}

module "waf" {
  source = "../../modules/waf"
  name   = var.project
}

module "alb_edge_iam" {
  source            = "../../modules/alb-edge-iam"
  name              = var.project
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  hosted_zone_arn   = "arn:aws:route53:::hostedzone/${module.dns.zone_id}"
}
