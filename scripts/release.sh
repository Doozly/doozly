#!/bin/sh
# Usage: scripts/release.sh 0.2.0
# Bumps the version, dates the changelog, commits and tags. Pushing the tag builds a draft release.
set -e

version=${1:?"usage: $0 <version>, like 0.2.0"}
case $version in
  v*) echo "Without the v, like 0.2.0" >&2; exit 1 ;;
esac
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first" >&2
  exit 1
fi
if ! grep -q '^## Unreleased' CHANGELOG.md || [ "$(sed -n '/^## Unreleased/,/^## /p' CHANGELOG.md | grep -c '^- ')" = 0 ]; then
  echo "CHANGELOG.md has nothing under Unreleased" >&2
  exit 1
fi

pnpm version "$version" --no-git-tag-version >/dev/null
# GNU sed, only the package's own version, the first one in the file
sed -i "0,/^version = .*/s//version = \"$version\"/" src-tauri/Cargo.toml
(cd src-tauri && cargo update -p doozly --offline -q)
today=$(date -u +%Y-%m-%d)
sed -i "s/^## Unreleased$/## Unreleased\n\n## $version ($today)/" CHANGELOG.md

git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md
git commit -q -m "chore: release v$version"
git tag "v$version"
echo "Tagged v$version. Push with: git push origin main v$version"
