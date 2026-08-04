# infra/terraform/modules/s3-cdn/variables.tf · media + logs buckets
# NOTE: CloudFront distribution lives in modules/cdn (deferred follow-on wave). This module owns the buckets.

variable "name" {
  type        = string
  description = "Name prefix (e.g. krishalaya-prod)."
}

variable "bucket_suffix" {
  description = "Globally-unique suffix (S3 bucket names are global). Use your account id or org slug."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key for SSE-KMS encryption of objects."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origins allowed to PUT via presigned URLs (your web app domains). Tighten in prod."
  type        = list(string)
  default     = ["*"]
}

variable "noncurrent_version_expiration_days" {
  type    = number
  default = 90
}

variable "tags" {
  type    = map(string)
  default = {}
}
