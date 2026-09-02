#!/usr/bin/env bash
# Pinned style gate for the Android sources (§50: lint + static analysis).
#
# Pinned twice — version AND sha256 — because a style tool that follows `latest`
# turns a green main branch red by itself, and the download is from Maven Central
# straight onto the build machine, so the checksum is also the integrity check.
set -euo pipefail

VER="1.3.1"
SHA="ea7590217143ce897584f067826a2f75bd639f00547f7bd9d0eb8bf4498af061"
JAR="${TMPDIR:-/tmp}/ktlint-${VER}.jar"
URL="https://repo1.maven.org/maven2/com/pinterest/ktlint/ktlint-cli/${VER}/ktlint-cli-${VER}-all.jar"

if [ ! -f "$JAR" ] || [ "$(sha256sum "$JAR" | cut -d" " -f1)" != "$SHA" ]; then
  curl -fsSL -o "$JAR" "$URL"
  echo "$SHA  $JAR" | sha256sum -c - >/dev/null
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/native-android"
# `--limit` keeps a whole-tree scan cheap; patterns are relative to here.
java -jar "$JAR" \
  --editorconfig="$ROOT/scripts/ktlint/.editorconfig" \
  --relative \
  --reporter=plain \
  "app/src/main/java/**/*.kt" "app/src/main/java/**/*.kts"
echo "ktlint (import hygiene) clean."
