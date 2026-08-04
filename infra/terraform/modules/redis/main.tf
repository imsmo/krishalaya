# infra/terraform/modules/redis/main.tf · ElastiCache Redis 7, encrypted in-transit + at-rest, AUTH, private

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
  tags          = merge(var.tags, { "Module" = "redis" })
  ha            = var.replicas_per_node_group > 0
  cluster_nodes = 1 + var.replicas_per_node_group
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.data_subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "this" {
  name        = "${var.name}-redis"
  description = "ElastiCache Redis access"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = "${var.name}-redis" })
}

resource "aws_security_group_rule" "ingress" {
  count                    = length(var.allowed_security_group_ids)
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.this.id
  source_security_group_id = var.allowed_security_group_ids[count.index]
  description              = "Redis from allowed SG"
}

resource "aws_security_group_rule" "egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.this.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name}-redis"
  description          = "Krishalaya cache / rate-limits / OTP store / realtime bus"
  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  port                 = 6379

  num_cache_clusters         = local.cluster_nodes
  automatic_failover_enabled = local.ha
  multi_az_enabled           = local.ha

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  auth_token                 = var.auth_token

  snapshot_retention_limit = 7
  snapshot_window          = "19:30-20:30"
  maintenance_window       = "tue:20:30-tue:21:30"
  apply_immediately        = false

  tags = local.tags
}
