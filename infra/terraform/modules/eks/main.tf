# infra/terraform/modules/eks/main.tf · EKS cluster + managed node group + IRSA OIDC + core addons

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

locals {
  tags = merge(var.tags, { "Module" = "eks" })
}

# ---------- Cluster IAM role ----------
data "aws_iam_policy_document" "cluster_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.name}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "cluster" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
  ])
  role       = aws_iam_role.cluster.name
  policy_arn = each.value
}

# ---------- Control-plane security group ----------
resource "aws_security_group" "cluster" {
  name        = "${var.name}-eks-cluster"
  description = "EKS control plane"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = "${var.name}-eks-cluster" })

  egress {
    description = "all egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------- Cluster ----------
resource "aws_eks_cluster" "this" {
  name     = var.name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    security_group_ids      = [aws_security_group.cluster.id]
    endpoint_private_access = true
    endpoint_public_access  = var.endpoint_public_access
    public_access_cidrs     = var.endpoint_public_access_cidrs
  }

  dynamic "encryption_config" {
    for_each = var.kms_key_arn == "" ? [] : [1]
    content {
      resources = ["secrets"]
      provider {
        key_arn = var.kms_key_arn
      }
    }
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  # PC-56 DEPLOY-1: EKS access entries (API) alongside the aws-auth ConfigMap, so the GitHub deploy role can be granted
  # namespace-scoped access (modules/github-deploy). CONFIG_MAP -> API_AND_CONFIG_MAP is an in-place, one-way update;
  # existing kubeconfig access is unchanged. The cluster creator keeps admin (the API default, stated explicitly).
  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  tags       = local.tags
  depends_on = [aws_iam_role_policy_attachment.cluster]
}

# ---------- IRSA: OIDC provider ----------
data "tls_certificate" "oidc" {
  url = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "this" {
  url             = aws_eks_cluster.this.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]
  tags            = local.tags
}

# ---------- Node IAM role ----------
data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${var.name}-eks-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ])
  role       = aws_iam_role.node.name
  policy_arn = each.value
}

# ---------- Managed node group ----------
resource "aws_eks_node_group" "default" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.name}-default"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnet_ids
  instance_types  = var.node_instance_types
  capacity_type   = var.node_capacity_type
  disk_size       = var.node_disk_gib

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  tags = merge(local.tags, {
    "k8s.io/cluster-autoscaler/enabled"          = "true"
    "k8s.io/cluster-autoscaler/${var.name}"      = "owned"
  })

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [aws_iam_role_policy_attachment.node]
}

# ---------- Core managed addons ----------
resource "aws_eks_addon" "this" {
  for_each = {
    vpc-cni            = "v1.18.1-eksbuild.3"
    coredns            = "v1.11.1-eksbuild.9"
    kube-proxy         = "v1.30.0-eksbuild.3"
    aws-ebs-csi-driver = "v1.32.0-eksbuild.1"
  }
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = each.key
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = local.tags
  depends_on                  = [aws_eks_node_group.default]
}
