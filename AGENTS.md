# AGENTS.md — Nuum 项目地图（AI 主入口）

> 本文件是遵循 [agents.md](https://agents.md/) 规范的 AI agent 项目入口。
> 先读本文件再改代码。改业务逻辑时先读 [docs/coding](./docs/coding/README.md)。
> 当前施工：agent-first 主链路及会话真源 / UI 投影收口已经完成。
> Proactive Mode 与 Work Bar 仍处于设计阶段，不得写成当前能力。
> 更新时间：2026-09-04

## 项目定位

Nuum 是 agent-first 的本地 AI 桌面客户端。它把 agent 作为持久实体，让身份、记忆、工具与工作状态独立于临时会话存在。

技术本质：**Electron 薄壳 + React UI + 独立 Host 进程 + 独立 Kernel 进程**。模型默认走 DeepSeek（OpenAI 兼容），也支持 OpenAI / Anthropic 官方 API。产品后端是 Host 与 Kernel。

## 仓库结构

```
Nuum/
├── apps/
│   └── desktop/                 # 唯一可运行产品：Electron 壳（main / preload / renderer 挂载）
├── packages/
│   ├── ui/                      # 渲染层（侧栏、工作区、设置、主题 token）
│   ├── host/                    # 会话 / 设置 / 权限 / 拉起 Kernel；入口 src/main.ts，bin: nuum-host
│   ├── kernel/                  # 模型循环、工具执行；入口 src/main.ts，bin: nuum-kernel
│   ├── protocol/                # Desktop ↔ Host ↔ Kernel 的 JSON-RPC 契约
│   ├── tools/                   # 工具注册与内置工具
│   └── sandbox/                 # 工具执行沙箱
├── scripts/
│   └── smoke-host.mjs           # Host stdio 冒烟
├── docs/coding/                 # 开发规范（原则 / 测试 / 提交）
├── dependency-cruiser.cjs       # 包边界门禁
└── AGENTS.md                    # 本文件
```

`apps/` 放可运行产品。`packages/` 放库与进程入口：Host / Kernel 的可执行文件是各自 `dist/main.js`。

## 进程与通信

```
Renderer  --IPC-->  Desktop main  --stdio RPC-->  Host  --stdio RPC-->  Kernel
   UI         壳 / 密钥 / spawn         会话与设置              模型与工具
```

- Desktop spawn Host：`packages/host/dist/main.js`，并传入 `--kernel-entry packages/kernel/dist/main.js`。
- Host spawn Kernel。Renderer 只调用 Host RPC（`HostMethods` / `HostEvents`）。
- Kernel 是 Host 拉起的引擎子进程，协议为 stdio JSON-RPC。
- API Key 由 Desktop `safeStorage` 保管，经 Host RPC 下发；`PublicSettings` 只带 `hasOpenaiKey` / `hasAnthropicKey` / `hasDeepseekKey`。

跨包共享面是 `@nuum/protocol`。

## 包职责

| 改动 | 目录 |
|---|---|
| 窗口、托盘、拖拽区、spawn 路径、密钥落盘 | `apps/desktop` |
| 侧栏、对话、输入栏、设置弹层、主题 | `packages/ui`（`apps/desktop/src/renderer` 只挂载） |
| 会话 CRUD、转写、权限预检、设置、工具审批 | `packages/host` |
| 模型路由、turn 循环、工具执行 | `packages/kernel` |
| RPC 方法名、事件、zod 结构 | `packages/protocol` |
| 工具定义与执行 | `packages/tools`、`packages/sandbox` |

侧栏列表实体是 `AgentView`（agent）。

## 允许的依赖方向

由 `pnpm run lint:deps`（`dependency-cruiser.cjs`）检查。允许的边：

- `apps/desktop` → `@nuum/ui`、`@nuum/protocol`
- `packages/host` → `@nuum/protocol`；运行时 spawn Kernel 可执行文件
- `packages/kernel` → `@nuum/protocol`、`@nuum/tools`、`@nuum/sandbox`
- `packages/tools` → `@nuum/protocol`、`@nuum/sandbox`
- `packages/sandbox` → `@nuum/protocol`
- `packages/ui` → `@nuum/protocol`

## 启动与验证

```bash
pnpm install          # Node >= 22，pnpm 10
pnpm dev              # 先编 Host + Kernel，再 electron-vite
pnpm typecheck
pnpm test             # 包测试 + scripts/smoke-host.mjs
pnpm run lint:deps
```

`apps/desktop` 的 `dev` / `preview` 使用 `env -u ELECTRON_RUN_AS_NODE` 启动 Electron。改 UI 后在桌面窗口走通相关路径。

## 当前能力

三进程边界；主键是 agent（一条转录、一份记忆、可互发）；分段 system prompt；SendMessage 是助手唯一对用户出口；支持 Compact 检查点、每 agent workspace、按动作权限、新本地文件/搜索工具，以及每 agent 长驻 `shell` 会话。JSONL 转录保持唯一真源，UI 按因果关系投影出用户消息、agent 互发消息和可折叠工具活动，不维护第二条时间线。
