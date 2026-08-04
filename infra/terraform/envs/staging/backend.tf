# infra/terraform/envs/staging/backend.tf · remote state (S3 + DynamoDB lock)
#
# Reuses the SAME state bucket + lock table bootstrapped once in APPLY-RUNBOOK-prod.md step 1 (the bootstrap is
# AWS-account-level, not prod-specific — do it once, both envs' backend.tf point at it with different `key`s so
# their state files never collide). If staging is applied before prod ever exists, run that step-1 bootstrap here
# first; it is safe to run exactly once per AWS account.
#
# Replace <ACCOUNT_ID_OR_ORG> with the same suffix you used for prod (S3 bucket names are globally unique).

terraform {
  backend "s3" {
    bucket         = "krishalaya-tfstate-<ACCOUNT_ID_OR_ORG>"
    key            = "staging/foundation.tfstate" # distinct key from prod/foundation.tfstate — separate state
    region         = "ap-south-1"
    dynamodb_table = "krishalaya-tflock"
    encrypt        = true
  }
}
