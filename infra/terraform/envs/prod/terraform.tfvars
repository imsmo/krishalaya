# infra/terraform/envs/prod/terraform.tfvars · PROD values (ap-south-1, lean/minimal tier)
# Edit bucket_suffix + eks_public_access_cidrs before apply.

region        = "ap-south-1"
project       = "krishalaya-prod"
vpc_cidr      = "10.40.0.0/16"
az_count      = 2
bucket_suffix = "REPLACE_WITH_ACCOUNT_ID_OR_ORG"

# SECURITY: replace with your office/VPN CIDR(s). 0.0.0.0/0 is only acceptable transiently for first bootstrap.
eks_public_access_cidrs = ["0.0.0.0/0"]

# lean sizing — raise these to scale up later (no rewrite)
eks_node_instance_types  = ["t3.large"]
eks_node_capacity_type   = "SPOT"
eks_node_desired         = 2
aurora_min_acu           = 0.5
aurora_max_acu           = 4
redis_node_type          = "cache.t4g.micro"
opensearch_instance_type = "t3.small.search"

# edge
root_domain = "krishalaya.com"
