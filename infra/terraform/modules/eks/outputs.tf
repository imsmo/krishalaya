# infra/terraform/modules/eks/outputs.tf

output "cluster_name" {
  value       = aws_eks_cluster.this.name
  description = "EKS cluster name (use with: aws eks update-kubeconfig)."
}

output "cluster_endpoint" {
  value       = aws_eks_cluster.this.endpoint
  description = "Kubernetes API endpoint."
}

output "cluster_ca_data" {
  value       = aws_eks_cluster.this.certificate_authority[0].data
  description = "Base64 cluster CA."
  sensitive   = true
}

output "cluster_security_group_id" {
  value       = aws_security_group.cluster.id
  description = "Control-plane SG (allow data-store SGs to accept from this / from node SG)."
}

output "node_role_arn" {
  value       = aws_iam_role.node.arn
  description = "Worker node IAM role ARN."
}

output "oidc_provider_arn" {
  value       = aws_iam_openid_connect_provider.this.arn
  description = "IRSA OIDC provider ARN (for service-account IAM roles)."
}

output "oidc_provider_url" {
  value       = aws_iam_openid_connect_provider.this.url
  description = "IRSA OIDC issuer URL."
}

output "cluster_primary_security_group_id" {
  description = "EKS-managed primary SG attached to managed nodes; allow this on Aurora/Redis/OpenSearch ingress."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "cluster_arn" {
  description = "Cluster ARN (scope for eks:DescribeCluster grants, e.g. the GitHub deploy role)."
  value       = aws_eks_cluster.this.arn
}

output "cluster_autoscaler_role_arn" {
  description = "IRSA role for kube-system/cluster-autoscaler (PC-56 DEPLOY-3)."
  value       = aws_iam_role.cluster_autoscaler.arn
}
