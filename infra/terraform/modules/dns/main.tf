# infra/terraform/modules/dns/main.tf · Route 53 public hosted zone.
# After apply, set the 4 name servers (output) at your domain registrar to delegate DNS to AWS.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}
resource "aws_route53_zone" "this" {
  name          = var.root_domain
  comment       = "Krishalaya production zone"
  force_destroy = false
  tags          = merge(var.tags, { Module = "dns" })
}
