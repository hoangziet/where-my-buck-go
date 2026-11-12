"""Database migrations (schema is explicitly versioned)."""

import os

from alembic import context
from sqlalchemy import create_engine

from where_my_buck_go.adapters.db import metadata

config = context.config
target_metadata = metadata


def run_migrations_online() -> None:
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
