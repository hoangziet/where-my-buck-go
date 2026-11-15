"""Private Amazon S3 evidence storage using the AWS SDK credential chain."""

import hashlib
import hmac
import os
from collections.abc import Mapping
from typing import Protocol
from uuid import UUID, uuid4

from where_my_buck_go.services.ledger import EvidenceRecord, EvidenceStore


class S3Client(Protocol):
    def put_object(self, **kwargs: object) -> object: ...
    def get_object(self, **kwargs: object) -> Mapping[str, object]: ...
    def delete_object(self, **kwargs: object) -> object: ...


class S3EvidenceStore(EvidenceStore):
    def __init__(self, client: S3Client, bucket: str) -> None:
        if not bucket:
            raise ValueError("An evidence bucket is required")
        self.client = client
        self.bucket = bucket

    @classmethod
    def from_environment(cls) -> "S3EvidenceStore":
        import boto3
        from botocore.config import Config

        bucket = os.environ.get("S3_BUCKET_NAME", "").strip()
        region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
        if not bucket or not region:
            raise ValueError("S3_BUCKET_NAME and AWS_REGION are required for S3 evidence")
        client = boto3.client(
            "s3", region_name=region,
            config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=30,
                          retries={"mode": "standard", "total_max_attempts": 3}),
        )
        return cls(client, bucket)

    def _put(self, content: bytes, content_type: str) -> EvidenceRecord:
        key = str(uuid4())
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        return EvidenceRecord(str(uuid4()), key, hashlib.sha256(content).digest(), content_type)

    def _get(self, key: str, max_size: int) -> bytes:
        object_key = str(UUID(key))
        response = self.client.get_object(Bucket=self.bucket, Key=object_key)
        body = response.get("Body")
        if body is None or not hasattr(body, "read"):
            raise ValueError("Object storage returned an invalid evidence object")
        try:
            content_length = response.get("ContentLength")
            if isinstance(content_length, (int, str)) and int(content_length) > max_size:
                raise ValueError("Evidence exceeds the size limit")
            content = cast_read(body, max_size + 1)
            if len(content) > max_size:
                raise ValueError("Evidence exceeds the size limit")
            return content
        finally:
            close = getattr(body, "close", None)
            if callable(close):
                close()

    def put_text(self, content: str) -> EvidenceRecord:
        raw = content.encode("utf-8")
        if not raw or len(raw) > 10_000:
            raise ValueError("Text evidence must be nonempty and at most 10 KB")
        return self._put(raw, "text")

    def get_text(self, key: str) -> str:
        return self._get(key, 10_000).decode("utf-8")

    def put_image(self, raw: bytes, mime: str) -> EvidenceRecord:
        if mime not in ("image/png", "image/jpeg"):
            raise ValueError("Only PNG or JPEG image evidence is supported")
        if not raw or len(raw) > 4_000_000:
            raise ValueError("Image evidence must be nonempty and at most 4 MB")
        return self._put(raw, mime)

    def get_binary(self, key: str) -> bytes:
        return self._get(key, 4_000_000)

    def discard(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=str(UUID(key)))

    def restore_object(self, key: str, content_type: str, content: bytes, digest: bytes) -> None:
        object_key = str(UUID(key))
        if content_type == "text":
            maximum = 10_000
        elif content_type in ("image/png", "image/jpeg"):
            maximum = 4_000_000
        else:
            raise ValueError(f"Unsupported evidence type: {content_type}")
        if not content or len(content) > maximum or not hmac.compare_digest(hashlib.sha256(content).digest(), digest):
            raise ValueError(f"Restored evidence failed integrity validation: {object_key}")
        self.client.put_object(
            Bucket=self.bucket,
            Key=object_key,
            Body=content,
            ContentType=content_type,
            Metadata={"sha256": digest.hex()},
        )


def cast_read(body: object, limit: int) -> bytes:
    reader = getattr(body, "read", None)
    if not callable(reader):
        raise ValueError("Object storage returned an invalid evidence object")
    content = reader(limit)
    if not isinstance(content, bytes):
        raise ValueError("Object storage returned non-binary evidence")
    return content
