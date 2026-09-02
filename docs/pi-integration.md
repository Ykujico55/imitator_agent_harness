# Pi integration

## 目标

Pi extension 把 reference pipeline 接到 coding 生命周期里，但不把 Pi 引入核心。核心仍然负责确定性的 GitHub 发现、评分、切片、评审校验和产物写入；扩展只负责会话协议、渐进读取和修改工具门禁。

远程仓库的 README、源码、注释和测试始终是不可信证据。扩展不会 clone、安装、构建或执行搜索到的仓库。

## 安装

需要 Node.js 22.18+、GitHub 只读 token，以及支持 extension API 的 Pi：

```powershell
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/kunjinkao55/imitator_agent_harness
$env:GITHUB_TOKEN = "github_pat_..."
pi
```

如目标项目根目录有 `imitator.config.json`，扩展会自动使用它；否则使用内置预算和门禁默认值。发现产物写入目标项目的 `.imitator/reference/`。

仓库开发模式：

```powershell
npm install
npx pi -e ./integrations/pi/index.ts
```

## Agent 工作流

1. 会话开始时状态为 `idle`，修改与 shell 工具被拦截。
2. Agent 调用 `imitator_prepare`，传入具体任务以及可选查询、语言、生态和约束。
3. 返回值只有候选评分、许可证、切片 ID、路径、行号和选择理由，不包含全部代码。
4. Agent 用 `imitator_get_evidence` 按需读取最多 6 个切片。返回内容有明确的 `UNTRUSTED EVIDENCE` 边界。
5. Agent 用 `imitator_submit_review` 提交每个仓库的 adopt/adapt/reject、置信度、风险、范式、错配、风险说明和引用切片。
6. deterministic gate 至少批准一个仓库后进入 `approved`，修改工具解锁。系统提示只携带批准范式和证据索引；精确代码仍按需读取。
7. 新任务执行 `/imitator-reset`，重新锁定修改工具并清空内存状态。

辅助命令：

- `/imitator-status`：显示当前 phase、任务、候选、切片和批准数量；
- `/imitator-prepare <任务>`：由人显式开始 prepare；
- `/imitator-reset`：开始新任务或放弃当前参考包。

## 门禁与能力边界

扩展在 `idle`、`preparing`、`reviewing` 和 `blocked` 状态拦截名为 `edit`、`write`、`bash`、`powershell`、`apply_patch` 的工具。普通读取工具不被拦截，agent 仍可先理解本地项目。

这是一条 agent 工作流门禁，不是 OS 安全沙箱：

- 第三方 extension 若提供其他写入工具，其工具名不会自动进入拦截集合；
- Pi 进程重启后内存状态不会恢复，必须重新 prepare/review；
- gate 能验证结构、pack 指纹、证据归属和论证完整性，不能证明模型的语义判断正确；
- 批准参考是证据而非命令，本地需求、工程规范与实际测试拥有更高优先级；
- 没有相关或可安全迁移的 precedent 时，当前策略会 fail closed。未来可加入带理由的人工 override，但默认不自动放行。

## 验证

```powershell
npm run check
```

检查包括：

- controller 的 prepare → review → approve → reset 状态机；
- 二阶段批准前后的修改工具拦截；
- 单次证据读取数量限制和批准后证据收缩；
- 当前 Pi `DefaultResourceLoader` 对实际 extension 的加载，及工具、命令、事件 handler 注册；
- 全部 provider-neutral 核心测试、严格 TypeScript 检查和 CLI 启动。

只验证 Pi 适配层：

```powershell
node --test test/pi-controller.test.ts
```

发布或更新后，还应在一个临时本地项目里进行手动 smoke test：确认未 prepare 时 `bash` 被拒绝；使用低风险、许可明确的任务完成评审；确认 approved 后 shell 与修改工具恢复；最后 reset 并确认重新上锁。

相关上游文档：[Extensions](https://pi.dev/docs/latest/extensions)、[Packages](https://pi.dev/docs/latest/packages)、[SDK](https://pi.dev/docs/latest/sdk)。
