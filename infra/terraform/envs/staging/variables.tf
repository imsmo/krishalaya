# infra/terraform/envs/staging/variables.tf
#
# Mirrors envs/prod/variables.tf's shape exactly, plus a handful of NEW variables that prod's main.tf hardcodes
# inline instead of exposing (aurora reader_count/deletion_protection, redis replicas, eks node ceiling). Those
# module-level variables already exist (infra/terraform/modules/{aurora,redis,eks}/variables.tf) — prod's
# composition simply never wired them because prod wants the HA defaults. Staging wires them explicitly so the
# PILOT sizing decision is visible here, not buried in module defaults.

variable "region" {
  type    = string
  default = "ap-south-1" # Mumbai — DPDP data residency (same as prod)
}

variable "project" {
  type    = string
  default = "krishalaya-staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16" # distinct /16 from prod's 10.40.0.0/16 — keeps future VPC peering (e.g. a data-refresh
  # job pulling anonymised prod data into staging) collision-free.
}

variable "az_count" {
  type    = number
  default = 2 # module minimum (Aurora/ElastiCache subnet groups require >=2 AZs) — no reason to pay for a 3rd at pilot
}

variable "bucket_suffix" {
  description = "Globally-unique S3 suffix (your account id or org slug) — same value as prod's, buckets are namespaced by project name too."
  type        = string
}

variable "eks_public_access_cidrs" {
  description = "CIDRs allowed to reach the K8s API. TIGHTEN to your office/VPN — do not ship 0.0.0.0/0."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# --- PILOT sizing (override to scale up later — same variables prod uses at larger values) ---
variable "eks_node_instance_types" {
  type    = list(string)
  default = ["t3.medium"] # 2 vCPU / 4 GiB — half of prod's t3.large; matches Master Plan §5.1 pilot shape
}
variable "eks_node_capacity_type" {
  type    = string
  default = "SPOT" # same as prod — stateless app pods tolerate interruption
}
variable "eks_node_desired" {
  type    = number
  default = 2 # 2-node pilot cluster per founder decision
}
variable "eks_node_max_size" {
  description = "Autoscaler ceiling. Module default is 5 (prod's implicit value) — cap lower at pilot so a runaway HPA can't blow the cost ceiling."
  type        = number
  default     = 3
}

variable "aurora_min_acu" {
  type    = number
  default = 0.5
}
variable "aurora_max_acu" {
  type    = number
  default = 2 # founder decision: 0.5-2 ACU at pilot (prod default is 4)
}
variable "aurora_reader_count" {
  description = "Reader/replica instances. Module default is 1 (prod hardcodes 1 for HA+CQRS reads). Pilot: 0 — single instance, no reader endpoint cost, accept the documented single-AZ DR gap (Master Plan §5 risk #10)."
  type        = number
  default     = 0
}
variable "aurora_deletion_protection" {
  description = "Module default true (prod hardcodes true). Pilot: false, so the founder can destroy/rebuild staging freely while iterating before the pilot goes live on it. Flip to true once real pilot data lands here."
  type        = bool
  default     = false
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro" # smallest ElastiCache node — same as prod's lean tier already
}
variable "redis_replicas_per_node_group" {
  description = "Module default is 1 (prod hardcodes 1 for HA/failover). Pilot: 0 — single node, no replica, cheapest; matches founder decision 'single Redis'."
  type        = number
  default     = 0
}

variable "root_domain" {
  type        = string
  description = "Staging apex — a delegated SUBDOMAIN of the prod apex, not its own registrar-level domain. Gets its own Route 53 hosted zone (module.dns), NS-delegated from inside the prod krishalaya.com zone (see runbook step on DNS delegation)."
  default     = "staging.krishalaya.com"
}
