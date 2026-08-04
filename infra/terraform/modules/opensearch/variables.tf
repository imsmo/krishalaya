# infra/terraform/modules/opensearch/variables.tf · OpenSearch 2 domain inputs

variable "name" {
  type        = string
  description = "Name prefix (e.g. krishalaya-prod)."
}

variable "vpc_id" {
  type = string
}

variable "data_subnet_ids" {
  description = "Isolated data subnets. Provide as many as instance_count (max 3)."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "SGs allowed on 443 (e.g. EKS node SG)."
  type        = list(string)
  default     = []
}

variable "engine_version" {
  type    = string
  default = "OpenSearch_2.13"
}

variable "instance_type" {
  description = "Data node type. Lean default = t3.small.search."
  type        = string
  default     = "t3.small.search"
}

variable "instance_count" {
  description = "Data node count. 2 = minimal HA across 2 AZs."
  type        = number
  default     = 2
}

variable "volume_gib" {
  type    = number
  default = 20
}

variable "kms_key_arn" {
  description = "KMS key for at-rest encryption."
  type        = string
}

variable "master_user_name" {
  description = "Fine-grained-access master user (stored in Secrets Manager by the env)."
  type        = string
  default     = "kv_search_admin"
}

variable "master_user_password" {
  description = "Master user password (>=8 chars, upper/lower/digit/symbol)."
  type        = string
  sensitive   = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
