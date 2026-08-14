#!/bin/sh
# Publish dsh-tui to npm. Run from anywhere; the repo root is resolved from
# this script's location. Prompts for `npm adduser` on first run.
set -e
cd "$(dirname "$0")/.."

if ! npm whoami --registry=https://registry.npmjs.org >/dev/null 2>&1; then
  echo "→ npm not logged in — running: npm adduser (official registry)"
  npm adduser --registry=https://registry.npmjs.org
fi

echo "→ publishing..."
npm publish --registry=https://registry.npmjs.org
VERSION="$(node -p 'require("./package.json").version')"
echo "✓ published dsh-tui@${VERSION}"
echo "  users can now run:  npm install -g dsh-tui && dsh-tui"
