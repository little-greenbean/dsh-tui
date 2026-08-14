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
if [ -n "$1" ]; then
  # 2FA one-time password supplied as the first argument.
  npm publish --registry=https://registry.npmjs.org --otp="$1"
else
  npm publish --registry=https://registry.npmjs.org
fi
VERSION="$(node -p 'require("./package.json").version')"
echo "✓ published dsh-tui-cli@${VERSION}"
echo "  users can now run:  npm install -g dsh-tui-cli && dsh-tui"
