"""Cloudflare R2 configuration for the shared S3 evidence implementation."""

import os

from where_my_buck_go.adapters.s3_evidence import S3EvidenceStore


class R2EvidenceStore(S3EvidenceStore):
    @classmethod
    def from_environment(cls) -> "R2EvidenceStore":
        account_id = os.environ.get("R2_ACCOUNT_ID", "")
        access_key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
        secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")
        bucket = os.environ.get("R2_BUCKET_NAME", "")
        missing = [
            name for name, value in (
                ("R2_ACCOUNT_ID", account_id),
                ("R2_ACCESS_KEY_ID", access_key_id),
                ("R2_SECRET_ACCESS_KEY", secret_access_key),
                ("R2_BUCKET_NAME", bucket),
            ) if not value
        ]
        if missing:
            raise ValueError(f"Missing required R2 configuration: {', '.join(missing)}")

        import boto3
        from botocore.config import Config

        endpoint_override = os.environ.get("R2_ENDPOINT_URL", "").strip()
        endpoint_url = endpoint_override or f"https://{account_id}.r2.cloudflarestorage.com"
        config = (
            Config(signature_version="s3v4", s3={"addressing_style": "path"})
            if endpoint_override
            else Config(signature_version="s3v4")
        )
        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name="auto",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=config,
        )
        return cls(client, bucket)
