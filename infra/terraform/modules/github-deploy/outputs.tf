# infra/terraform/modules/github-deploy/outputs.tf

output "role_arn" {
  description = "Set as the GitHub Environment variable AWS_DEPLOY_ROLE_ARN for this environment."
  value       = aws_iam_role.deploy.arn
}
