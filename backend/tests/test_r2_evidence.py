"""R2 evidence adapter contract tests without external cloud credentials."""

import hashlib
from io import BytesIO

import pytest

from where_my_buck_go.adapters.r2_evidence import R2EvidenceStore


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def put_object(self, **kwargs: object) -> object:
        key = str(kwargs["Key"])
        body = kwargs["Body"]
        assert isinstance(body, bytes)
        self.objects[key] = (body, str(kwargs["ContentType"]))
        return {}

    def get_object(self, **kwargs: object) -> dict[str, object]:
        content, content_type = self.objects[str(kwargs["Key"])]
        return {"Body": BytesIO(content), "ContentLength": len(content), "ContentType": content_type}

    def delete_object(self, **kwargs: object) -> object:
        self.objects.pop(str(kwargs["Key"]), None)
        return {}


def test_r2_store_round_trips_text_image_and_delete() -> None:
    client = FakeS3Client()
    store = R2EvidenceStore(client, "owner-evidence")

    text = store.put_text("Original receipt text")
    assert text.digest == hashlib.sha256(b"Original receipt text").digest()
    assert store.get_text(text.storage_key) == "Original receipt text"

    image = store.put_image(b"png-bytes", "image/png")
    assert image.kind == "image/png"
    assert image.digest == hashlib.sha256(b"png-bytes").digest()
    assert store.get_binary(image.storage_key) == b"png-bytes"

    store.discard(text.storage_key)
    assert text.storage_key not in client.objects


@pytest.mark.parametrize(
    ("operation", "args"),
    [
        ("put_text", ("",)),
        ("put_text", ("x" * 10_001,)),
        ("put_image", (b"image", "image/gif")),
        ("put_image", (b"", "image/png")),
        ("put_image", (b"x" * 4_000_001, "image/png")),
    ],
)
def test_r2_store_rejects_invalid_evidence(operation: str, args: tuple[object, ...]) -> None:
    store = R2EvidenceStore(FakeS3Client(), "owner-evidence")
    with pytest.raises(ValueError):
        getattr(store, operation)(*args)


def test_r2_store_requires_a_valid_uuid_key() -> None:
    store = R2EvidenceStore(FakeS3Client(), "owner-evidence")
    with pytest.raises(ValueError):
        store.get_text("../private-file")


def test_r2_configuration_fails_fast_when_credentials_are_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError, match="Missing required R2 configuration"):
        R2EvidenceStore.from_environment()


def test_create_app_in_production_fails_without_r2_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://dummy:dummy@localhost/dummy")
    monkeypatch.setenv("AUTH_HMAC_KEY", "dummy-hmac-key-of-at-least-32-bytes-long")
    from where_my_buck_go.api.app import create_app
    with pytest.raises(ValueError, match="Missing required R2 configuration"):
        create_app(production=True)

