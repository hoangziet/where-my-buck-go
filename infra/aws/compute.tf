data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}
resource "aws_instance" "app" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app.id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  user_data                   = file("${path.module}/user-data.sh")
  user_data_replace_on_change = true
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  root_block_device {
    volume_size = 25
    volume_type = "gp3"
    encrypted   = true
  }
  credit_specification { cpu_credits = "standard" }
  tags       = { Name = var.project }
  depends_on = [aws_route_table_association.app, aws_iam_role_policy_attachment.ssm]
}
resource "aws_cloudfront_vpc_origin" "app" {
  vpc_origin_endpoint_config {
    name                   = var.project
    arn                    = aws_instance.app.arn
    http_port              = 8080
    https_port             = 443
    origin_protocol_policy = "http-only"
    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}
data "aws_security_group" "cloudfront" {
  filter {
    name   = "group-name"
    values = ["CloudFront-VPCOrigins-Service-SG"]
  }
  vpc_id     = aws_vpc.app.id
  depends_on = [aws_cloudfront_vpc_origin.app]
}
resource "aws_vpc_security_group_ingress_rule" "origin" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = data.aws_security_group.cloudfront.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}
resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = var.project
  price_class     = "PriceClass_200"
  origin {
    domain_name = aws_instance.app.private_dns
    origin_id   = var.project
    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.app.id
      origin_read_timeout      = 120
      origin_keepalive_timeout = 5
    }
  }
  default_cache_behavior {
    target_origin_id         = var.project
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    viewer_protocol_policy   = "https-only"
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
  dynamic "custom_error_response" {
    for_each = toset([400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504])
    content {
      error_code            = custom_error_response.value
      error_caching_min_ttl = 0
    }
  }
  depends_on = [aws_vpc_security_group_ingress_rule.origin]
}
