# Imitator Agent Harness

在 coding agent 动手前，先从 GitHub 找到相近领域的成熟实现，把“可迁移的工程范式”压缩成一个有边界、有出处、可审计的参考包。

这不是代码复制器，也不是“按 Star 排序后把整个仓库塞进上下文”。它实现的是一个保守的 precedent pipeline：

```text
任务 → 多查询召回 → 仅读取仓库画像 → 六维评分/许可证门禁
     → 路径与窗口级切片 → 参考文档 + agent 约束 → 本地 coding agent
```

## 已实现的 MVP

- GitHub Repository API 多查询检索、去重和并发画像。
- 领域匹配、工程成熟度、可迁移性、范式清晰度、设计合理性、风险六维可解释评分。
- 默认宽松许可证 allowlist；无许可证仓库不会进入参考上下文。
- 路径排序与固定行数窗口切片，总文件数、切片数和字符数均受预算限制。
- 每个切片保留仓库、许可证、分支、文件、行号和 GitHub 链接。
- 输出 `manifest.json`、人读的 `REFERENCE.md` 和 agent 用的 `AGENT_CONTEXT.md`。
- 不 clone、不安装、不构建、不执行上游内容；远程文本永远按不可信数据处理。
- 零运行时依赖，Node.js 22.18+ 可直接运行 TypeScript；TypeScript 仅作为开发期严格检查工具。

## 快速开始

GitHub 未认证访问额度很低，建议设置只读 token：

```powershell
$env:GITHUB_TOKEN = "github_pat_..."
node src/cli.ts prepare `
  --task "给 TypeScript coding agent 增加可插拔工具和安全策略" `
  --query "coding agent extension architecture" `
  --language TypeScript
```

输出位于 `.imitator/reference/<timestamp>/`。将其中的 `AGENT_CONTEXT.md` 和按需选中的 `REFERENCE.md` 片段交给 Pi、Codex 或其他 agent 即可。不要默认注入全部切片。

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

## 为什么先独立于 Pi

Pi 的 extension/SDK 形态很适合接入，但“参考发现”本身应该是可测试、无模型绑定的核心。首版先生成通用 reference pack；下一层适配器只负责在 coding 生命周期的 `before task` 阶段调用本工具，并把预算内上下文注入会话。这样更容易同时支持 Pi、Codex、Claude Code 和 CI。

## 仍需演进

见 [架构与路线图](docs/architecture.md)。最重要的下一步是 GitHub App 权限模型、基于 commit SHA 的可复现固定、LLM judge 的结构化二阶段复核、语义切片/去重、项目本地规范匹配，以及真实任务 A/B eval。
