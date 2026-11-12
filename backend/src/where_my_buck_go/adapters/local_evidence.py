"""Local-only evidence storage, intentionally unavailable in production."""

import hashlib
import os
from pathlib import Path
from uuid import UUID, uuid4

from where_my_buck_go.services.ledger import EvidenceRecord, EvidenceStore


class LocalEvidenceStore(EvidenceStore):
    def __init__(self, directory: Path, *, production: bool = False) -> None:
        if production:
            raise ValueError("Production evidence requires R2; filesystem storage is forbidden")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_mode & 0o077:
            raise ValueError("Evidence directory must be private (mode 0700)")
        self.directory = directory

    def _path(self, key: str) -> Path:
        return self.directory / str(UUID(key))

    def _write(self, raw: bytes) -> str:
        key = str(uuid4())
        path = self._path(key)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(raw)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return key

    def put_text(self, content: str) -> EvidenceRecord:
        raw = content.encode("utf-8")
        key = self._write(raw)
        return EvidenceRecord(str(uuid4()), key, hashlib.sha256(raw).digest(), "text")

    def get_text(self, key: str) -> str:
        path = self._path(key)
        if path.is_symlink() or path.stat().st_size > 10_000:
            raise ValueError("Evidence file is unsafe or exceeds the size limit")
        return path.read_text(encoding="utf-8")

    def put_image(self, raw: bytes, mime: str) -> EvidenceRecord:
        if mime not in ("image/png", "image/jpeg"):
            raise ValueError("Only PNG or JPEG image evidence is supported")
        if not raw or len(raw) > 4_000_000:
            raise ValueError("Image evidence must be nonempty and at most 4 MB")
        key = self._write(raw)
        return EvidenceRecord(str(uuid4()), key, hashlib.sha256(raw).digest(), mime)

    def get_binary(self, key: str) -> bytes:
        path = self._path(key)
        if path.is_symlink() or path.stat().st_size > 4_000_000:
            raise ValueError("Evidence file is unsafe or exceeds the size limit")
        return path.read_bytes()

    def discard(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
