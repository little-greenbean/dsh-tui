# dsh-tui

面向 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（`dsh`）的 Claude-CLI 风格终端聊天插件 —— 一个通过 `dsh plugin` 安装的轻量 [Ink](https://github.com/vadimdemedes/ink) 插件。

`dsh-tui` 是一个可发布的 bundle-patch 插件。它会禁用无头一次性运行器，并插入一个 `tui-runner`，在 dsh agent 内核之上渲染一个交互式、底部锚定的流式对话界面。

![dsh-tui](assets/screenshot.png)

## 特性

- Claude-CLI 风格界面：底部锚定的输入框、流式对话、折叠的工具调用单元。
- 可折叠的思考过程（`ctrl+t`）、可中断的回答（`esc`）、历史记录回看（`↑`/`↓`）。
- 自适应终端主题的颜色（浅色/深色）。
- 所有 dsh 功能都委托给内核 —— 工具、技能、子代理、todos、goal、plan、workflow 都通过 harness 运行；TUI 只负责渲染。

## 安装

需要 Node.js >= 20，并且 PATH 中有可用的 `dsh`（`npm install -g @deepseek-ai/dsh`）。

**方式一 —— `dsh plugin`（手动）：**

```bash
dsh plugin --profile tui add @deepseek-ai/dsh-headless
dsh plugin --profile tui add dsh-tui
dsh --profile tui
```

`dsh-tui` 的 patch 组合在 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` 之上，因此 profile 需要这两个 bundle。

**方式二 —— curl 安装脚本（同样会引导安装这两个 bundle）：**

```bash
curl -fsSL https://raw.githubusercontent.com/little-greenbean/dsh-tui/main/scripts/install.sh | sh
dsh --profile tui
```

安装脚本是幂等的，可以安全地重复运行。

## `dsh-tui` 启动器

该包附带一个 `dsh-tui` 可执行文件 —— 一个零依赖的启动器，它会：

- 确保 `tui` profile 存在，首次运行时引导安装这两个 bundle；
- 然后运行 `dsh --profile tui`，并透传所有额外参数；
- 如果 PATH 中没有 `dsh`，则打印安装提示并以 127 退出。

```bash
dsh-tui                 # 等同于：dsh --profile tui
dsh-tui --help          # 将 --help 透传给 dsh
```

## 使用

| 按键 | 作用 |
| --- | --- |
| `esc` | 中断当前回答 |
| `ctrl+t` | 切换思考过程显示 |
| `↑` / `↓` | 回看之前的输入历史 |
| `ctrl+c` | 退出 |

斜杠命令会转发给 dsh 内核并渲染在对话中；TUI 自身不定义任何命令。

## 模型与凭据

该插件使用 DeepSeek 官方提供商（`deepseek-official`），默认模型为 `deepseek-v4-flash`。API key 从 `DEEPSEEK_API_KEY` 环境变量读取，或从 `~/.dsh/.credentials.yaml`（权限 0600）读取。不经过任何第三方网关。

```bash
export DEEPSEEK_API_KEY=sk-...
dsh --profile tui
```

## 贡献

插件/patch 模型与模块结构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，开发计划见 [docs/PLAN.md](docs/PLAN.md)。运行单元测试使用 `npm test`。

## 许可证

[MIT](LICENSE)

集成参考：[gxinxing/deepseek-harness-tui](https://github.com/gxinxing/deepseek-harness-tui)（MIT）。
