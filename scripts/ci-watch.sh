#!/usr/bin/env bash
# KuchuPuchu CI watcher — polls GitHub Actions for new runs, logs every
# completed run, flags failures. Log file: ci-watch.log (workspace root).
# Token comes from the environment or a gitignored local file (scripts/.gh-token) —
# never hardcoded: GitHub push protection blocks any commit containing a PAT.
GH_TOKEN="${GH_TOKEN:-$(cat "$(dirname "$0")/.gh-token" 2>/dev/null)}"
REPO="rabbihossainltd1/KuchuPuchu"
API="https://api.github.com/repos/$REPO/actions/runs?per_page=10"
LOG="/home/user/KuchuPuchu/ci-watch.log"
STATE="/home/user/KuchuPuchu/.ci-seen"
touch "$STATE"
echo "$(date -Is) ci-watch started" >> "$LOG"
while true; do
  curl -s -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API" \
  | python3 - "$STATE" >> "$LOG" <<'PYEOF'
import json, sys, datetime
seen_path = sys.argv[1]
seen = set(open(seen_path).read().split())
try:
    runs = json.load(sys.stdin).get("workflow_runs", [])
except Exception:
    runs = []
now = datetime.datetime.now().isoformat(timespec="seconds")
new_seen = []
for r in runs:
    rid = str(r["id"])
    if r["status"] != "completed":
        continue
    if rid in seen:
        continue
    new_seen.append(rid)
    concl = r.get("conclusion", "?")
    mark = "❌ FAILURE" if concl != "success" else "✅ success"
    msg = f"{now} CI {mark} run={rid} sha={r['head_sha'][:7]} by={r['head_commit']['author']['name']} — {r['head_commit']['message'].splitlines()[0][:80]} | {r['html_url']}"
    print(msg, flush=True)
    if concl != "success":
        # also list failed job/step names for instant diagnosis
        import urllib.request
        req = urllib.request.Request(
            f"https://api.github.com/repos/rabbihossainltd1/KuchuPuchu/actions/runs/{rid}/jobs",
            headers={"Authorization": "token " + __import__("os").environ.get("GH_TOKEN", ""),
                     "Accept": "application/vnd.github+json"})
        try:
            jobs = json.load(urllib.request.urlopen(req, timeout=30)).get("jobs", [])
            for j in jobs:
                if j.get("conclusion") not in (None, "success", "skipped"):
                    failed = [s["name"] for s in j["steps"] if s.get("conclusion") not in (None, "success", "skipped")]
                    print(f"{now}    → job '{j['name']}' failed at step(s): {', '.join(failed)}", flush=True)
        except Exception as e:
            print(f"{now}    (could not fetch failed jobs: {e})", flush=True)
if new_seen:
    with open(seen_path, "a") as f:
        f.write("\n".join(new_seen) + "\n")
PYEOF
  sleep 180
done
