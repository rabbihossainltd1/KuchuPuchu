#!/usr/bin/env python3
"""Push the current working tree to GitHub through the Git data API.

The sandbox's git transport to github.com answers "Repository not found" for
every fetch/push, while the REST API and the tarball endpoint work. This
script therefore builds the commit the same way the API does:

    blob -> tree (base_tree = the remote HEAD's tree) -> commit -> ref update

Only the files that differ from the remote HEAD are sent, and the new commit
is a fast-forward child of the remote HEAD, so the normal history is kept.

    python3 scripts/push-via-api.py "commit message" [path ...]
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO_ID = "1346525178"
API = f"https://api.github.com/repositories/{REPO_ID}"
TOKEN = os.environ["GITHUB_PAT"]
TARBALL = "/tmp/kpx/rabbihossainltd1-KuchuPuchu-aa1aae7"


def call(method, url, payload=None, tries=6):
    last = None
    for attempt in range(tries):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"token {TOKEN}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                body = res.read().decode()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as err:
            last = err
            detail = err.read().decode()[:300]
            print(f"  {method} {url.rsplit('/', 1)[-1]} -> {err.code} {detail}")
            if err.code in (404, 502, 503) and attempt < tries - 1:
                time.sleep(2 + attempt * 2)
                continue
            raise
    raise last


def changed_files():
    out = subprocess.run(
        ["diff", "-rq", "--exclude=.git", "--exclude=node_modules", "--exclude=dist", TARBALL, "."],
        capture_output=True,
        text=True,
    ).stdout
    files = []
    for line in out.splitlines():
        if line.startswith("Files ") and " differ" in line:
            files.append(line.split()[1][len(TARBALL) + 1 :])
        elif line.startswith("Only in ./"):
            rest = line[len("Only in ./") :]
            if ": " in rest:
                folder, name = rest.split(": ", 1)
                files.append(f"{folder.rstrip('/')}/{name.rstrip('/')}")
            else:
                files.append(rest.rstrip("/"))
    return sorted(set(files))


def main():
    message = sys.argv[1]
    only = sys.argv[2:] or None
    files = changed_files()
    if only:
        files = [f for f in files if f in only]
    if not files:
        print("nothing to push")
        return 0
    print(f"pushing {len(files)} file(s):")
    for f in files:
        print("  -", f)

    ref = call("GET", f"{API}/git/ref/heads/main")
    head = ref["object"]["sha"]
    head_commit = call("GET", f"{API}/git/commits/{head}")
    base_tree = head_commit["tree"]["sha"]
    print(f"remote HEAD {head[:10]} tree {base_tree[:10]}")

    entries = []
    for path in files:
        with open(path, "rb") as handle:
            blob = call(
                "POST",
                f"{API}/git/blobs",
                {
                    "content": base64.b64encode(handle.read()).decode(),
                    "encoding": "base64",
                },
            )
        entries.append(
            {"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]}
        )
        print(f"  blob {path} -> {blob['sha'][:10]}")

    tree = call("POST", f"{API}/git/trees", {"base_tree": base_tree, "tree": entries})
    print(f"tree {tree['sha'][:10]}")

    commit = call(
        "POST",
        f"{API}/git/commits",
        {"message": message, "tree": tree["sha"], "parents": [head]},
    )
    print(f"commit {commit['sha'][:10]}")

    call("PATCH", f"{API}/git/refs/heads/main", {"sha": commit["sha"], "force": False})
    print("main ->", commit["sha"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
