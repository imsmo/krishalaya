# infra/terraform/envs/prod/main.tf · PRODUCTION composition (ap-south-1)
# Foundation data-plane: secrets(KMS) -> vpc -> eks -> {aurora, redis, opensearch, s3}.
# Follow-on waves (flagged in P0-1 progress doc): gateway/WAF, MSK, CloudFront, observability, DR, Helm, DNS/TLS.

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
  single_nat_gateway = false # PC-56 DEPLOY-5: one NAT per AZ — with one, losing that AZ cuts every pod off from Razorpay/SMS/eKYC/ECR (~₹3.2k/mo more)
}

# 3) Runtime plane
module "eks" {
  source                       = "../../modules/eks"
  name                         = var.project
  vpc_id                       = module.vpc.vpc_id
  private_subnet_ids           = module.vpc.private_subnet_ids
  endpoint_public_access_cidrs = var.eks_public_access_cidrs
  node_instance_types          = var.eks_node_instance_types
  node_capacity_type           = var.eks_node_capacity_type
  node_desired_size            = var.eks_node_desired
  kms_key_arn                  = module.secrets.kms_key_arn
}

# --- generated datastore credentials, stored in Secrets Manager (never in git/tfvars) ---
resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "random_password" "opensearch_master" {
  length           = 24
  special          = true
  override_special = "!#$%^&*()-_=+"
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name       = "${var.project}/redis/auth_token"
  kms_key_id = module.secrets.kms_key_arn
}
resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

resource "aws_secretsmanager_secret" "opensearch_master" {
  name       = "${var.project}/opensearch/master"
  kms_key_id = module.secrets.kms_key_arn
}
resource "aws_secretsmanager_secret_version" "opensearch_master" {
  secret_id     = aws_secretsmanager_secret.opensearch_master.id
  secret_string = jsonencode({ username = "kv_search_admin", password = random_password.opensearch_master.result })
}

# 4) Data stores (isolated data subnets; reachable only from EKS nodes)
module "aurora" {
  source                     = "../../modules/aurora"
  name                       = var.project
  vpc_id                     = module.vpc.vpc_id
  data_subnet_ids            = module.vpc.data_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_primary_security_group_id]
  kms_key_arn                = module.secrets.kms_key_arn
  min_acu                    = var.aurora_min_acu
  max_acu                    = var.aurora_max_acu
  reader_count               = 1
  backup_retention_days      = 35 # PC-56 DEPLOY-5: the Aurora maximum — a data fault noticed after a week is still recoverable
}

module "redis" {
  source                     = "../../modules/redis"
  name                       = var.project
  vpc_id                     = module.vpc.vpc_id
  data_subnet_ids            = module.vpc.data_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_primary_security_group_id]
  node_type                  = var.redis_node_type
  replicas_per_node_group    = 1
  auth_token                 = random_password.redis_auth.result
  kms_key_arn                = module.secrets.kms_key_arn
}

module "opensearch" {
  source                     = "../../modules/opensearch"
  name                       = var.project
  vpc_id                     = module.vpc.vpc_id
  data_subnet_ids            = module.vpc.data_subnet_ids
  allowed_security_group_ids = [module.eks.cluster_primary_security_group_id]
  instance_type              = var.opensearch_instance_type
  instance_count             = 2
  master_user_password       = random_password.opensearch_master.result
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

# 5b) PC-56 DEPLOY-1 · the role GitHub Actions deploys as (OIDC, no stored AWS keys). Trusted only for jobs running in
#     the GitHub Environment "production" of var.github_repository; ECR push to krishalaya-*, describe this cluster, and
#     Kubernetes "edit" in the krishalaya namespace only. Output github_deploy_role_arn → GitHub Environment variable
#     AWS_DEPLOY_ROLE_ARN (see .github/workflows/deploy-prod.yml).
module "github_deploy" {
  source               = "../../modules/github-deploy"
  name                 = var.project
  github_repository    = var.github_repository
  github_environment   = "production"
  create_oidc_provider = var.create_github_oidc_provider
  cluster_name         = module.eks.cluster_name
  cluster_arn          = module.eks.cluster_arn
  namespace            = "krishalaya"
}

# 6) EDGE — DNS zone, wildcard TLS, WAF, and IAM for the ALB controller + external-dns.
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
