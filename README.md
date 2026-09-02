# Imitator Agent Harness

在 coding agent 动手前，先从 GitHub 找到相近领域的成熟实现，把“可迁移的工程范式”压缩成一个有边界、有出处、可审计的参考包。

这不是代码复制器，也不是“按 Star 排序后把整个仓库塞进上下文”。它实现的是一个保守的 precedent pipeline：

```text
任务 → 多查询召回 → 仅读取仓库画像 → 六维评分/许可证门禁
     → 路径与窗口级切片 → 结构化二阶段评审 → 准入 gate → 本地 coding agent
```

## 已实现的 MVP

- GitHub Repository API 多查询检索、去重和并发画像。
- 领域匹配、工程成熟度、可迁移性、范式清晰度、设计合理性、风险六维可解释评分。
- 默认宽松许可证 allowlist；无许可证仓库不会进入参考上下文。
- 路径排序与固定行数窗口切片，总文件数、切片数和字符数均受预算限制。
- 默认证据池支持 4 个仓库、每仓库 12 个文件、总计 48 个切片和 12 万字符；类别配额会随项目规模动态扩展。
- 每个切片保留仓库、许可证、分支、文件、行号和 GitHub 链接。
- 每个切片固定到 commit SHA，并拥有稳定证据 ID。
- 输出 `manifest.json`、`REFERENCE.md`、`AGENT_CONTEXT.md`、`REVIEW_REQUEST.json` 和 fail-closed 的 `REVIEW_TEMPLATE.json`。
- 人或任意模型可填写结构化评审；gate 校验 pack 指纹、证据归属、置信度、风险、范式、错配和风险说明。
- gate 只输出明确批准且被引用的切片，未评审推断不会进入最终 agent 上下文。
- 提供 Pi extension：自动注入工作协议，在 precedent 二阶段评审通过前拦截 `edit`、`write`、`bash`、`powershell` 和 `apply_patch`。
- Pi 通过三个渐进式工具完成搜索、按 ID 读取最多 6 个证据切片、提交结构化评审；不会把整份参考包直接塞进会话。
- 不 clone、不安装、不构建、不执行上游内容；远程文本永远按不可信数据处理。
- provider-neutral 核心零运行时依赖，Node.js 22.18+ 可直接运行 TypeScript；Pi 与 TypeBox 只作为扩展宿主 peer 和开发期兼容性测试依赖。

## 快速开始

GitHub 未认证访问额度很低，建议设置只读 token：

```powershell
$env:GITHUB_TOKEN = "github_pat_..."
node src/cli.ts prepare `
  --task "给 TypeScript coding agent 增加可插拔工具和安全策略" `
  --query "coding agent extension architecture" `
  --language TypeScript
```

输出位于 `.imitator/reference/<timestamp>/`。先检查 `REVIEW_REQUEST.json`，复制并填写 `REVIEW_TEMPLATE.json`，再执行：

```powershell
node src/cli.ts gate `
  --manifest ".imitator/reference/<timestamp>/manifest.json" `
  --decisions ".imitator/reference/<timestamp>/REVIEW_TEMPLATE.json"
```

最终只把 `approved/APPROVED_AGENT_CONTEXT.md` 和按需选中的 `approved/APPROVED_REFERENCE.md` 片段交给 Pi、Codex 或其他 agent。

## 接入 Pi coding agent

推荐以 Pi package 安装薄扩展，不 fork agent core：

```powershell
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/kunjinkao55/imitator_agent_harness
```

在目标项目中设置 `GITHUB_TOKEN` 后启动 `pi`。扩展会要求 agent 依次调用：

1. `imitator_prepare`：为当前任务检索、评分和切片；
2. `imitator_get_evidence`：只读取当前决策所需的少量切片；
3. `imitator_submit_review`：提交带证据 ID 的 adopt/adapt/reject 决策。

至少一个仓库通过确定性二阶段 gate 后，Pi 的修改与命令工具才会解锁。可用 `/imitator-status` 查看状态，开始新任务前用 `/imitator-reset` 重新上锁；也可用 `/imitator-prepare <任务>` 手动开始检索。

本地开发时无需安装 package：

```powershell
npm install
npx pi -e ./integrations/pi/index.ts
```

更完整的操作步骤、安全边界和测试方式见 [Pi 接入说明](docs/pi-integration.md)。Pi 扩展机制和 package 安装方式以 [Pi Extensions](https://pi.dev/docs/latest/extensions) 与 [Pi Packages](https://pi.dev/docs/latest/packages) 为准。

可复制示例配置：

```powershell
Copy-Item imitator.config.example.json imitator.config.json
node src/cli.ts prepare --task "..." --config imitator.config.json
```

运行测试：

```powershell
npm test
```

## 评分不是裁判

Star 只占成熟度的一部分。通过门禁还需要领域信号、测试/CI/文档、清晰的工程边界、允许迁移的许可证，以及可接受的维护和供应链风险。当前评分是确定性启发式算法，原因全部写入 manifest，适合作为第一阶段粗排；它不应替代人或强模型的第二阶段设计审查。

## 为什么核心仍独立于 Pi

Pi 只是一层薄适配器：“参考发现”和 deterministic gate 仍是可测试、无模型绑定的核心。适配器仅管理会话状态、渐进读取和修改工具门禁，因此同一核心仍可继续支持 Codex、Claude Code 和 CI。

## 当前边界与后续演进

见 [架构与路线图](docs/architecture.md)。当前已经实现 provider-neutral 的结构化二阶段协议和 Pi 薄适配器，但不内置任何模型调用；评审质量仍取决于执行评审的人或 agent。后续重点是 GitHub App 权限模型、语义切片/去重、项目本地规范匹配、跨会话状态，以及真实任务 A/B eval。
