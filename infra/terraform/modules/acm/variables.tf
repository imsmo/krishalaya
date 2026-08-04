# infra/terraform/modules/acm/variables.tf
variable "root_domain" {
  type        = string
  description = "Apex domain, e.g. krishalaya.com"
}
variable "zone_id" {
  type        = string
  description = "Route 53 hosted zone id for DNS validation."
}
variable "tags" {
  type    = map(string)
  default = {}
}
