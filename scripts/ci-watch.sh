#!/usr/bin/env bash
# KuchuPuchu CI watcher — polls GitHub Actions every 3 minutes for new runs,
# logs every newly completed run to ci-watch.log, and on failure lists the
# failed job + step names. Token comes from GH_TOKEN env or the gitignored
# scripts/.gh-token file (never hardcoded — push protection blocks PATs).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
GH_TOKEN="${GH_TOKEN:-$(cat "$DIR/.gh-token" 2>/dev/null)}"
REPO="rabbihossainltd1/KuchuPuchu"
API="https://api.github.com/repos/$REPO/actions/runs?per_page=10"
LOG="$DIR/../ci-watch.log"
STATE="$DIR/../.ci-seen"
touch "$LOG" "$STATE"
echo "$(date -Is) ci-watch started" >> "$LOG"
while true; do
  curl -s -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API" \
    | GH_TOKEN="$GH_TOKEN" python3 "$DIR/ci-watch.py" "$STATE" >> "$LOG"
  sleep 180
done
