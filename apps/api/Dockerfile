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

# Runtime: the plain Python image plus the virtualenv. No uv, no pip, no
# compilers; code is owned by root and read-only for the service user.
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
RUN python -m pip uninstall --yes --quiet pip \
 && rm -rf /usr/local/lib/python3.13/ensurepip \
 && groupadd --system app && useradd --system --gid app --no-create-home --home /nonexistent app
WORKDIR /app
COPY --from=deps /opt/venv /opt/venv
COPY app ./app
USER app
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=2)"]
# One worker per container keeps the in-memory road graph single-copy; scale
# with more containers. --proxy-headers only matters behind a trusted proxy.
# PORT is set by hosts such as Render (10000 there); 8000 otherwise.
CMD ["sh", "-c", "exec uvicorn app.asgi:app --host 0.0.0.0 --port \"$PORT\" --no-access-log --no-server-header --proxy-headers --timeout-graceful-shutdown 20"]
