# infra/terraform/modules/github-deploy/main.tf · PC-56 DEPLOY-1
# The identity GitHub Actions deploys as: OIDC federation (no long-lived AWS keys in GitHub), one IAM role per
# environment, trusted ONLY for jobs that run in the named GitHub Environment of this repository — so the production
# role can be assumed only by a job that passed the `production` environment's required reviewers.
# Least privilege: push images to the krishalaya-* ECR repos, describe this one cluster, and Kubernetes "edit" inside
# the app namespace only (EKS access entry; no cluster-admin, no other namespace).

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
  tags         = merge(var.tags, { "Module" = "github-deploy" })
  oidc_url     = "token.actions.githubusercontent.com"
  provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# One GitHub OIDC provider per AWS ACCOUNT. If staging and prod share an account, create it in one env and set
# create_oidc_provider = false in the other (it is then looked up).
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://${local.oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's OIDC TLS chain itself; the thumbprint is required by the API but not used for GitHub.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = local.tags
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://${local.oidc_url}"
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    # The job must run in THIS repository AND in THIS GitHub Environment (not merely on a branch).
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
  tags                 = local.tags
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # this action has no resource-level scope
  }
  statement {
    sid = "EcrPushKrishalayaRepos"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
      "ecr:DescribeRepositories", "ecr:CreateRepository", "ecr:DescribeImages",
    ]
    resources = ["arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/krishalaya-*"]
  }
  statement {
    sid       = "DescribeThisCluster"
    actions   = ["eks:DescribeCluster"]
    resources = [var.cluster_arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# Kubernetes access: "edit" in the app namespace only (Deployments, Services, HPAs, PDBs, ServiceAccounts, Ingresses
# and Helm's release Secrets — everything the charts create). Needs the cluster's authentication_mode to include API.
resource "aws_eks_access_entry" "deploy" {
  cluster_name  = var.cluster_name
  principal_arn = aws_iam_role.deploy.arn
  type          = "STANDARD"
  tags          = local.tags
}

resource "aws_eks_access_policy_association" "deploy" {
  cluster_name  = var.cluster_name
  principal_arn = aws_iam_role.deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"
  access_scope {
    type       = "namespace"
    namespaces = [var.namespace]
  }
  depends_on = [aws_eks_access_entry.deploy]
}
