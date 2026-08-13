# dsh-tui

**Claude-CLI-style terminal chat for DeepSeek Harness (`dsh`) — a thin Ink plugin installed via `dsh plugin`.**

> Work in progress. See [docs/PLAN.md](docs/PLAN.md) for the full development plan.

## What it is

An interactive terminal UI that rides on the DeepSeek Harness agent kernel:
bottom-anchored streaming transcript, tool calls folded into cells, collapsible
thinking, and a theme that adapts to your terminal. Every feature (tools, skills,
subagents, todos, goal, plan, workflow) runs through the harness — the TUI only
renders.

## Install

```bash
dsh plugin --profile tui add dsh-tui
dsh --profile tui
```

## License

[MIT](LICENSE)
