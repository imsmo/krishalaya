# infra/terraform/modules/waf/main.tf · WAFv2 REGIONAL web ACL for the ALB.
# Layers: AWS managed common + known-bad-inputs + SQLi + IP-reputation, plus a per-IP rate limit.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

locals {
  tags = merge(var.tags, { Module = "waf" })
  managed_groups = {
    common          = "AWSManagedRulesCommonRuleSet"
    known_bad       = "AWSManagedRulesKnownBadInputsRuleSet"
    sqli            = "AWSManagedRulesSQLiRuleSet"
    ip_reputation   = "AWSManagedRulesAmazonIpReputationList"
  }
}

resource "aws_wafv2_web_acl" "this" {
  name        = "${var.name}-edge"
  description = "Krishalaya edge WAF (ALB)"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # AWS managed rule groups
  dynamic "rule" {
    for_each = local.managed_groups
    content {
      name     = rule.key
      priority = index(keys(local.managed_groups), rule.key) + 1
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  # Per-IP rate limit (blocks abusive sources)
  rule {
    name     = "rate-limit"
    priority = 100
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-edge"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}
