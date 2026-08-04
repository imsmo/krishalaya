# infra/terraform/modules/waf/variables.tf
variable "name" {
  type        = string
  description = "Name prefix (e.g. krishalaya-prod)."
}
variable "rate_limit_per_5min" {
  type        = number
  description = "Per-IP request cap over a 5-minute window (rate-based rule)."
  default     = 2000
}
variable "tags" {
  type    = map(string)
  default = {}
}
