# Proactive mode 基座

本期范围：Host 生命周期与策略、macOS 菜单栏控制面板。尚未接入真实上下文采集、模型评估、行动提案或自动执行。开启后没有来源时保持“等待接入上下文”，不发模型请求，也不读取屏幕、剪贴板或文件。

## 实体与真源

- 首次开启时创建一个普通持久 Nu-nu 实体，拥有正常的 profile、workspace、memory、transcript。随机 UUID；不靠名称识别。
- `AgentSettings.proactive` 是该成员的唯一策略真源。`isDefault` 只选择本期 UI 默认承载者，不作为能力权限判断条件。
- 所有 Host 操作按 `agentId` 寻址，省略时解析默认成员；未来对其他 Nu-nu 展示同一配置入口即可，不需要复制执行器或修改主键。
- 更新使用 `expectedRevision` 拒绝过期写入。开启、关闭、暂停截止时间与来源白名单重启后保留。运行中的检查及错误状态只存在内存。
- `proactive-activity.json` 是每成员最多 50 条的状态活动记录，不是聊天时间线，也不是策略来源。它只保存状态和 opaque context refs，不保存上下文正文。

## Host 接线

`proactive.get` 返回成员策略、派生状态、最近活动、可用来源及行动能力可用性。

`proactive.configure` 接收 agentId（可省略）、expectedRevision，以及 enabled / pausedUntil / sourceIds / intervalMs。首次创建默认成员只发生在明确配置操作，不会在列表读取或启动时出现。

`proactive.check` 手动检查指定成员；有 5 秒防连点冷却，同一成员最多一个进行中的检查，单次上限 10 秒。重复请求复用进行中的检查，冷却内返回最近状态，不报错，也不追加重复活动。

`ProactiveService.registerSource` 注册 Host 侧上下文 adapter。只有策略中明确配置的来源会被调用。adapter 接收 agentId 与 AbortSignal，返回不含敏感正文的引用。当前没有注册产品来源。该接口本期只在测试中验证，不能由 Renderer 传入任意可执行 collector。

启用并有完整可用来源时，Host 按成员 intervalMs 检查（默认 5 分钟，范围 1 分钟至 1 小时）。没有来源时不反复记录空检查。暂停到期自动恢复，不补跑睡眠或退出期间错过的周期。关闭或改策略会取消进行中的检查，并丢弃过期 revision 的结果。

目前处理在 context refs 处停止，结果标明“上下文已就绪，行动能力尚未接入”。后续评估/提案层应消费独立上下文 envelope，经审批策略后以 `RunContext.kind = proactive` 提交现有 AgentScheduler；不要伪装为直接用户聊天。现有 proactive 运行域的工具隔离继续保留；本期未放行任何新工具。

## Desktop 与 UI

- macOS template 图标：空心表示关闭/暂停，实心表示开启。tooltip 显示状态。
- 左击打开 368px 控制面板；右击提供面板、打开 Nuum、退出。浮层失焦收起，位置约束在所在显示器内。
- 面板提供启停、暂停 30 分钟/1 小时、恢复、检查基座、最近活动、打开对应 Nu-nu。
- 主窗口关闭时隐藏，Host 与菜单栏继续运行。Dock 或面板可重新打开主窗口；退出 Nuum 才清理菜单栏、Host、Kernel。
- 默认关闭；不注册开机启动。语言和主题与设置共用，跨窗口通过 settings.updated 同步。

## 下一轮需要确定

1. Context：可用来源、授权入口、采样与事件触发策略、去重、保留期限、敏感内容排除。
2. Decision：何时安静、何时提醒；置信度、预算、冷却和可解释的触发原因。
3. Actions：首批允许的行动、提案/批准/执行状态机、工具白名单、撤销与审计。

以上未决项不会以默认全盘读取或自动执行的方式提前开放。

## 已验证

Host 测试覆盖：默认实体幂等创建、旧 revision 拒绝、按成员隔离、暂停到期、关闭阻断检查、检查中关闭丢弃结果、真实 store 重新加载恢复策略与活动、定时触发仅调用显式来源且不写入聊天转录。
