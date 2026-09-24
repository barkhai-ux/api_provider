# Public API gateway (FastAPI).
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
WORKDIR /app

FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=deps /opt/venv /opt/venv
COPY app ./app
ENV PATH="/opt/venv/bin:$PATH"
USER app
ENV PORT=8000
EXPOSE 8000
# One worker per container keeps the in-memory road graph single-copy; scale
# with more containers. --proxy-headers only matters behind a trusted proxy.
# PORT is set by hosts such as Render (10000 there); 8000 otherwise.
CMD ["sh", "-c", "exec uvicorn app.asgi:app --host 0.0.0.0 --port \"$PORT\" --no-access-log --proxy-headers --timeout-graceful-shutdown 20"]
