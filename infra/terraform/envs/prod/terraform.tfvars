# infra/terraform/envs/prod/terraform.tfvars · PROD values (ap-south-1, lean/minimal tier)
# Edit bucket_suffix + eks_public_access_cidrs before apply.

region        = "ap-south-1"
project       = "krishalaya-prod"
vpc_cidr      = "10.40.0.0/16"
az_count      = 2
bucket_suffix = "REPLACE_WITH_ACCOUNT_ID_OR_ORG"

# SECURITY (fail-closed): replace with your office/VPN CIDR(s), e.g. ["203.0.113.7/32"].
# The placeholder below is an INVALID CIDR on purpose: terraform plan/apply FAILS until you substitute a real
# value, so a forgotten edit can never silently ship a world-open EKS API endpoint. If you truly need a transient
# open bootstrap, set ["0.0.0.0/0"] explicitly and tighten immediately after first connect.
eks_public_access_cidrs = ["REPLACE_WITH_YOUR_IP/32"]

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
