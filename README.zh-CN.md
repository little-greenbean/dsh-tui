# dsh-tui

**为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）打造的 Claude-CLI 风格终端聊天 —— 一个可通过 `dsh plugin` 安装的轻量 [Ink](https://github.com/vadimdemedes/ink) 插件。**

`dsh-tui` 是一个可发布的 bundle-patch 插件。它禁用 headless 一次性 runner，插入 `tui-runner`，在 dsh agent 内核之上渲染一个交互式、底部锚定的流式对话界面。内核原封不动——工具、技能、子代理、todo、goal、plan、workflow 全部走 harness，TUI 只负责渲染。

![dsh-tui](assets/screenshot.png)

## 特性

- **Claude-CLI 风格界面**：底部锚定流式对话、`>` 输入框、折叠的工具调用 cell。
- 思考折叠（`ctrl+t`）、中断当前回合（`esc`）、历史召回（`↑`/`↓`）、内联权限确认。
- 终端主题自适应配色（明/暗，通过 OSC 11 探测）。
- Slash 命令与 CLI 参数：`/help`、`/clear`、`/model`、`/status`、`/cost`、`/exit` —— 以及 `--resume`、`--continue`、`--model`、`--list-sessions`。
- 其余命令（`/compact`、`/goal`、`/plan`、`/permission`、`/feedback` 等）转发给 harness 原生命令注册表。

## 安装

需要 Node.js ≥ 20，且 PATH 上有 harness CLI（`npm install -g @deepseek-ai/dsh`）。

**方式一 —— `npm i -g`（推荐）：**

```bash
npm install -g @deepseek-ai/dsh    # harness（如已安装可跳过）
npm install -g dsh-tui-cli             # 本插件；提供 `dsh-tui` 命令
dsh-tui                            # 首次运行自动初始化 `tui` profile，然后启动
```

**方式二 —— curl 安装脚本：**

```bash
curl -fsSL https://raw.githubusercontent.com/little-greenbean/dsh-tui/main/scripts/install.sh | sh
dsh --profile tui
```

两者都幂等、可重复执行。profile 由 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + `dsh-tui` 组成；launcher/安装脚本会帮你接好 in-box 的 headless bundle。

## `dsh-tui` 启动器

包内置一个零依赖的 `dsh-tui` 命令：

- 确保 `tui` profile 存在，首次运行自动初始化；
- 然后运行 `dsh --profile tui`，透传所有额外参数；
- 若 PATH 上没有 `dsh`，退出码 127 并给出安装提示。

```bash
dsh-tui                       # 等价于：dsh --profile tui
dsh-tui --resume <id>         # 恢复之前的会话
dsh-tui --continue            # 恢复最近的会话
dsh-tui --list-sessions       # 列出可恢复的会话
```

## 使用

| 按键 | 动作 |
| --- | --- |
| `esc` | 中断当前回合 |
| `ctrl+t` | 切换思考显示 |
| `↑` / `↓` | 历史输入召回 |
| `ctrl+c` | 退出 |

在输入框输入 slash 命令：`/help`、`/clear`、`/model [name]`、`/status`、`/cost`、`/exit`（或 `/quit`）。其他 slash 命令会转发给 harness 原生命令注册表并渲染到对话流中。

CLI 参数（在 `--profile tui` 之后，或经 `dsh-tui` 透传）：`--resume <id>`、`--continue`/`-c`、`--model <name>`/`-m`、`--list-sessions`/`--ls`、`--help`/`-h`。

## 模型与凭据

TUI 使用 harness 的 `agent-default-model` 解析到的模型/provider —— 默认是 DeepSeek 官方 provider（`deepseek-official`）与模型 `deepseek-v4-flash`，可通过 harness 设置覆盖（例如 `~/.dsh/settings.yaml` 或 Web UI）。API key 通过 harness 的凭据存储解析：环境变量 `DEEPSEEK_API_KEY` 或 `~/.dsh/.credentials.yaml`（权限 0600）。

```bash
export DEEPSEEK_API_KEY=sk-...
dsh --profile tui
```

## 贡献

插件/patch 模型与模块图见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，开发计划见 [docs/PLAN.md](docs/PLAN.md)。运行单元测试：`npm test`。

## License

[MIT](LICENSE)

集成参考：[gxinxing/deepseek-harness-tui](https://github.com/gxinxing/deepseek-harness-tui)（MIT）。
