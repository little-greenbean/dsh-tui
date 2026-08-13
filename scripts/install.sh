#!/bin/sh
# dsh-tui installer — safe to pipe into sh:
#   curl -fsSL https://raw.githubusercontent.com/little-greenbean/dsh-tui/main/scripts/install.sh | sh
# Idempotent: `dsh plugin add` reconciles an already-present bundle, so re-runs
# are no-ops.
set -e

echo "→ dsh-tui installer"

# --- prerequisites -------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "✗ node was not found. Install Node.js >= 20: https://nodejs.org" >&2
  exit 1
fi
node_major="$(node -p 'parseInt(process.versions.node, 10)')"
if [ "${node_major:-0}" -lt 20 ]; then
  echo "✗ node ${node_major} is too old — Node.js >= 20 is required." >&2
  exit 1
fi

if ! command -v dsh >/dev/null 2>&1; then
  echo "✗ dsh was not found on PATH. Install it with: npm install -g @deepseek-ai/dsh" >&2
  exit 1
fi

# --- bootstrap the tui profile -------------------------------------------
echo "→ ensuring the tui profile is installed..."
dsh plugin --profile tui add @deepseek-ai/dsh-headless
dsh plugin --profile tui add dsh-tui

echo "✓ ready — run: dsh --profile tui"
