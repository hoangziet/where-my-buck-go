data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

resource "aws_vpc" "app" {
  cidr_block           = "10.64.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}
resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id
}
resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.64.0.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
}
resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }
}
resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}
resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.64.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
}
resource "aws_security_group" "app" {
  name_prefix = "${var.project}-app-"
  vpc_id      = aws_vpc.app.id
  description = "CloudFront private-origin ingress; outbound HTTPS and private PostgreSQL"
}
resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_vpc_security_group_egress_rule" "packages" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}
resource "aws_security_group" "database" {
  name_prefix = "${var.project}-database-"
  vpc_id      = aws_vpc.app.id
  description = "PostgreSQL access only from the application security group"
}
resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_egress_rule" "database" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
