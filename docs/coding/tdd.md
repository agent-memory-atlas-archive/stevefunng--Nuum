# 测试

本仓测试栈是 `node:test` + `tsx --test`，文件与源码同目录，命名 `*.test.ts`。根脚本 `pnpm test` 会跑各包测试，再跑 `scripts/smoke-host.mjs`。

改行为时按这个顺序：

1. 先写一条当前会失败的测试（或复现脚本），确认失败原因是功能还缺。
2. 用最少代码让它通过。
3. 在绿灯下再整理实现。

测对外行为：protocol 帧、Host 方法、Kernel turn、工具结果。UI 在已启动的桌面窗口里把相关路径点一遍。

契约层用现有位置：

- 包内单测：`packages/<name>/src/**/*.test.ts`
- Host stdio：`scripts/smoke-host.mjs`
- 边界：`pnpm run lint:deps`
- 类型：`pnpm typecheck`

纯文案、只改颜色间距、用户明确只要看一眼的改动，用窗口或 typecheck 收口即可。
