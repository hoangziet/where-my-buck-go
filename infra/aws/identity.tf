locals {
  account_id = data.aws_caller_identity.current.account_id
  parameters = "arn:aws:ssm:${var.region}:${local.account_id}:parameter/${var.project}/*"
}
resource "aws_iam_role" "instance" {
  name = "${var.project}-instance"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" }
  }] })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_instance_profile" "app" {
  name = var.project
  role = aws_iam_role.instance.name
}
resource "aws_iam_role_policy" "instance" {
  role = aws_iam_role.instance.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.storage["evidence"].arn}/*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.storage["recovery"].arn}/*" },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.storage["releases"].arn}/*" },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [for bucket in aws_s3_bucket.storage : bucket.arn] },
    { Effect = "Allow", Action = ["ssm:GetParameter", "ssm:GetParameters"], Resource = local.parameters },
    { Effect = "Allow", Action = ["ssm:DeleteParameter"], Resource = "arn:aws:ssm:${var.region}:${local.account_id}:parameter/${var.project}/owner" },
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = [for repo in aws_ecr_repository.app : repo.arn] },
    { Effect = "Allow", Action = ["cloudwatch:PutMetricData"], Resource = "*", Condition = { StringEquals = { "cloudwatch:namespace" = "WhereMyBuckGo" } } },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.app.arn}:*" }
  ] })
}
