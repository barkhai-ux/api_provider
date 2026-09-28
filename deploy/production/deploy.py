#!/usr/bin/python3
"""Poll public GitHub CI and deploy the exact passing main commit."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path("/opt/api-provider")
REPO = ROOT / "repository"
STATE = ROOT / "deployed-sha"

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def api(path):
    if path == "commits/main":
        # Use git for polling; reserve the unauthenticated API quota for CI.
        result = subprocess.check_output(
            ["git", "ls-remote", "https://github.com/barkhai-ux/api_provider.git", "refs/heads/main"],
            text=True, timeout=30,
        )
        return {"sha": result.split()[0]}
    request = urllib.request.Request(
        "https://api.github.com/repos/barkhai-ux/api_provider/" + path,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "ubhub-deployer"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def main():
    ROOT.mkdir(exist_ok=True)
    with (ROOT / "deploy.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        sha = api("commits/main")["sha"]
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise RuntimeError("Invalid commit SHA")
        if STATE.exists() and STATE.read_text().strip() == sha:
            print("Already deployed " + sha, flush=True)
            return
        runs = api("actions/runs?branch=main&event=push&head_sha=" + sha + "&per_page=100")["workflow_runs"]
        for workflow in ("CI", "Security"):
            matching = [r for r in runs if r["name"] == workflow and r["head_sha"] == sha]
            latest = max(matching, key=lambda r: (r["run_number"], r.get("run_attempt", 1)), default=None)
            if not latest or latest["status"] != "completed" or latest["conclusion"] != "success":
                print("Waiting for successful " + workflow + " on " + sha, flush=True)
                return
        if not REPO.exists():
            run("git", "clone", "--bare", "https://github.com/barkhai-ux/api_provider.git", str(REPO))
        run("git", "--git-dir=" + str(REPO), "fetch", "origin", "main")
        release = ROOT / "releases" / sha
        release.mkdir(parents=True, exist_ok=True)
        archive = ROOT / "release.tar"
        run("git", "--git-dir=" + str(REPO), "archive", "--format=tar", "-o", str(archive), sha)
        run("tar", "-xf", str(archive), "-C", str(release))
        archive.unlink()
        compose = ["docker", "compose", "--project-name", "developers", "--env-file",
                   "/etc/api-provider/production.env", "--project-directory", str(release),
                   "-f", str(release / "docker-compose.yml"),
                   "-f", "/etc/api-provider/compose.yml"]
        # A failed build leaves the currently running stack untouched.
        run(*compose, "build")
        run(*compose, "up", "-d", "--wait", "--wait-timeout", "180", "convex-backend")
        run(*compose, "run", "--rm", "--no-deps", "convex-deploy")
        run(*compose, "up", "-d", "--no-deps", "--wait", "--wait-timeout", "180", "api", "web")
        for url in ("https://developers.ubhub.mn/health", "https://developers.ubhub.mn/robots.txt",
                    "https://developers.ubhub.mn/convex/version"):
            run("curl", "--fail", "--silent", "--show-error", "--max-time", "20", url)
        temporary = ROOT / "deployed-sha.tmp"
        temporary.write_text(sha + "\n")
        os.replace(temporary, STATE)
        print("Deployed " + sha, flush=True)

if __name__ == "__main__":
    main()
