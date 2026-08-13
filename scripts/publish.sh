#!/bin/sh
# Publish dsh-tui to npm. Run from anywhere; the repo root is resolved from
# this script's location. Prompts for `npm adduser` on first run.
set -e
cd "$(dirname "$0")/.."

if ! npm whoami >/dev/null 2>&1; then
  echo "→ npm not logged in — running: npm adduser"
  npm adduser
fi

echo "→ publishing..."
npm publish

VERSION="$(node -p 'require("./package.json").version')"
echo "✓ published dsh-tui@${VERSION}"
echo "  users can now run:  npm install -g dsh-tui && dsh-tui"
