"""Export and restore verified R2 objects for production recovery."""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import Engine

from where_my_buck_go.adapters.db import database_url_from_environment, engine_for, evidence
from where_my_buck_go.adapters.r2_backup import EvidenceObject, export_evidence_archive, restore_evidence_archive
from where_my_buck_go.adapters.r2_evidence import R2EvidenceStore


def _catalog(engine: Engine) -> list[EvidenceObject]:
    with engine.connect() as connection:
        rows = connection.execute(
            select(evidence.c.storage_key, evidence.c.kind, evidence.c.sha256_digest)
            .order_by(evidence.c.storage_key)
        ).mappings()
        return [EvidenceObject(str(row["storage_key"]), str(row["kind"]), bytes(row["sha256_digest"]))
                for row in rows]


def export_main() -> None:
    engine = engine_for(database_url_from_environment())
    try:
        store = R2EvidenceStore.from_environment()
        catalog = _catalog(engine)

        def read_content(key: str, kind: str) -> bytes:
            content = store.get_text(key).encode("utf-8") if kind == "text" else store.get_binary(key)
            return content

        count = export_evidence_archive(catalog, read_content, sys.stdout.buffer)
        print(f"Exported {count} R2 evidence objects", file=sys.stderr)
    finally:
        engine.dispose()


def restore_main() -> None:
    parser = argparse.ArgumentParser(description="Restore verified R2 evidence from a production backup archive")
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    engine = engine_for(database_url_from_environment())
    try:
        store = R2EvidenceStore.from_environment()
        count = restore_evidence_archive(_catalog(engine), str(args.archive), store.restore_object)
        print(f"Restored and verified {count} R2 evidence objects")
    finally:
        engine.dispose()
