"""Verified, database-aligned backup archives for R2 evidence objects."""

import hashlib
import io
import json
import tarfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import BinaryIO
from uuid import UUID

MAX_TEXT_SIZE = 10_000
MAX_IMAGE_SIZE = 4_000_000
ARCHIVE_FORMAT = "where-my-buck-go-r2-evidence-v1"


@dataclass(frozen=True)
class EvidenceObject:
    storage_key: str
    kind: str
    digest: bytes


ContentReader = Callable[[str, str], bytes]
ObjectWriter = Callable[[str, str, bytes, bytes], None]


def export_evidence_archive(
    catalog: Sequence[EvidenceObject],
    read_content: ContentReader,
    output: BinaryIO,
) -> int:
    entries = _validate_catalog(catalog)
    manifest = {
        "format": ARCHIVE_FORMAT,
        "items": [
            {"storage_key": item.storage_key, "kind": item.kind, "sha256": item.digest.hex()}
            for item in entries
        ],
    }
    manifest_bytes = json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode("utf-8")
    with tarfile.open(fileobj=output, mode="w|") as archive:
        _add_bytes(archive, "manifest.json", manifest_bytes)
        for item in entries:
            content = read_content(item.storage_key, item.kind)
            _validate_content(item.kind, content)
            if hashlib.sha256(content).digest() != item.digest:
                raise ValueError(f"Evidence checksum mismatch: {item.storage_key}")
            _add_bytes(archive, f"objects/{item.storage_key}", content)
    return len(entries)


def restore_evidence_archive(
    catalog: Sequence[EvidenceObject],
    archive_path: str,
    write_content: ObjectWriter,
) -> int:
    entries = _validate_catalog(catalog)
    expected = {
        item.storage_key: {"storage_key": item.storage_key, "kind": item.kind, "sha256": item.digest.hex()}
        for item in entries
    }
    with tarfile.open(archive_path, mode="r:*") as archive:
        members = archive.getmembers()
        if not members or members[0].name != "manifest.json" or not members[0].isfile():
            raise ValueError("R2 evidence archive must start with manifest.json")
        manifest_file = archive.extractfile(members[0])
        if manifest_file is None:
            raise ValueError("R2 evidence archive manifest is unreadable")
        try:
            manifest = json.loads(manifest_file.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("R2 evidence archive manifest is invalid") from error
        if manifest != {"format": ARCHIVE_FORMAT, "items": list(expected.values())}:
            raise ValueError("R2 evidence archive does not match the restored database")

        expected_names = {"manifest.json", *(f"objects/{key}" for key in expected)}
        if len(members) != len(expected_names) or {member.name for member in members} != expected_names:
            raise ValueError("R2 evidence archive contains missing or unexpected entries")
        for member in members:
            if not member.isfile():
                raise ValueError("R2 evidence archive contains a non-file entry")
        for item in entries:
            member = archive.getmember(f"objects/{item.storage_key}")
            max_size = _size_limit(item.kind)
            if member.size < 1 or member.size > max_size:
                raise ValueError(f"Evidence has an invalid size: {item.storage_key}")
            content_file = archive.extractfile(member)
            if content_file is None:
                raise ValueError(f"Evidence is unreadable: {item.storage_key}")
            content = content_file.read(max_size + 1)
            _validate_content(item.kind, content)
            if hashlib.sha256(content).digest() != item.digest:
                raise ValueError(f"Evidence checksum mismatch: {item.storage_key}")
            write_content(item.storage_key, item.kind, content, item.digest)
    return len(entries)


def _validate_catalog(catalog: Sequence[EvidenceObject]) -> list[EvidenceObject]:
    entries = sorted(catalog, key=lambda item: item.storage_key)
    keys: set[str] = set()
    for item in entries:
        try:
            UUID(item.storage_key)
        except ValueError as error:
            raise ValueError("Evidence storage keys must be UUIDs") from error
        _size_limit(item.kind)
        if len(item.digest) != 32:
            raise ValueError(f"Evidence digest has an invalid size: {item.storage_key}")
        if item.storage_key in keys:
            raise ValueError(f"Duplicate evidence storage key: {item.storage_key}")
        keys.add(item.storage_key)
    return entries


def _size_limit(kind: str) -> int:
    if kind == "text":
        return MAX_TEXT_SIZE
    if kind in ("image/png", "image/jpeg"):
        return MAX_IMAGE_SIZE
    raise ValueError(f"Unsupported evidence type: {kind}")


def _validate_content(kind: str, content: bytes) -> None:
    if not content or len(content) > _size_limit(kind):
        raise ValueError("Evidence is empty or exceeds its size limit")
    if kind == "text":
        try:
            content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("Text evidence must be valid UTF-8") from error


def _add_bytes(archive: tarfile.TarFile, name: str, content: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(content)
    info.mode = 0o600
    info.mtime = 0
    archive.addfile(info, io.BytesIO(content))
