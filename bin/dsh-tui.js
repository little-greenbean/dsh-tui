#!/usr/bin/env node
// dsh-tui launcher — bootstraps the `tui` profile on first run, then hands off
// to `dsh --profile tui`. Dependency-free; anything after `dsh-tui` on the
// command line is passed straight through to `dsh`.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, readFileSync, writeFileSync, constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROFILE = 'tui';
const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', PROFILE);
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json');

// In-box bundles come from the dsh installation itself (never fetched from
// npm), so headless is added to the profile's bundle list directly rather than
// via `dsh plugin add` (which would fetch a stale npm copy).
const HEADLESS_BUNDLE = '@deepseek-ai/dsh-headless';

// Check whether a command is available on PATH without executing it.
function hasCommand(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

// Run one command, inheriting stdio so pnpm/dsh output is visible. Returns the
// exit code instead of exiting, so the caller can fall back.
function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) {
    console.error(`dsh-tui: failed to run \`${cmd} ${args.join(' ')}\`: ${res.error.message}`);
    return 127;
  }
  return res.status ?? 1;
}

function run(cmd, args) {
  const code = tryRun(cmd, args);
  if (code !== 0) process.exit(code);
}

// Ensure `@deepseek-ai/dsh-headless` is in the profile's bundle list, right
// after base. Idempotent.
function ensureHeadlessBundle() {
  const pkg = JSON.parse(readFileSync(PROFILE_PKG, 'utf8'));
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  if (bundles.includes(HEADLESS_BUNDLE)) return;
  const baseIdx = bundles.indexOf('@deepseek-ai/dsh-base');
  const insertAt = baseIdx >= 0 ? baseIdx + 1 : bundles.length;
  bundles.splice(insertAt, 0, HEADLESS_BUNDLE);
  pkg.dsh = { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles } };
  writeFileSync(PROFILE_PKG, JSON.stringify(pkg, null, 2) + '\n');
}

// First run: create the `tui` profile (adds base + dsh-tui as a dependency),
// then wire in the in-box headless bundle. Prefers the npm package and falls
// back to the GitHub URL until the npm package is published.
function bootstrap() {
  console.log(`dsh-tui: bootstrapping the \`${PROFILE}\` profile (first run)...`);
  const code = tryRun('dsh', ['plugin', '--profile', PROFILE, 'add', 'dsh-tui-cli']);
  if (code !== 0) {
    console.log('dsh-tui: npm package not found yet — installing from GitHub...');
    run('dsh', ['plugin', '--profile', PROFILE, 'add', 'github:little-greenbean/dsh-tui']);
  }
  ensureHeadlessBundle();
}

// --- main ---------------------------------------------------------------
if (!hasCommand('dsh')) {
  console.error('dsh-tui: `dsh` was not found on PATH.');
  console.error('  Install it with:  npm install -g @deepseek-ai/dsh');
  console.error('  (Node.js >= 20 required)');
  process.exit(127);
}

try {
  accessSync(PROFILE_PKG, fsConstants.F_OK);
} catch {
  bootstrap();
}
// Even when the profile already exists, keep the bundle list correct (covers a
// manual setup that missed the headless layer).
ensureHeadlessBundle();

// Hand off to the harness. stdio is inherited so the child shares the TTY.
const child = spawn('dsh', ['--profile', PROFILE, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

// Forward signals aimed at us to the child, so it can shut down gracefully.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on('error', (err) => {
  console.error(`dsh-tui: failed to start \`dsh\`: ${err.message}`);
  process.exit(1);
});

// Propagate the child's exit code; if it died from a signal, re-raise that
// signal on ourselves (after detaching our forwarders) so the status matches.
child.on('exit', (code, signal) => {
  if (signal) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
      process.removeAllListeners(sig);
    }
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
