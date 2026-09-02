# Imitator Agent Harness

在 coding agent 动手前，先从 GitHub 找到相近领域的成熟实现，再把其中的架构判断、规格约束、失败语义和测试思想压缩成一份有边界、有出处、可审计的 Design Dossier。实现 agent 学习的是优秀作品在约束下做决定的方式，而不是它的语言、目录或代码形状。

这不是代码复制器，也不是“按 Star 排序后把整个仓库塞进上下文”。它实现的是一个保守的 precedent pipeline：

```text
任务 → 多查询召回 → 仅读取仓库画像 → 六维评分/许可证门禁
     → 选出 1 个主蓝图（最多 1 个补充蓝图）→ AST/窗口切片
     → 参考选择 proposal → 独立确认
     → Design Dossier → 独立确认 → 本地适配契约 → coding agent
```

## 已实现的 v0.6 工作流

- GitHub Repository API 多查询检索、去重和并发画像。
- 领域匹配、工程成熟度、可迁移性、范式清晰度、设计合理性、风险六维可解释评分。
- 默认宽松许可证 allowlist；无许可证仓库不会进入参考上下文。
- 路径排序与固定行数窗口切片，总文件数、切片数和字符数均受预算限制。
- 最终证据空间硬限制为 1–2 个同领域仓库、每仓库最多 12 个文件、总计 48 个切片和 12 万字符；其余搜索候选不会进入 agent 的学习空间。
- 默认自动发现最合适的仓库。用户也可显式指定最多两个 GitHub 仓库或 revision：指定项先走同一套领域、成熟度、许可证和风险评估；通过则优先，未通过会明确报告原因并自动回退到默认搜索。
- 每个切片保留仓库、许可证、分支、文件、行号和 GitHub 链接。
- 每个切片固定到 commit SHA，并拥有稳定证据 ID。
- 输出 `manifest.json`、`REFERENCE.md`、`AGENT_CONTEXT.md`、`REVIEW_REQUEST.json` 和 fail-closed 的 `REVIEW_TEMPLATE.json`。
- 人或任意模型可填写结构化评审；gate 校验 pack 指纹、证据归属、置信度、风险、范式、错配和风险说明。
- gate 只输出明确批准且被引用的切片，未评审推断不会进入最终 agent 上下文。
- 提供 Pi extension：自动注入工作协议，在参考选择和 Design Dossier 双重门禁通过前拦截 `edit`、`write`、`bash`、`powershell` 和 `apply_patch`。
- Pi 通过四个渐进式工具完成搜索、按 ID 读取最多 6 个证据切片、提交结构化评审和设计蒸馏；不会把整份参考包直接塞进会话。
- 任务指纹绑定规范化任务、工作区路径和 prepare 时的 Git HEAD；Pi 状态带完整性校验持久化到 `.imitator/pi-state.json`，重启可恢复，基线变化则 fail closed。
- Coding agent 的评审只是 proposal；必须由 `/imitator-confirm` 的交互式人工确认，或隔离的独立 judge 身份确认后才能解锁。
- 参考确认只会进入 `distilling`，不会解锁编码；agent 还必须提交 evidence-bound、语言无关的 Design Dossier。
- Dossier 强制描述本地约束/既有惯例/质量属性、设计原则、架构职责与失败模式、规格、测试 oracle、适用与失效条件、权衡、negative space，以及逐项 adopt/adapt/reject 的本地映射。
- 每个参考派生概念必须引用已批准证据；所有已确认仓库都必须被解释，所有概念都必须有本地决策，非 reject 项必须有目标路径和验收测试。
- Dossier 有 8 万字符及分区数量硬预算；最终 agent context 只含抽象设计契约，不含远程源码或证据 ID。Design 批准后，Pi 也不再向实现 agent 返回原始远程切片。
- Dossier 先写入 `design-proposal/` 供人工或 judge 审阅；只有不同身份的第二次确认后才进入最终 `approved/` 并解锁。
- Pi 对 TypeScript/JavaScript 使用 compiler AST 选择完整接口、类型、类、函数或测试单元；其他语言确定性回退到行窗口。
- 提供默认不执行的真实模型 paired A/B eval runner，对比 baseline 与 Imitator + 独立 judge，并记录验收通过率、耗时和变更文件数。
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

可选地优先评估用户指定蓝图；支持 `owner/repo`、GitHub URL 和 `@branch|tag|commit`：

```powershell
node src/cli.ts prepare `
  --task "实现可插拔 coding agent 工具系统" `
  --reference "owner/preferred-agent@v2.0.0" `
  --language TypeScript
```

指定仓库通过时会占据学习集合的最高优先级；失败时 CLI/Pi 会输出具体拒绝原因并继续自动发现。所有实际读取都固定到解析后的 commit SHA。

输出位于 `.imitator/reference/<timestamp>/`。先检查 `REVIEW_REQUEST.json`，复制并填写 `REVIEW_TEMPLATE.json`，再执行第一阶段确定性 gate：

```powershell
node src/cli.ts gate `
  --manifest ".imitator/reference/<timestamp>/manifest.json" `
  --decisions ".imitator/reference/<timestamp>/REVIEW_TEMPLATE.json"
```

CLI 的 `gate` 只验证参考选择，不代表最终授权编码。完整的任务指纹、两次独立确认、Design Dossier 与修改门禁目前由 Pi 集成承载；provider-neutral 核心同时导出了相同的评估、确认和产物 API，供其他 agent harness 接入。

## 接入 Pi coding agent

推荐以 Pi package 安装薄扩展，不 fork agent core：

```powershell
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/kunjinkao55/imitator_agent_harness
```

在目标项目中设置 `GITHUB_TOKEN` 后启动 `pi`。扩展会要求 agent 依次完成：

1. `imitator_prepare`：为当前任务检索、评分和切片；
2. `imitator_get_evidence`：只读取当前决策所需的少量切片；
3. `imitator_submit_review`：提交带证据 ID 的 adopt/adapt/reject proposal；
4. 人在 Pi 中第一次执行 `/imitator-confirm`，检查任务指纹和仓库；
5. `imitator_submit_design_dossier`：把已确认证据蒸馏为跨语言设计规格和本地适配图；
6. 人检查 `design-proposal/DESIGN_DOSSIER.md`，再次执行 `/imitator-confirm` 才解锁编码。

`imitator_prepare` 可额外接收 `referenceRepositories: [{ repository, revision? }]`。即使自动搜索检查了更多候选，后续 evidence、review、dossier 和 implementation context 也只允许来自最终 1–2 个仓库。

至少一个仓库通过选择门禁、且 Design Dossier 通过确定性校验和独立确认后，Pi 的修改与命令工具才会解锁。可用 `/imitator-status` 查看状态，开始新任务前用 `/imitator-reset` 重新上锁；也可用 `/imitator-prepare <任务>` 手动开始检索。

本地开发时无需安装 package：

```powershell
npm install
npx pi -e ./integrations/pi/index.ts
```

更完整的操作步骤、安全边界和测试方式见 [Pi 接入说明](docs/pi-integration.md)。Pi 扩展机制和 package 安装方式以 [Pi Extensions](https://pi.dev/docs/latest/extensions) 与 [Pi Packages](https://pi.dev/docs/latest/packages) 为准。

## 真实模型 A/B eval

仓库自带一个无运行时依赖的 retry-queue 小型失败 fixture；也可以复制并修改 `eval-suite.example.json`，指向自己的本地、可复制、带确定性验收命令的小项目。默认命令只打印计划，不调用模型或执行测试：

```powershell
npm run eval:pi -- --suite eval-suite.example.json --provider <provider> --model <model>
```

确认计划、预计调用数、模型认证和本地验收命令后，才显式加入 `--execute`。Imitator 组最多使用参考 proposal、参考 judge、设计蒸馏、设计 judge、implementation 五次调用，baseline 使用一次调用。完整协议见 [真实模型评估说明](docs/evaluation.md)。

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

见 [Design Dossier 协议](docs/design-dossier.md) 与 [架构和边界](docs/architecture.md)。当前已经实现 provider-neutral 的结构化协议、Pi 双重持久门禁、人工/独立 judge 确认、TS/JS AST 切片和五阶段 paired A/B eval。尚未产生真实模型实验数据；未知名称的第三方修改工具按此前范围选择暂未纳入门禁。后续重点是更多语言 parser、自动提取本地规范、可靠的任务切换检测和 30–50 个真实任务的重复实验。
