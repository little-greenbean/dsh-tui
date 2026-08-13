# dsh-tui

Claude-CLI-style terminal chat for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (`dsh`) — a thin [Ink](https://github.com/vadimdemedes/ink) plugin installed with `dsh plugin`.

`dsh-tui` is a publishable bundle-patch plugin. It disables the headless one-shot runner and inserts a `tui-runner` that renders an interactive, bottom-anchored streaming transcript over the dsh agent kernel.

![dsh-tui](assets/screenshot.png)

## Features

- Claude-CLI-style UI: bottom-anchored input, streaming transcript, folded tool-call cells.
- Collapsible thinking (`ctrl+t`), interruptible turns (`esc`), history recall (`↑`/`↓`).
- Terminal-theme-adaptive colors (light/dark).
- All dsh features delegate to the kernel — tools, skills, subagents, todos, goal, plan, and workflow run through the harness; the TUI only renders.

## Install

Requires Node.js >= 20 and a working `dsh` on PATH (`npm install -g @deepseek-ai/dsh`).

**Path 1 — `dsh plugin` (manual):**

```bash
dsh plugin --profile tui add @deepseek-ai/dsh-headless
dsh plugin --profile tui add dsh-tui
dsh --profile tui
```

`dsh-tui`'s patch composes over `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`, so the profile needs both bundles.

**Path 2 — curl installer (also bootstraps both bundles):**

```bash
curl -fsSL https://raw.githubusercontent.com/little-greenbean/dsh-tui/main/scripts/install.sh | sh
dsh --profile tui
```

The installer is idempotent and safe to re-run.

## The `dsh-tui` launcher

The package ships a `dsh-tui` bin — a dependency-free launcher that:

- ensures the `tui` profile exists, bootstrapping both bundles on first run;
- then runs `dsh --profile tui`, passing through any extra arguments;
- exits 127 with an install hint if `dsh` is not on PATH.

```bash
dsh-tui                 # equivalent to: dsh --profile tui
dsh-tui --help          # forwards --help to dsh
```

## Usage

| Key | Action |
| --- | --- |
| `esc` | interrupt the current turn |
| `ctrl+t` | toggle thinking display |
| `↑` / `↓` | recall previous input history |
| `ctrl+c` | quit |

Slash commands are forwarded to the dsh kernel and rendered in the transcript; the TUI defines no commands of its own.

## Model & credentials

The plugin uses the DeepSeek official provider (`deepseek-official`) with default model `deepseek-v4-flash`. The API key is read from the `DEEPSEEK_API_KEY` environment variable, or from `~/.dsh/.credentials.yaml` (mode 0600). No third-party gateway is involved.

```bash
export DEEPSEEK_API_KEY=sk-...
dsh --profile tui
```

## Contributing

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the plugin/patch model and module graph, and [docs/PLAN.md](docs/PLAN.md) for the development plan. Run the unit tests with `npm test`.

## License

[MIT](LICENSE)

Integration reference: [gxinxing/deepseek-harness-tui](https://github.com/gxinxing/deepseek-harness-tui) (MIT).
