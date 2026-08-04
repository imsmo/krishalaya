# infra/terraform/modules/vpc/variables.tf · network foundation inputs

variable "name" {
  description = "Name prefix for all VPC resources (e.g. krishalaya-prod)."
  type        = string
}

variable "cidr_block" {
  description = "Primary IPv4 CIDR for the VPC."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.cidr_block, 0))
    error_message = "cidr_block must be a valid IPv4 CIDR."
  }
}

variable "az_count" {
  description = "How many AZs to span. Minimum 2 (required by Aurora/ElastiCache subnet groups)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "single_nat_gateway" {
  description = "Cost saver: route ALL private subnets through ONE NAT gateway. true = cheaper, lower egress AZ-fault tolerance."
  type        = bool
  default     = true
}

variable "enable_flow_logs" {
  description = "Capture VPC flow logs to CloudWatch (security/forensics)."
  type        = bool
  default     = true
}

variable "flow_logs_retention_days" {
  description = "CloudWatch retention for VPC flow logs."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
