# infra/terraform/envs/prod/variables.tf

variable "region" {
  type    = string
  default = "ap-south-1" # Mumbai — DPDP data residency
}

variable "project" {
  type    = string
  default = "krishalaya-prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "az_count" {
  type    = number
  default = 2
}

variable "bucket_suffix" {
  description = "Globally-unique S3 suffix (your account id or org slug)."
  type        = string
}

variable "eks_public_access_cidrs" {
  description = "CIDRs allowed to reach the K8s API. TIGHTEN to your office/VPN — do not ship 0.0.0.0/0."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# --- lean/minimal sizing (override to scale up) ---
variable "eks_node_instance_types" {
  type    = list(string)
  default = ["t3.large"]
}
variable "eks_node_capacity_type" {
  type    = string
  default = "SPOT"
}
variable "eks_node_desired" {
  type    = number
  default = 2
}
variable "aurora_min_acu" {
  type    = number
  default = 0.5
}
variable "aurora_max_acu" {
  type    = number
  default = 4
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}
variable "opensearch_instance_type" {
  type    = string
  default = "t3.small.search"
}

variable "root_domain" {
  type        = string
  description = "Apex production domain."
  default     = "krishalaya.com"
}

# PC-56 DEPLOY-1 · GitHub Actions deploy identity (modules/github-deploy)
variable "github_repository" {
  description = "owner/repo whose GitHub Actions may deploy to this environment."
  type        = string
  default     = "imsmo/krishalaya"
}
variable "create_github_oidc_provider" {
  description = "The GitHub OIDC provider is one per AWS ACCOUNT. If staging and prod share an account, keep true in the env applied first and set false in the other."
  type        = bool
  default     = true
}
