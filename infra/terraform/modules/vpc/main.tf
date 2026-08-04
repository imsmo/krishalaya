# infra/terraform/modules/vpc/main.tf · VPC, subnets (public/private/data), NAT, IGW, endpoints, flow logs
#
# Layout per AZ:
#   public  subnet  -> IGW            (ALB, NAT)
#   private subnet  -> NAT (egress)   (EKS nodes, app pods)
#   data    subnet  -> NO internet    (Aurora, ElastiCache, OpenSearch) — isolated by design
#
# Subnet CIDR carving (relative to a /16): three /20 tiers x up to 3 AZs.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # newbits=4 -> /20 subnets from a /16. netnum offsets keep tiers non-overlapping.
  public_subnets  = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 4, i)]
  private_subnets = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 4, i + 4)]
  data_subnets    = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 4, i + 8)]

  nat_count = var.single_nat_gateway ? 1 : var.az_count

  tags = merge(var.tags, { "Module" = "vpc" })
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-igw" })
}

# ---------- Subnets ----------
resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false
  tags = merge(local.tags, {
    Name                     = "${var.name}-public-${local.azs[count.index]}"
    Tier                     = "public"
    "kubernetes.io/role/elb" = "1"
  })
}

resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]
  tags = merge(local.tags, {
    Name                              = "${var.name}-private-${local.azs[count.index]}"
    Tier                              = "private"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

resource "aws_subnet" "data" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.data_subnets[count.index]
  availability_zone = local.azs[count.index]
  tags = merge(local.tags, {
    Name = "${var.name}-data-${local.azs[count.index]}"
    Tier = "data"
  })
}

# ---------- NAT ----------
resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name}-nat-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(local.tags, { Name = "${var.name}-nat-${count.index}" })
  depends_on    = [aws_internet_gateway.this]
}

# ---------- Route tables ----------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = var.az_count
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-private-${count.index}" })
}

resource "aws_route" "private_nat" {
  count                  = var.az_count
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  # single NAT -> all private RTs point at nat[0]; per-AZ NAT -> matching index
  nat_gateway_id = var.single_nat_gateway ? aws_nat_gateway.this[0].id : aws_nat_gateway.this[count.index].id
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# data subnets: isolated route table, NO 0.0.0.0/0 route
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-data" })
}

resource "aws_route_table_association" "data" {
  count          = var.az_count
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

# ---------- S3 gateway endpoint (free; keeps S3 traffic off NAT) ----------
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.private[*].id, [aws_route_table.data.id])
  tags              = merge(local.tags, { Name = "${var.name}-s3-endpoint" })
}

data "aws_region" "current" {}

# ---------- VPC flow logs ----------
resource "aws_cloudwatch_log_group" "flow" {
  count             = var.enable_flow_logs ? 1 : 0
  name              = "/krishalaya/${var.name}/vpc-flow-logs"
  retention_in_days = var.flow_logs_retention_days
  tags              = local.tags
}

data "aws_iam_policy_document" "flow_assume" {
  count = var.enable_flow_logs ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow" {
  count              = var.enable_flow_logs ? 1 : 0
  name               = "${var.name}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_assume[0].json
  tags               = local.tags
}

data "aws_iam_policy_document" "flow_perms" {
  count = var.enable_flow_logs ? 1 : 0
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.flow[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow" {
  count  = var.enable_flow_logs ? 1 : 0
  name   = "${var.name}-vpc-flow-logs"
  role   = aws_iam_role.flow[0].id
  policy = data.aws_iam_policy_document.flow_perms[0].json
}

resource "aws_flow_log" "this" {
  count                = var.enable_flow_logs ? 1 : 0
  log_destination      = aws_cloudwatch_log_group.flow[0].arn
  iam_role_arn         = aws_iam_role.flow[0].arn
  traffic_type         = "ALL"
  vpc_id               = aws_vpc.this.id
  max_aggregation_interval = 600
  tags                 = local.tags
}
