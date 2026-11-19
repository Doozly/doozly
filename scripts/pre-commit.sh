#!/bin/sh
set -e

# A personal hook can live in .git/hooks/pre-commit.local, it runs first
local_hook=$(git rev-parse --git-path hooks/pre-commit.local)
if [ -x "$local_hook" ]; then
  "$local_hook"
fi

pnpm exec biome check --staged --no-errors-on-unmatched
pnpm typecheck
