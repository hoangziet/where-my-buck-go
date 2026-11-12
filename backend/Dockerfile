FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend

COPY pyproject.toml ./
COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations

RUN pip install --no-cache-dir .
RUN mkdir -p /data/evidence && chmod 700 /data/evidence

EXPOSE 5000

CMD ["sh", "-c", "mkdir -p /data/evidence && chmod 700 /data/evidence && exec gunicorn --bind=0.0.0.0:5000 --workers=2 --timeout=90 'where_my_buck_go.api.app:create_app()'"]
