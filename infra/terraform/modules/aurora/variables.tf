# infra/terraform/modules/aurora/variables.tf · Aurora PostgreSQL 16 (Serverless v2) inputs

variable "name" {
  description = "Cluster name prefix (e.g. krishalaya-prod)."
  type        = string
}

variable "vpc_id" {
  type        = string
  description = "VPC id."
}

variable "data_subnet_ids" {
  description = "Isolated data subnets for the DB subnet group (>= 2 AZs)."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security groups allowed to connect on 5432 (e.g. the EKS node SG)."
  type        = list(string)
  default     = []
}

variable "database_name" {
  type    = string
  default = "krishalaya"
}

variable "master_username" {
  type    = string
  default = "kv_owner"
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version (16.x)."
  type        = string
  default     = "16.4"
}

variable "min_acu" {
  description = "Serverless v2 minimum Aurora Capacity Units. 0.5 = cheapest floor."
  type        = number
  default     = 0.5
}

variable "max_acu" {
  description = "Serverless v2 maximum ACU (autoscaling ceiling)."
  type        = number
  default     = 4
}

variable "reader_count" {
  description = "Number of reader instances (the read replica). 1 = HA + CQRS read endpoint."
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  description = "Automated backup retention = PITR window (days). Min 7 for production."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 7
    error_message = "Production PITR retention must be >= 7 days."
  }
}

variable "kms_key_arn" {
  description = "KMS key ARN for storage + master-secret encryption (from the secrets module)."
  type        = string
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "statement_timeout_ms" {
  description = "Per-statement timeout (ms) enforced at the DB (contract: short statement_timeout)."
  type        = number
  default     = 15000
}

variable "lock_timeout_ms" {
  description = "Lock acquisition timeout (ms)."
  type        = number
  default     = 5000
}

variable "tags" {
  type    = map(string)
  default = {}
}
