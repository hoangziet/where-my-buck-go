"""One-time owner bootstrap; never exposed via HTTP."""

import argparse
import getpass
import os
import secrets
from pathlib import Path

from where_my_buck_go.adapters.auth_repo import PostgresAuthStore
from where_my_buck_go.adapters.db import engine_for
from where_my_buck_go.services.auth import AuthService


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap the first Where My Buck Go owner")
    parser.add_argument("username")
    args = parser.parse_args()
    password = getpass.getpass("Password (at least 12 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        parser.error("Passwords do not match")
    service = AuthService(PostgresAuthStore(engine_for(os.environ["DATABASE_URL"])),
                          os.environ["AUTH_HMAC_KEY"].encode("utf-8"))
    if not service.bootstrap(args.username, password):
        parser.error("An owner already exists; bootstrap is disabled")
    print("Owner created")


def reset_main() -> None:
    parser = argparse.ArgumentParser(description="Reset an existing owner password locally")
    parser.add_argument("username")
    parser.add_argument("--output", type=Path, help="Generate a password into a new file (mode 0600)")
    args = parser.parse_args()
    if args.output is None:
        password = getpass.getpass("New password (at least 12 characters): ")
        if password != getpass.getpass("Confirm password: "):
            parser.error("Passwords do not match")
    else:
        password = secrets.token_urlsafe(32)
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            output.write(password + "\n")
    try:
        service = AuthService(PostgresAuthStore(engine_for(os.environ["DATABASE_URL"])),
                              os.environ["AUTH_HMAC_KEY"].encode("utf-8"))
        if not service.reset_password(args.username, password):
            parser.error("Owner not found; no password was changed")
    except BaseException:
        if args.output is not None:
            args.output.unlink()
        raise
    print("Password reset; existing sessions revoked")


if __name__ == "__main__":
    main()
