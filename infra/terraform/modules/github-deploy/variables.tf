# infra/terraform/modules/github-deploy/variables.tf

variable "name" {
  description = "Name prefix (the env's project name, e.g. krishalaya-staging)."
  type        = string
}

variable "github_repository" {
  description = "owner/repo whose Actions may deploy, e.g. imsmo/krishalaya."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be owner/repo."
  }
}

variable "github_environment" {
  description = "The GitHub Environment a job must run in to assume this role (staging | production)."
  type        = string
}

variable "create_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider. Set false in the second env if both share one AWS account."
  type        = bool
  default     = true
}

variable "cluster_name" {
  description = "EKS cluster the role deploys to."
  type        = string
}

variable "cluster_arn" {
  description = "ARN of that cluster (eks:DescribeCluster scope)."
  type        = string
}

variable "namespace" {
  description = "The only Kubernetes namespace the role may edit."
  type        = string
  default     = "krishalaya"
}

variable "tags" {
  type    = map(string)
  default = {}
}
