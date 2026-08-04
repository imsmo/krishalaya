# infra/terraform/modules/opensearch/main.tf · OpenSearch 2 in-VPC, encrypted, TLS, fine-grained access

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

locals {
  tags        = merge(var.tags, { "Module" = "opensearch" })
  multi_az    = var.instance_count >= 2
  subnet_ids  = slice(var.data_subnet_ids, 0, min(var.instance_count, length(var.data_subnet_ids)))
}

resource "aws_security_group" "this" {
  name        = "${var.name}-opensearch"
  description = "OpenSearch HTTPS access"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = "${var.name}-opensearch" })
}

resource "aws_security_group_rule" "ingress" {
  count                    = length(var.allowed_security_group_ids)
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.this.id
  source_security_group_id = var.allowed_security_group_ids[count.index]
  description              = "HTTPS from allowed SG"
}

resource "aws_security_group_rule" "egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.this.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_opensearch_domain" "this" {
  domain_name    = "${var.name}-search"
  engine_version = var.engine_version

  cluster_config {
    instance_type          = var.instance_type
    instance_count         = var.instance_count
    zone_awareness_enabled = local.multi_az

    dynamic "zone_awareness_config" {
      for_each = local.multi_az ? [1] : []
      content {
        availability_zone_count = min(var.instance_count, 2)
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.volume_gib
  }

  vpc_options {
    subnet_ids         = local.subnet_ids
    security_group_ids = [aws_security_group.this.id]
  }

  encrypt_at_rest {
    enabled    = true
    kms_key_id = var.kms_key_arn
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = var.master_user_name
      master_user_password = var.master_user_password
    }
  }

  # Domain-level access policy: allow within VPC (network isolation + fine-grained auth do the real gating).
  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "*" }
      Action    = "es:*"
      Resource  = "arn:aws:es:*:*:domain/${var.name}-search/*"
    }]
  })

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.os.arn
    log_type                 = "ES_APPLICATION_LOGS"
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "os" {
  name              = "/krishalaya/${var.name}/opensearch"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_cloudwatch_log_resource_policy" "os" {
  policy_name = "${var.name}-opensearch-logs"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "es.amazonaws.com" }
      Action    = ["logs:PutLogEvents", "logs:CreateLogStream"]
      Resource  = "${aws_cloudwatch_log_group.os.arn}:*"
    }]
  })
}
