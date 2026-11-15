"""AWS provider configuration and shared object storage contracts."""

import hashlib
from io import BytesIO
from uuid import uuid4

import boto3
import pytest
from test_r2_evidence import FakeS3Client

from where_my_buck_go.adapters.object_evidence import object_evidence_from_environment
from where_my_buck_go.adapters.s3_evidence import S3EvidenceStore


def test_s3_uses_regional_endpoint_and_sdk_credentials(monkeypatch) -> None:
    calls = []
    client = FakeS3Client()

    def create_client(service, **kwargs):
        calls.append((service, kwargs))
        return client

    monkeypatch.setattr(boto3, "client", create_client)
    monkeypatch.setenv("EVIDENCE_PROVIDER", "s3")
    monkeypatch.setenv("S3_BUCKET_NAME", "private-evidence")
    monkeypatch.setenv("AWS_REGION", "ap-southeast-1")
    store = object_evidence_from_environment()
    assert store.bucket == "private-evidence"
    assert calls[0][0] == "s3"
    assert calls[0][1]["region_name"] == "ap-southeast-1"
    assert set(calls[0][1]) == {"region_name", "config"}
    assert calls[0][1]["config"].retries["total_max_attempts"] == 3
    record = store.put_text("Synthetic AWS receipt")
    assert store.get_text(record.storage_key) == "Synthetic AWS receipt"
    image = store.put_image(b"synthetic-image", "image/png")
    assert store.get_binary(image.storage_key) == b"synthetic-image"
    store.restore_object(record.storage_key, "text", b"restored", hashlib.sha256(b"restored").digest())
    assert store.get_text(record.storage_key) == "restored"
    store.discard(record.storage_key)
    assert record.storage_key not in client.objects


@pytest.mark.parametrize("missing", ["S3_BUCKET_NAME", "AWS_REGION"])
def test_s3_missing_configuration_fails_before_network_access(monkeypatch, missing) -> None:
    monkeypatch.setenv("S3_BUCKET_NAME", "private-evidence")
    monkeypatch.setenv("AWS_REGION", "ap-southeast-1")
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
    monkeypatch.delenv(missing)
    with pytest.raises(ValueError, match="are required"):
        S3EvidenceStore.from_environment()


def test_unknown_production_provider_is_rejected(monkeypatch) -> None:
    monkeypatch.setenv("EVIDENCE_PROVIDER", "filesystem")
    with pytest.raises(ValueError, match="must be s3 or r2"):
        object_evidence_from_environment()


@pytest.mark.parametrize("length", [3, 10_001])
def test_object_response_is_closed_on_success_and_rejection(length) -> None:
    stream = BytesIO(b"abc")

    class Client(FakeS3Client):
        def get_object(self, **kwargs):
            return {"Body": stream, "ContentLength": length}

    store = S3EvidenceStore(Client(), "private-evidence")
    if length > 10_000:
        with pytest.raises(ValueError, match="size limit"):
            store.get_text(str(uuid4()))
    else:
        assert store.get_text(str(uuid4())) == "abc"
    assert stream.closed
