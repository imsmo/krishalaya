# infra/terraform/modules/redis/variables.tf · ElastiCache Redis 7 inputs

variable "name" {
  type        = string
  description = "Name prefix (e.g. krishalaya-prod)."
}

variable "vpc_id" {
  type = string
}

variable "data_subnet_ids" {
  description = "Isolated data subnets for the cache subnet group."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "SGs allowed on 6379 (e.g. EKS node SG)."
  type        = list(string)
  default     = []
}

variable "node_type" {
  description = "Cache node type. Lean default = cache.t4g.micro."
  type        = string
  default     = "cache.t4g.micro"
}

variable "replicas_per_node_group" {
  description = "Read replicas per shard. 1 = HA (primary + replica) with automatic failover. 0 = cheapest, no failover."
  type        = number
  default     = 1
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "auth_token" {
  description = "AUTH token (>=16 chars) for in-transit-encrypted Redis. Generate in the env and store in Secrets Manager."
  type        = string
  sensitive   = true
}

variable "kms_key_arn" {
  description = "KMS key for at-rest encryption."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
