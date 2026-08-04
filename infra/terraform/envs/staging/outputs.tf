# infra/terraform/envs/staging/outputs.tf · what apps/CI need after apply
# Mirrors envs/prod/outputs.tf minus the opensearch_endpoint/opensearch_master_secret_arn outputs (module not
# instantiated at pilot — see main.tf header note).

output "region" { value = var.region }

output "eks_cluster_name" {
  value       = module.eks.cluster_name
  description = "aws eks update-kubeconfig --name <this> --region ap-south-1"
}

output "aurora_writer_endpoint" {
  value       = module.aurora.cluster_endpoint
  description = "DATABASE_URL / MIGRATION_DATABASE_URL host (writes)."
}
output "aurora_reader_endpoint" {
  value       = module.aurora.reader_endpoint
  description = "At pilot (reader_count=0) this resolves to the SAME instance as the writer — there is no separate reader. Kept for wiring parity with prod; point DATABASE_REPLICA_URL at the writer URL in staging's env secret."
}
output "aurora_master_secret_arn" {
  value       = module.aurora.master_user_secret_arn
  description = "Secrets Manager ARN with the DB master credentials (used to create kv_app/kv_wallet/kv_relay roles)."
}

output "redis_primary_endpoint" { value = module.redis.primary_endpoint }
output "redis_auth_secret_arn"  { value = aws_secretsmanager_secret.redis_auth.arn }

output "media_bucket_name" { value = module.media.media_bucket_name }
output "kms_key_arn"       { value = module.secrets.kms_key_arn }

output "jwt_access_secret_arn" { value = module.secrets.jwt_access_secret_arn }
output "api_shared_secret_arn" { value = module.secrets.api_shared_secret_arn }
output "external_secret_arns"  { value = module.secrets.external_secret_arns }

output "irsa_role_arns" {
  description = "Service-account name -> IAM role ARN. Set each as the Helm serviceAccount.roleArn for that chart."
  value       = module.irsa.role_arns
}

# --- edge ---
output "route53_name_servers" {
  description = "Delegate the 'staging' HOST (not the apex) to these 4 servers: either an NS record at your registrar for the 'staging' subdomain (works even if the krishalaya.com apex isn't on Route 53 yet — most registrars support independent subdomain NS delegation), or, once the prod zone exists, an NS record inside it. See S1_STAGING_APPLY_RUNBOOK.md."
  value       = module.dns.name_servers
}
output "route53_zone_id" {
  value = module.dns.zone_id
}
output "acm_certificate_arn" {
  description = "Wildcard cert ARN for *.staging.krishalaya.com — set as the ALB Ingress certificate-arn (Helm ingress.certArn)."
  value       = module.acm.certificate_arn
}
output "waf_web_acl_arn" {
  description = "Regional WAF ACL ARN — set as the ALB Ingress wafv2-acl-arn (Helm ingress.wafArn)."
  value       = module.waf.web_acl_arn
}
output "alb_controller_role_arn" {
  value = module.alb_edge_iam.lb_controller_role_arn
}
output "external_dns_role_arn" {
  value = module.alb_edge_iam.external_dns_role_arn
}
output "app_hostnames" {
  description = "Planned host -> app mapping for the Ingresses (staging subdomain)."
  value = {
    storefront = ["${var.root_domain}", "www.${var.root_domain}"]
    api        = "api.${var.root_domain}"
    admin      = "admin.${var.root_domain}"
    admin_api  = "admin-api.${var.root_domain}"
    partner    = "partner.${var.root_domain}"
    tenant     = "tenant.${var.root_domain}"
    realtime   = "rt.${var.root_domain}"
  }
}

output "external_secrets_role_arn" {
  description = "Annotate the ESO controller SA (external-secrets/external-secrets) with this IRSA role."
  value       = module.irsa.external_secrets_role_arn
}
