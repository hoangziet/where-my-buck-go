output "deployment" {
  value = {
    region          = var.region
    project         = var.project
    account_id      = local.account_id
    instance_id     = aws_instance.app.id
    database_host   = aws_db_instance.app.address
    database_name   = aws_db_instance.app.db_name
    database_secret = aws_db_instance.app.master_user_secret[0].secret_arn
    evidence_bucket = aws_s3_bucket.storage["evidence"].id
    recovery_bucket = aws_s3_bucket.storage["recovery"].id
    releases_bucket = aws_s3_bucket.storage["releases"].id
    repositories    = { for key, repo in aws_ecr_repository.app : key => repo.repository_url }
    build_role      = aws_iam_role.github["build"].arn
    deploy_role     = aws_iam_role.github["deploy"].arn
    public_url      = "https://${aws_cloudfront_distribution.app.domain_name}"
    public_host     = aws_cloudfront_distribution.app.domain_name
    distribution_id = aws_cloudfront_distribution.app.id
  }
}
