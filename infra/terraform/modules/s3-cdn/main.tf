# infra/terraform/modules/s3-cdn/main.tf · private media bucket (presigned up/download) + access-logs bucket
#
# Security: SSE-KMS, versioning, ALL public access blocked, TLS-only bucket policy, ownership enforced.

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
  tags        = merge(var.tags, { "Module" = "s3-cdn" })
  media_name  = "${var.name}-media-${var.bucket_suffix}"
  logs_name   = "${var.name}-logs-${var.bucket_suffix}"
}

# ---------- Access-logs bucket ----------
resource "aws_s3_bucket" "logs" {
  bucket = local.logs_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # log delivery requires SSE-S3
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {} # whole bucket (as before); required by future AWS providers (PC-56 DEPLOY-1)
    expiration {
      days = 90
    }
  }
}

# ---------- Media bucket ----------
resource "aws_s3_bucket" "media" {
  bucket = local.media_name
  tags   = local.tags
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_logging" "media" {
  bucket        = aws_s3_bucket.media.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "media-access/"
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "abort-incomplete-mpu"
    status = "Enabled"
    filter {} # whole bucket (as before); required by future AWS providers (PC-56 DEPLOY-1)
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {} # whole bucket (as before); required by future AWS providers (PC-56 DEPLOY-1)
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }
}

# TLS-only access policy
data "aws_iam_policy_document" "media_tls" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_tls.json
}
