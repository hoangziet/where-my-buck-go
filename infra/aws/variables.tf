variable "region" {
  type    = string
  default = "ap-southeast-1"
}
variable "project" {
  type    = string
  default = "wmbg"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.project))
    error_message = "Use a short lowercase project identifier."
  }
}
variable "github_repository" {
  type    = string
  default = "hoangziet/where-my-buck-go"
}
variable "instance_type" {
  type    = string
  default = "t3.small"
}
variable "budget_email" {
  type = string
}
variable "monthly_budget_usd" {
  type    = number
  default = 50
}
variable "github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Supply an existing GitHub OIDC provider ARN to reuse it."
}
