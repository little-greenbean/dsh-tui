#!/bin/sh
# dsh-tui installer — safe to pipe into sh:
#   curl -fsSL https://raw.githubusercontent.com/little-greenbean/dsh-tui/main/scripts/install.sh | sh
# Idempotent: `dsh plugin add` reconciles an already-present bundle, and the
# headless bundle insert below is a no-op when it is already listed.
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
# Prefer the npm package; fall back to the GitHub URL until it is published.
if ! dsh plugin --profile tui add dsh-tui-cli 2>/dev/null; then
  echo "→ dsh-tui not on npm yet — installing from GitHub..."
  dsh plugin --profile tui add github:little-greenbean/dsh-tui
fi

# headless is an in-box bundle: dsh resolves it from its own installation
# (never from npm), so add it to the profile's bundle list directly instead of
# `dsh plugin add` (which would fetch a stale npm copy).
node -e '
const fs = require("fs");
const os = require("os");
const p = require("path").join(os.homedir(), ".dsh", "profiles", "tui", "package.json");
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const bundles = (j.dsh && j.dsh.profile && j.dsh.profile.bundles) || [];
if (!bundles.includes("@deepseek-ai/dsh-headless")) {
  const i = bundles.indexOf("@deepseek-ai/dsh-base");
  bundles.splice(i >= 0 ? i + 1 : bundles.length, 0, "@deepseek-ai/dsh-headless");
  j.dsh = { ...j.dsh, profile: { ...(j.dsh && j.dsh.profile), bundles } };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}
'

echo "✓ ready — run: dsh --profile tui"
