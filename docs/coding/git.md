# 提交

用户明确要求提交时才 `git commit`。默认不 push。

标题：`type(scope): 中文说明`。scope 用本仓包名：`desktop` / `ui` / `host` / `kernel` / `protocol` / `tools` / `sandbox`。

type：`feat` 新能力，`fix` 修行为，`refactor` 同行为整理，`test` 测试，`docs` 文档，`chore` 工具与配置。

正文写三块：

```
背景：为什么要改
改动：动了哪几处
验证：实际跑过的命令
```

验证写真实执行过的，例如 `pnpm test`、`pnpm run lint:deps`、桌面窗口里点过哪条路径。
