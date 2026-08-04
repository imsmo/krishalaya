# infra/terraform/modules/eks/variables.tf · runtime plane inputs

variable "name" {
  description = "Cluster name prefix (e.g. krishalaya-prod)."
  type        = string
}

variable "kubernetes_version" {
  description = "EKS control-plane version."
  type        = string
  default     = "1.30"
}

variable "vpc_id" {
  description = "VPC id from the vpc module."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the control plane ENIs and worker nodes."
  type        = list(string)
}

variable "endpoint_public_access" {
  description = "Expose the Kubernetes API publicly (restricted by endpoint_public_access_cidrs). Convenient for kubectl from your laptop; set false once you have a bastion/VPN."
  type        = bool
  default     = true
}

variable "endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the public API endpoint. TIGHTEN THIS to your office/VPN IP — never leave 0.0.0.0/0 in real production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  description = "Worker instance types. Lean default = t3.large (2 vCPU / 8 GiB)."
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT. SPOT is cheaper but interruptible — fine for stateless app pods at the lean tier."
  type        = string
  default     = "SPOT"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.node_capacity_type)
    error_message = "node_capacity_type must be ON_DEMAND or SPOT."
  }
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 5
}

variable "node_disk_gib" {
  type    = number
  default = 40
}

variable "kms_key_arn" {
  description = "Optional KMS key ARN for envelope-encrypting Kubernetes secrets. Empty = use EKS-managed encryption."
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
