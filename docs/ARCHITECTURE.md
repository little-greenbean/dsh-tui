# Architecture

`dsh-tui` is a publishable bundle-patch plugin for DeepSeek Harness (`dsh`). It does not reimplement the agent loop; it patches the harness at the profile level and renders whatever the kernel emits.

## The plugin / patch model

A `dsh` profile is a stack of bundle patch layers under `~/.dsh/profiles/<name>`. Installing a package into a profile (`dsh plugin --profile tui add dsh-tui-cli`) forwards to pnpm in that profile directory. Because `dsh-tui-cli`'s `package.json` declares `dsh.bundle.patch` pointing at `cordis.patch.yml`, the package joins the profile's `dsh.profile.bundles` layer stack.

`cordis.patch.yml` is a flattened patch applied in order over the profile root:

- it disables the `headless-startup` and `headless-runner` rows inserted by `@deepseek-ai/dsh-headless`;
- it inserts a `tui-runner` row.

`dsh plugin add` is the reconcile step that materializes these patch rows into the profile. The patch composes over `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`, which is why the profile needs both bundles (the launcher and install script add them together).

## Module graph

The source is layered so that the UI is a pure projection of kernel events:

```
utils/  theme/  events/  commands/
    \       \        \        /
     \       \        \      /
      +-------+--------+----+
              ui.js
                |
             index.js
```

- `utils/` — terminal, theme, and small shared helpers.
- `theme/` — terminal-theme-adaptive color tokens (light/dark).
- `events/` — adapters that normalize kernel events into UI-shaped payloads.
- `commands/` — the small set of TUI-local key actions (`esc`, `ctrl+t`, history, quit).
- `ui.js` — the Ink component tree (bottom-anchored transcript, tool-call cells, collapsible thinking).
- `index.js` — the `tui-runner` entry point; subscribes to the kernel and mounts the UI.

## Event → UI flow

The kernel emits a `session/event` stream for the active session. `index.js` subscribes to it, `events/` normalizes each event into a UI payload, and `ui.js` folds it into the transcript (assistant deltas append to the streaming cell, tool calls collapse into cells, thinking is gated by the `ctrl+t` toggle). Local key actions are the only events the TUI generates; everything else is read from the kernel.

## Deployment / install flow

Two equivalent entry points converge on the same bootstrap:

1. `dsh-tui` launcher (`bin/dsh-tui.js`): resolves `~/.dsh/profiles/tui`, bootstraps both bundles if `package.json` is missing, then spawns `dsh --profile tui` with inherited stdio and clean exit/signal forwarding.
2. `scripts/install.sh`: checks Node >= 20 and `dsh` on PATH, installs `dsh-tui` into the profile (npm first, GitHub fallback), wires the in-box `@deepseek-ai/dsh-headless` bundle into the profile's bundle list, then prints the ready hint.

Both are idempotent — re-running the add step or re-running the launcher on an existing profile is a no-op.

## Development plan

See [docs/PLAN.md](PLAN.md) for the phased implementation plan (added separately).
