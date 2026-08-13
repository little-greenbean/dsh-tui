# dsh-tui — 完整开发计划

> 目标：把 DeepSeek Harness (`dsh`) 做成一个**可经 `dsh plugin` 安装的 TUI 插件**，形态对齐 **Claude CLI (Claude Code)**，内核 100% 复用 dsh 的 agent 逻辑，dsh 全部功能下放，GitHub 建仓 + 一键部署，让所有人能用。

---

## 1. 结论先行（已完成的调研）

### 1.1 插件接法已踩通
- 一个 dsh 插件 = 一个 npm 包，`package.json` 里声明 `dsh.bundle.patch` 指向一个 patch 文件。
- `dsh plugin --profile <name> add <spec>` 用 pnpm 把包 `link:` 进 `~/.dsh/profiles/<name>`，并 reconcile 进 `dsh.profile.bundles`（依赖声明的 `dsh.bundle` 才会进 layer 栈）。
- profile 启动 = 把 `dsh.profile.bundles`（有序）的 patch 层拍平成**一张扁平 patch 列表**，套在空 root `cordis.yml` 上。因此后一个 bundle 可以 `- id: headless-runner / disabled: true` 关掉前一个 bundle 插入的行，再 `- insert: tui-runner` 追加自己的 runner。
- runner 插件照搬 `@deepseek-ai/dsh-headless` 的 `apply(ctx)` 形态：`ctx.get('appExit')` 拿退出函数 → `agents.create({ sessionId, agentOptions:{provider,model} })` → `installModelSelection` → `agent.whenIdle()` → `agent.followup(createUserMessage(...))` → `sessions.flush()`。
- UI 通过 `session/event` 事件流驱动（`turn/start`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`todo/write`、`turn/end`）。

### 1.2 参考实现的硬伤（我们要修掉）
参考仓库 `gxinxing/deepseek-harness-tui`（MIT，~800 行）证明了整条链路，但有四个问题：
1. **绑死第三方网关 TokenDance**，还要求手改 `@deepseek-ai/dsh-llm-deepseek` 的 runtime 补丁 —— 我们直接走 **`deepseek-official`（`DEEPSEEK_API_KEY`）**，与官方 web/headless 一致，无需补丁。
2. **`private: true`**，不可发布 —— 我们 `private: false`，发 npm。
3. **Codex CLI 风格**，不是 Claude CLI 风格 —— 我们重做 UI 形态。
4. **缺「功能下放」**：无权限交互、无会话恢复、无模型选择器、slash 命令很弱 —— 我们补齐。

### 1.3 关键 API 事实（本机源码核实）
- `dsh --profile tui --resume <id>`：launcher 只认自己的 flag（`--profile/--patch/--dump-*`），**之后的一切原样流入** `ctx.cmdlineArgs.args`。TUI 从 `ctx.get('cmdlineArgs')` 解析 `--resume/--model/--help/--list-sessions`。
- 原生 `AgentRegistry.resume(ownerCtx, ResumeAgentOptions)` + `resumeSessionId` 存在（`packages/core/agent/src/index.ts`）→ 会话恢复是 harness 原生能力。
- `SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`。
- base bundle 78 行已含全部工具（bash/fs/web/skill/subagent/todo/goal/plan/workflow/llm-deepseek…），headless bundle 追加 `code-runtime`。
- 事件细节（参考仓库已实测）：`tool/result` **无顶层 callId**，须从 `message.source.callId` 配对；error 标志是 `message.content[0].isError`（布尔）；`assistant/message` 的 `content[]` 块类型为 `text/reasoning/tool-call/tool-result`。

---

## 2. 架构决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 语言 | **纯 ESM JavaScript，零构建** | `link:` 安装由 Node ESM loader 在 profile 目录解析，无构建 = 秒装、git/npm/link 通吃；参考仓库已验证「无 build/prepare 脚本的包」无需 allowBuilds |
| UI 框架 | **Ink 7 + React 19**（`React.createElement`，无 JSX） | 参考仓库同款，终端 React，天然支持自适应 |
| 模型供应商 | **`deepseek-official`（`DEEPSEEK_API_KEY`）** | 与官方 web/headless 一致，无需网关、无需 runtime 补丁 |
| 组合 | `dsh-base` + `dsh-headless`（取 code-runtime）+ `dsh-tui`，disable headless 的 one-shot runner | 功能全下放 |
| 发布 | npm 包 `dsh-tui` + 一键 install 脚本 + `dsh-tui` wrapper | 一键启动 |
| 测试 | `node --test` 纯函数单测 + `--dump-config` 组合断言（keyless）+ 真 API 冒烟（无 key 自动跳过） | 参考 harness 的 keyless snapshot 理念 |

---

## 3. 目标形态（Claude CLI 对标）

### 3.1 交互面
```
> 你的问题                            ← 底部锚定 composer，`>` prompt
  （流式 markdown 回答，逐 token）
  ⠋ bash git status                   ← 工具调用：spinner → ✓/✗ + 耗时 + 截断输出
     (输出 head+tail 折叠，`… +N lines`)
  ▸ thinking（可折叠，ctrl+t）         ← 思考/推理块
  [todos: ◐ … ☐ … ✓ …]               ← 原生 todo 面板
  ✓ completed · 123in 456out 78cache ← 回合结束状态行
─────────────────────────────────
model deepseek-v4-flash · ~/proj    $0.0004    ← footer（模型 · cwd · 成本/上下文）
```

### 3.2 Claude CLI 功能对标（= dsh 功能下放）

| Claude Code | dsh-tui 实现 | 数据来源 |
|---|---|---|
| 底部锚定 + 流式 markdown | Ink 底部 viewport + 尾随 | `assistant/chunk` text-delta |
| 工具调用折叠成 cell（spinner→✓/✗） | 工具 cell | `tool/call` + `tool/result` |
| 思考折叠 | `ctrl+t` 折叠 reasoning | `assistant/chunk` reasoning-delta |
| 随终端主题自适应 | OSC 11 探测 bg → light/dark 调色板 | `theme.js` |
| `/help` `/clear` `/exit` | slash 命令 | `commands.js` |
| `/model`（箭头选择器） | 模型选择器 | `agentDefaultModel.currentSelection/updateSelection` |
| `/compact` | 触发压缩 | compaction 服务 |
| `/resume` + `--resume <id>` + `--continue` | 会话恢复 | `agents.resume()` |
| `/status` `/cost` | 上下文/成本统计 | `turn/end` usage + session stats |
| 权限确认（内联 yes/no） | **权限交互提示** | dsh approval 服务（见 §4 风险） |
| todo 面板 | 原生 todo 渲染 | `todo/write` |
| plan 模式展示 | plan 事件渲染 | plan 事件（见 §4 风险） |
| 输入历史 ↑↓ / 多行 | composer | ink-text-input + 自定义 |

---

## 4. 风险与未知（执行期必须验证）

| 风险 | 等级 | 缓解 |
|---|---|---|
| **权限/approval 交互 API**（headless 无交互，TUI 如何拦截 pending 请求并 approve/deny） | 🔴 高 | 已派 Explore agent 深挖 `packages/interaction/*` + web 的 `ui-permission` 实现；拿到 API 后优先写一个最小 POC |
| **会话恢复 API 形态**（`ResumeAgentOptions` 字段、列会话方法） | 🟠 中 | 同上，深挖中 |
| **模型切换 mid-session**（`updateSelection` 是否存在） | 🟠 中 | 同上 |
| 官方 deepseek provider 是否复现 TokenDance 的空 `call.id` 流 bug | 🟡 低 | 事件处理全程防御式，`tool/result` 从 `source.callId` 配对 |
| OSC 11 探测在非 TTY（管道/CI）下的行为 | 🟡 低 | `DSH_TUI_BG` 强制 + 非 TTY 回退默认主题 |

---

## 5. 仓库结构与模块边界

```
dsh-tui/
├── package.json              # name: dsh-tui, dsh.bundle.patch, exports, bin
├── cordis.patch.yml          # disable headless-runner/startup + insert tui-runner
├── src/
│   ├── index.js              # tui-runner 插件：agent create/resume + 事件桥 + Ink mount（集成层）
│   ├── ui.js                 # Ink App：transcript/composer/footer/banner/tool-cell/thinking/todo
│   ├── theme.js              # OSC 11 bg 探测 + 明暗调色板
│   ├── utils.js              # CJK 宽度 / markdown 拆分 / 截断 / ANSI 剥离（纯函数）
│   ├── events.js             # session/event → UI 状态 reducer（纯函数，可测）
│   └── commands.js           # slash 命令 + CLI 参数解析（--resume/--model/--help）
├── test/                     # node --test 单测
├── scripts/install.sh        # 一键安装脚本
├── bin/dsh-tui               # wrapper：自动 bootstrap + dsh --profile tui
├── README.md / README.zh-CN.md
├── docs/ARCHITECTURE.md  docs/PLAN.md
├── LICENSE (MIT)
└── .github/workflows/ci.yml  # node --test + dump-config 组合断言
```

### 模块依赖图（决定并行边界）
```
utils.js ──┐
theme.js ──┼──> ui.js ──> index.js（集成）
events.js ─┘        （ui.js 依赖 utils/theme/events/commands）
commands.js ─┘
```
**可并行（独立叶子）**：`theme.js`+`utils.js` 一组、`events.js` 一组、`commands.js` 一组、`docs/install/ci` 一组。
**串行（集成）**：`ui.js` + `index.js` + `cordis.patch.yml` + `package.json`，等叶子合并后再做。

---

## 6. 执行计划（worktree 并行 + 验收回收）

### Phase 0 — 基建（主线程）
1. `gh repo create dsh-tui`（little-greenbean，public，MIT）。
2. 建脚手架：`package.json`（含 `dsh.bundle.patch` + `bin`）、`cordis.patch.yml`、`LICENSE`、`.gitignore`、`package.json` 依赖锁到参考仓库同款版本。
3. `npm view dsh-tui` 确认包名可用性（不可用则 `dsh-harness-tui`）。

### Phase 1 — 并行 worktree（4 个 subagent，独立叶子）
- **W1 `theme+utils`**：`theme.js`（OSC 11 探测、明暗调色板、`DSH_TUI_BG` 覆盖）+ `utils.js`（CJK `wcwidth`、markdown 拆分、head+tail 截断、ANSI 剥离、usage 格式化）+ `test/theme.test.js` `test/utils.test.js`。
- **W2 `events`**：`events.js` 纯 reducer（事件→UI 状态机，含 tool/call↔tool/result 的 callId 配对、todo、reasoning、usage）+ `test/events.test.js`（用录制的事件 fixture 驱动）。
- **W3 `commands`**：`commands.js`（slash 命令解析 + CLI 参数 `--resume/--model/--list-sessions/--help/--version` 解析）+ `test/commands.test.js`。
- **W4 `docs+deploy`**：`README.md`/`README.zh-CN.md`、`scripts/install.sh`、`bin/dsh-tui`、`.github/workflows/ci.yml`、`docs/ARCHITECTURE.md`。

验收门槛（每个 subagent 完成后）：`node --test` 通过 + lint 风格一致 + 接口签名与主线程约定的 import 契约一致。

### Phase 2 — 集成（主线程，1 个 worktree）
- `ui.js`：Ink 组件，消费 W1/W2/W3 的模块，实现 Claude CLI 形态（底部锚定、工具 cell、思考折叠、footer）。
- `index.js`：tui-runner 插件（`agents.create/resume` + `installModelSelection` + `session/event` 桥 + `cmdlineArgs` 解析 + Ink `render(..., { exitOnCtrlC: false })`）。
- 权限交互 + resume + 模型切换接线（依据 Phase 0 深挖到的 API）。

### Phase 3 — 验收（keyless 优先）
1. `dsh plugin --profile tui add <repo>` 实测装进本机源码构建。
2. `dsh --profile tui --dump-config` 断言：tui-runner 在、headless-runner disabled 在。
3. `node --test` 全绿。
4. 真 API 冒烟（`DEEPSEEK_API_KEY` 存在则跑，否则跳过并说明）。
5. 截图归档到 `assets/screenshot.png`。

### Phase 4 — 发布
1. push + GitHub Actions CI 绿。
2. `npm publish`（若包名可用）。
3. README 写清两条部署路径：`dsh plugin --profile tui add dsh-tui && dsh --profile tui`，或 `curl -fsSL …/install.sh | sh`（一键）。

### 心跳机制
- 全程用 **Cron 心跳**（每 ~20 分钟）检查对话/任务状态，subagent 完成通知即时回收；失败任务重新分派。任务持续运行直到 Phase 4 完成。

---

## 7. 验收标准（最终 DoD）
- [ ] `dsh plugin --profile tui add <pkg>` 一键装入，`dsh --profile tui` 直接启动，无需任何 runtime 补丁。
- [ ] 形态对齐 Claude CLI：底部锚定对话流、流式 markdown、工具折叠 cell、思考折叠、主题自适应。
- [ ] 内核走 dsh（base+headless 全 78+ 行），所有工具/子代理/工作流/todo/goal/plan 事件都能渲染。
- [ ] 功能下放：slash 命令、模型切换、会话恢复（`--resume`）、权限交互提示。
- [ ] 走 `deepseek-official`（`DEEPSEEK_API_KEY`），与官方一致，无第三方网关。
- [ ] `node --test` 全绿 + CI 绿 + 截图 + 双语 README + 一键部署。
