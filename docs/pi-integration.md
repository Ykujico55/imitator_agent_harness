# Pi integration

直接照命令完成认证和启动时，请先看 [启动与操作手册](startup.md)。

## 目标与模式

Pi extension 把 provider-neutral 的参考发现、评分、Atlas、语义切片和 Blueprint 能力接入 coding 生命周期。远程 README、源码、注释和测试始终是不可信证据；pipeline 不 clone、安装、构建或执行发现的仓库。

扩展提供两种工作模式：

- `advisory`（默认）：一次自动学习，无人工确认；弱参考或基础设施失败会退回普通编码。
- `strict`（可选）：完整的参考评审、Design Dossier 和两次独立确认；适合审计或高风险任务。

核心不依赖 Pi 或 TypeBox。扩展只负责宿主工具注册、生命周期、状态持久化与有限的 mutation 工具门禁。

## 默认 advisory 工作流

Imitator extension 默认注册两个工具：预编码的 `imitator_learn`，以及仅供视觉任务实现后使用的 `imitator_visual_audit`。这些都属于插件，不修改普通 Pi 核心。Agent 提交完整任务、一个产品目的短语和 1–6 个核心能力，控制器先执行视觉/非视觉路由。

一次调用依次完成：

1. 视觉任务选择插件内的人工作者风格原型、扫描本地样式并生成 `VISUAL_SPEC`，不运行 GitHub discovery。非视觉任务才进入后续仓库步骤。
2. 用户指定参考优先评估，不合适时自动发现；最终学习空间仍限制为 1–2 个仓库。
3. 固定 commit，建立 Atlas、语义切片和 Evidence Bundle。
4. 使用独立的“上下文收益评分”判断这些证据是否值得进入实现会话。
5. 通过时生成紧凑 advisory brief；不通过或发生 GitHub/解析错误时返回 `skip`。
6. 状态进入 `advisory_ready` 或 `bypassed`，两者都释放编码工具，不要求人继续操作。

收益评分不是仓库质量总分。它只回答“现有证据是否足以抵偿上下文和流程成本”，所有加分均为具名信号：

| 信号 | 分值 | 证据要求 |
|---|---:|---|
| `same-core-problem-evidence` | 25 | 领域分至少 60，元数据和实际实现/测试内容均覆盖至少 50% 核心能力 |
| `implementation-test-pair` | 20 | 实际读到实现与测试切片 |
| `behavioral-contract-or-failure` | 15 | contract/invariant/failure 机制证据 |
| `resolved-architecture-relationship` | 15 | Atlas 或切片中的静态关系 |
| `behavioral-test-concept` | 15 | 行为测试角色证据 |
| `multiple-syntactic-or-stronger-observations` | 10 | 至少两个 syntactic 以上切片 |

总分至少 60 仍不够；领域、元数据能力覆盖、代码/测试行为能力覆盖、实现＋测试、机制/关系和最小强证据数量是硬下限。这样能阻止“同语言、零依赖、高 Star、README 关键词”替代同领域机制。

Brief 最多包含五条 syntactic 以上观察和 6000 字符。它保留仓库、commit、许可证、路径、Slice ID 与已知限制，但不含远程源码；实现模型自行把机制适配到本地语言和结构，并用本地行为测试验证。没有证据支持的能力不得从参考补全。

advisory 只在 `idle` 和 `preparing` 阻断当前已知的 `edit`、`write`、`bash`、`powershell`、`apply_patch`，目的是保证单次学习被调用，而不是建立 OS 安全边界。学习返回后不再阻断。视觉审计也不重新锁定编码或要求人确认。

## strict 审计工作流

启动前设置 `IMITATOR_MODE=strict`。此时只注册原有六个工具，不注册 `imitator_learn`：

```text
imitator_prepare
→ imitator_get_evidence_bundle / imitator_get_evidence
→ imitator_submit_review
→ 人或独立 judge 执行 /imitator-confirm
→ imitator_get_semantic_blueprint
→ imitator_submit_design_dossier
→ 人或另一独立 judge 执行 /imitator-confirm
→ approved
```

严格模式中，reviewer 只能引用当前任务实际读过的 Bundle/Slice；Dossier 的非 unknown claim 必须绑定 Blueprint observation 与底层证据，并满足认识论强度和本地映射约束。两次确认绑定任务指纹、reference pack、提案内容和不同身份；实现 agent 不能确认自己的提案。

任务指纹由规范化 TaskSpec、工作区绝对路径和 prepare 时的 Git HEAD 组成。状态带 checksum 写入 `.imitator/pi-state.json`；恢复会重新检查工作流模式、任务/HEAD、证据集合和 gate 绑定。不匹配时拒绝恢复。Checksum 用于发现损坏或普通误改，不是抵抗恶意本地进程的签名。

严格模式的主要产物包括 `review-proposal/`、`reference-approved/`、`design-proposal/` 与 `approved/`。最终 `APPROVED_AGENT_CONTEXT.md` 只含本地化设计契约，不含远程源码。

## 安装与命令

```powershell
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/kunjinkao55/imitator_agent_harness
$env:GITHUB_TOKEN = "github_pat_..."
pi
```

本地开发：

```powershell
npm install
npx pi --no-extensions -e ./integrations/pi/index.ts
```

辅助命令：

- `/imitator-status`：显示 mode、phase、学习决定、分数、候选与证据数量；
- `/imitator-doctor`：按当前模式验证 tool registry、hooks 和持久 store；
- `/imitator-reset`：清除当前任务状态；
- `/imitator-prepare`、`/imitator-confirm`：仅 strict 模式执行工作；advisory 模式会提示无需操作。

## 能力与安全边界

- 这是 agent 工作流控制，不是 OS 沙箱；第三方 extension 的未知写工具不会自动进入 deny-list。
- 静态评分、Atlas、Bundle 和 Blueprint 不能证明运行时行为、测试通过或作者真实意图。
- advisory 的 `skip` 是有意的基线回退：参考学习不是编码正确性的安全门禁，本地需求与测试始终是最终约束。
- strict 仍 fail closed，适用于不能接受自动回退的流程。
- 用户明显换题时应执行 `/imitator-reset`；系统不能完美从自然语言判断任务边界。
- 参考入选不等于获得代码复制、再分发或安装授权，许可证和风险始终单独保留。

## 验证

```powershell
npm run check
```

检查覆盖插件双工具注册、视觉任务不触发远程 discovery、一次 learn/skip 状态机、视觉路由具名信号、风格规格/审计预算、失败自动 bypass、持久恢复，以及 strict 六工具/双确认兼容性。只运行相关适配层：

```powershell
node --test test/advisory.test.ts test/visual.test.ts test/pi-controller.test.ts
```

发布后应在临时项目做真实 smoke：默认模式确认第一次写操作触发一次学习，`advisory_ready`/`bypassed` 后自动编码；strict 模式另行确认两层 gate 在批准前持续拦截。
