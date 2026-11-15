"""R2 backup archive integrity and database alignment tests."""

import hashlib
import io
import json
import tarfile
from pathlib import Path
from uuid import uuid4

import pytest

from where_my_buck_go.adapters.r2_backup import (
    ARCHIVE_FORMAT,
    EvidenceObject,
    export_evidence_archive,
    restore_evidence_archive,
)


def test_r2_evidence_archive_round_trips_and_verifies_every_object(tmp_path: Path) -> None:
    source = {
        str(uuid4()): ("text", b"Original receipt text"),
        str(uuid4()): ("image/jpeg", b"synthetic-image-bytes"),
    }
    catalog = [EvidenceObject(key, kind, hashlib.sha256(content).digest())
               for key, (kind, content) in source.items()]
    archive_path = tmp_path / "evidence.tar"
    with archive_path.open("wb") as output:
        count = export_evidence_archive(
            catalog,
            lambda key, _kind: source[key][1],
            output,
        )
    assert count == 2
    with tarfile.open(archive_path) as archive:
        assert archive.getnames()[0] == "manifest.json"

    restored: dict[str, tuple[str, bytes]] = {}

    def write(key: str, kind: str, content: bytes, digest: bytes) -> None:
        assert hashlib.sha256(content).digest() == digest
        restored[key] = (kind, content)

    assert restore_evidence_archive(catalog, str(archive_path), write) == 2
    assert restored == source


def test_export_rejects_object_that_does_not_match_database_digest() -> None:
    key = str(uuid4())
    item = EvidenceObject(key, "text", hashlib.sha256(b"expected").digest())
    output = io.BytesIO()

    with pytest.raises(ValueError, match="checksum mismatch"):
        export_evidence_archive([item], lambda _key, _kind: b"different", output)


def test_restore_refuses_archive_from_a_different_database(tmp_path: Path) -> None:
    key = str(uuid4())
    content = b"previous database evidence"
    original = EvidenceObject(key, "text", hashlib.sha256(content).digest())
    archive_path = tmp_path / "evidence.tar"
    with archive_path.open("wb") as output:
        export_evidence_archive([original], lambda _key, _kind: content, output)

    changed = EvidenceObject(key, "text", hashlib.sha256(b"new database evidence").digest())
    restored: list[str] = []
    with pytest.raises(ValueError, match="does not match the restored database"):
        restore_evidence_archive([changed], str(archive_path), lambda key, *_args: restored.append(key))
    assert restored == []


def test_restore_validates_all_objects_before_writing_anything(tmp_path: Path) -> None:
    source = [("00000000-0000-0000-0000-000000000001", b"valid receipt"),
              ("00000000-0000-0000-0000-000000000002", b"another receipt")]
    catalog = [EvidenceObject(key, "text", hashlib.sha256(content).digest()) for key, content in source]
    archive_path = tmp_path / "corrupt-evidence.tar"
    manifest = {
        "format": ARCHIVE_FORMAT,
        "items": [
            {"storage_key": item.storage_key, "kind": item.kind, "sha256": item.digest.hex()}
            for item in catalog
        ],
    }
    with tarfile.open(archive_path, "w") as archive:
        manifest_bytes = json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode()
        manifest_info = tarfile.TarInfo("manifest.json")
        manifest_info.size = len(manifest_bytes)
        archive.addfile(manifest_info, io.BytesIO(manifest_bytes))
        for index, (key, content) in enumerate(source):
            stored_content = b"tampered receipt" if index == 1 else content
            info = tarfile.TarInfo(f"objects/{key}")
            info.size = len(stored_content)
            archive.addfile(info, io.BytesIO(stored_content))

    restored: list[str] = []
    with pytest.raises(ValueError, match="checksum mismatch"):
        restore_evidence_archive(catalog, str(archive_path), lambda key, *_args: restored.append(key))
    assert restored == []


def test_restore_rejects_invalid_database_storage_keys() -> None:
    item = EvidenceObject("../outside", "text", hashlib.sha256(b"text").digest())
    with pytest.raises(ValueError, match="must be UUIDs"):
        export_evidence_archive([item], lambda _key, _kind: b"text", io.BytesIO())
