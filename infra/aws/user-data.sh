#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 curl unzip python3 python3-boto3 python3-psycopg
systemctl enable --now docker
install -d -m 700 /opt/wmbg /opt/wmbg/certs /opt/wmbg/releases
curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /opt/wmbg/certs/rds.pem
chmod 644 /opt/wmbg/certs/rds.pem
# The managed Ubuntu image includes SSM Agent. No inbound SSH is configured.
systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service
