"""Select explicitly configured production object storage."""

import os

from where_my_buck_go.adapters.r2_evidence import R2EvidenceStore
from where_my_buck_go.adapters.s3_evidence import S3EvidenceStore


def object_evidence_from_environment() -> S3EvidenceStore:
    provider = os.environ.get("EVIDENCE_PROVIDER", "r2")
    if provider == "s3":
        return S3EvidenceStore.from_environment()
    if provider == "r2":
        return R2EvidenceStore.from_environment()
    raise ValueError("EVIDENCE_PROVIDER must be s3 or r2 in production")
