#!/usr/bin/env node
// dsh-tui launcher — bootstraps the `tui` profile on first run, then hands off
// to `dsh --profile tui`. Dependency-free; anything after `dsh-tui` on the
// command line is passed straight through to `dsh`.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROFILE = 'tui';
const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', PROFILE);
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json');

// Bundles the profile needs. `dsh-tui`'s cordis.patch.yml composes over the
// base + headless bundles, so both must be present in the profile stack.
const BOOTSTRAP_STEPS = [
  ['dsh', ['plugin', '--profile', PROFILE, 'add', '@deepseek-ai/dsh-headless']],
  ['dsh', ['plugin', '--profile', PROFILE, 'add', 'dsh-tui']],
];

// Check whether a command is available on PATH without executing it.
function hasCommand(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext.toLowerCase());
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

// Run the bootstrap steps, inheriting stdio so pnpm/dsh output is visible.
function bootstrap() {
  for (const [cmd, args] of BOOTSTRAP_STEPS) {
    const res = spawnSync(cmd, args, { stdio: 'inherit' });
    if (res.error) {
      console.error(`dsh-tui: failed to run \`${cmd} ${args.join(' ')}\`: ${res.error.message}`);
      process.exit(1);
    }
    if (res.status !== 0) {
      process.exit(res.status ?? 1);
    }
  }
}

// --- main ---------------------------------------------------------------
if (!hasCommand('dsh')) {
  console.error('dsh-tui: `dsh` was not found on PATH.');
  console.error('  Install it with:  npm install -g @deepseek-ai/dsh');
  console.error('  (Node.js >= 20 required)');
  process.exit(127);
}

// First run: create the `tui` profile if it does not exist yet.
try {
  accessSync(PROFILE_PKG, fsConstants.F_OK);
} catch {
  console.log(`dsh-tui: bootstrapping the \`${PROFILE}\` profile (first run)...`);
  bootstrap();
}

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
