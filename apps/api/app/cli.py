"""Command-line utilities.

python -m app.cli export-openapi [path]   Write the public OpenAPI schema (default: stdout)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def export_openapi(path: str | None) -> None:
    # Schema generation needs no secrets or network; use development defaults.
    os.environ.setdefault("ENVIRONMENT", "development")
    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(public_api_url=os.environ.get("PUBLIC_API_URL", "https://api.YOUR_DOMAIN"))
    schema = create_app(settings).openapi()
    text = json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
    if path:
        Path(path).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export-openapi", help="write the public OpenAPI schema")
    export.add_argument("path", nargs="?")
    args = parser.parse_args()
    if args.command == "export-openapi":
        export_openapi(args.path)


if __name__ == "__main__":
    main()
