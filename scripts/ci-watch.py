#!/usr/bin/env python3
"""One CI-watch poll: read GitHub Actions runs JSON from stdin, log newly
completed runs, print failure details. State of seen run ids lives in the
file given as argv[1]. Invoked by scripts/ci-watch.sh."""
import json
import os
import sys
import datetime
import urllib.request

state_path = sys.argv[1]
try:
    seen = set(open(state_path).read().split())
except FileNotFoundError:
    seen = set()

try:
    runs = json.load(sys.stdin).get("workflow_runs", [])
except Exception:
    runs = []

now = datetime.datetime.now().isoformat(timespec="seconds")
new_seen = []
for r in runs:
    rid = str(r["id"])
    if r["status"] != "completed" or rid in seen:
        continue
    new_seen.append(rid)
    concl = r.get("conclusion", "?")
    mark = "❌ FAILURE" if concl != "success" else "✅ success"
    print(
        f"{now} CI {mark} run={rid} sha={r['head_sha'][:7]} "
        f"by={r['head_commit']['author']['name']} — "
        f"{r['head_commit']['message'].splitlines()[0][:80]} | {r['html_url']}",
        flush=True,
    )
    if concl != "success":
        token = os.environ.get("GH_TOKEN", "")
        req = urllib.request.Request(
            f"https://api.github.com/repos/rabbihossainltd1/KuchuPuchu/actions/runs/{rid}/jobs",
            headers={
                "Authorization": f"token {token}",
                "Accept": "application/vnd.github+json",
            },
        )
        try:
            jobs = json.load(urllib.request.urlopen(req, timeout=30)).get("jobs", [])
            for j in jobs:
                if j.get("conclusion") not in (None, "success", "skipped"):
                    failed = [
                        s["name"]
                        for s in j["steps"]
                        if s.get("conclusion") not in (None, "success", "skipped")
                    ]
                    print(
                        f"{now}    → job '{j['name']}' failed at step(s): {', '.join(failed)}",
                        flush=True,
                    )
        except Exception as e:  # noqa: BLE001 - best-effort diagnostics
            print(f"{now}    (could not fetch failed jobs: {e})", flush=True)

if new_seen:
    with open(state_path, "a") as f:
        f.write("\n".join(new_seen) + "\n")
