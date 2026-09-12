# Imitator Agent Harness

领域筛选修复：使用任务专属的产品职责/能力描述，不再以语言、零依赖等工程属性推断领域。Pi 自动生成描述，CLI 支持 `--domain-file`；旧审批需重新评审。详见 [领域提取与评审约束](docs/domain-fit.md)。

在 coding agent 动手前，先从 GitHub 找到相近领域的成熟实现，再把其中的架构判断、规格约束、失败语义和测试思想压缩成一份有边界、有出处、可审计的 Design Dossier。实现 agent 学习的是优秀作品在约束下做决定的方式，而不是它的语言、目录或代码形状。

这不是代码复制器，也不是“按 Star 排序后把整个仓库塞进上下文”。它实现的是一个保守的 precedent pipeline：

```text
任务 → 任务绑定的领域描述 → 多查询召回 → 仅读取仓库画像 → 六维评分/独立许可证策略
     → 选出 1 个主蓝图（最多 1 个补充蓝图）→ Repository Design Atlas
     → 结构覆盖门禁 → Atlas 引导的 AST/窗口切片
     → 多模态 Evidence Bundle（关系、限制、认识论上限）
     → 证据收益门槛 → 有收益则压缩为紧凑 advisory brief
                         无收益或发现失败则静默跳过
     → coding agent（本地需求与测试始终优先）

可选 strict 模式：参考选择 proposal → 独立确认 → Design Dossier → 独立确认 → coding agent
```

## 已实现的 v0.8 工作流

- GitHub Repository API 多查询检索、去重和并发画像。
- 搜索得到候选但画像请求因限额或网络错误全部失败时会 fail closed，不会把基础设施失败报告成“没有合适参考”。
- 领域匹配、工程成熟度、可迁移性、范式清晰度、设计合理性、风险六维可解释评分。
- 许可证默认仅警告（`acceptance.licensePolicy: "warn"`），不影响技术评分；缺失或非白名单许可证不再单独阻断设计学习。可设为 `"allowlist"` 恢复严格准入。参考入选不代表获得复制、再分发或安装授权。
- 路径排序与固定行数窗口切片，总文件数、切片数和字符数均受预算限制。
- 最终证据空间硬限制为 1–2 个同领域仓库、每仓库最多 12 个文件、总计 48 个切片和 12 万字符；其余搜索候选不会进入 agent 的学习空间。
- 未通过结构覆盖门禁的候选只保留评分记录供审计，其 Atlas、切片和 Evidence Bundle 不会进入学习空间。
- 对初筛通过的仓库生成 commit-pinned Repository Design Atlas：索引 manifest、模块根、入口、设计文档、测试、CI，并在固定读取预算内解析 Node manifest 与 TS/JS 相对 import/test 关系。
- Atlas 用 overview、design、manifest、source、test、automation、relationships 七个命名信号计算可解释覆盖分；默认要求源码和测试证据且至少 50 分，不足的仓库不会进入切片与评审阶段。
- Atlas 中存在文件路径还不够：配置要求的 source/test 等类别必须最终形成可读切片；限额或读取错误导致关键模态缺失时整次 prepare 会 fail closed 并报告原因。
- Atlas coverage 与 `analysisQuality` 已分离：前者确认必要模态读到，后者用 textual→syntactic→resolved→corroborated 五级和七个具名信号描述语义证据强度。质量分仅供观察和 judge 识别负空间，不进入六维技术总分。
- Atlas 只保存带仓库、revision、许可证、路径和链接的结构事实；它用于发现关系和指导检索，不能替代切片对设计意图的举证。
- 切片之后会按系统架构、模块边界、技术选型、测试策略和失败语义编译 Evidence Bundle；每个包至少包含配置要求的多种证据类型，并保留 Atlas 关系、来源、许可证和已知限制。
- Evidence Bundle 有 `explicit` 或 `observed` 认识论上限：只有 ADR/RFC/architecture/design 类明确文档支持的包才允许主张作者的显式意图；其余关系只能作为观察事实或受限推断。
- 默认自动发现最合适的仓库。用户也可显式指定最多两个 GitHub 仓库或 revision：指定项先走同一套领域、成熟度、许可证和风险评估；通过则优先，未通过会明确报告原因并自动回退到默认搜索。
- 每个切片保留仓库、许可证、分支、文件、行号和 GitHub 链接。
- 每个切片固定到 commit SHA，并拥有稳定证据 ID。
- 输出 `manifest.json`、`DESIGN_ATLAS.json/.md`、`EVIDENCE_BUNDLES.json/.md`、`REFERENCE.md`、`AGENT_CONTEXT.md`、`REVIEW_REQUEST.json` 和 fail-closed 的 `REVIEW_TEMPLATE.json`。
- 人或任意模型可填写结构化评审；gate 校验 pack 指纹、证据归属、置信度、风险、范式、错配和风险说明。
- gate 以 Evidence Bundle 为评审边界，只输出明确批准且被引用的包及其完整内部证据；伪造包、跨仓库引用和包外切片都会被拒绝。
- Imitator extension 默认暴露 `imitator_learn` 和视觉任务专用的 `imitator_visual_audit`；普通 Pi 核心不受影响。前者完成一次路由和学习，后者只在视觉实现后运行有界静态检查，全程无需人工确认。
- 视觉任务不会从任意 GitHub 高星项目猜测美感：插件按具名任务信号选择六个内置、可审计但尚待真实视觉实验校准的 seed 风格原型，从本地 CSS/Tailwind/theme/组件源码提取已有视觉语法，并生成不超过 6000 字符的 `VISUAL_SPEC`。
- 视觉审计检查纯黑 surface、边框/卡片饱和、统一圆角、字体层级、响应式证据、渐变方向和颜色 token 扩散；最多一次修复和一次复审。它不执行项目，也不冒充像素级审美判断。
- advisory 收益门槛要求元数据与实际 implementation/test 内容都覆盖至少 50% 核心能力、存在实现/测试配对、机制或关系证据和至少两个 syntactic 以上切片；所有加分均为具名信号并有测试。弱参考、无参考、GitHub 限额或解析错误不会制造审批循环，而是回退到普通 Pi。
- 注入上下文限制为最多 5 条高价值观察和 6000 字符，保留仓库、commit、许可证、路径、证据 ID 与限制，不包含远程源码。
- 任务指纹绑定规范化任务、工作区路径和 prepare 时的 Git HEAD；Pi 状态带完整性校验持久化到 `.imitator/pi-state.json`，并额外绑定工作流模式。
- 可显式设置 `IMITATOR_MODE=strict` 恢复完整审计流：六个渐进工具、参考 proposal、第一次独立确认、Semantic Blueprint、evidence-bound Design Dossier 和第二次独立确认。
- Dossier 强制描述本地约束/既有惯例/质量属性、设计原则、架构职责与失败模式、规格、测试 oracle、适用与失效条件、权衡、negative space，以及逐项 adopt/adapt/reject 的本地映射。
- 每个参考派生概念必须引用已批准证据，并由 `explicit`、`observed`、`inferred` 或 `unknown` 主张解释；推断必须记录限制且置信度不高于 0.8，未知不能作为实现概念的唯一依据。
- Dossier 有 8 万字符及分区数量硬预算；最终 agent context 只含抽象设计契约，不含远程源码或证据 ID。Design 批准后，Pi 也不再向实现 agent 返回原始远程切片。
- strict 模式下 Dossier 先写入 `design-proposal/` 供人工或 judge 审阅；只有不同身份的第二次确认后才进入最终 `approved/` 并解锁。
- Pi 通过可扩展的逐文件路由选择 Python、Rust 或 TypeScript/JavaScript 深度适配器；解析观察直接驱动契约、数据、失败、扩展点与测试的多角色完整切片。未知、冲突或没有完整语义单元的文件确定性回退到行窗口，并保留选路和实际降级原因。
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

CLI 的 `gate` 只验证参考选择，不代表最终授权编码。默认 Pi 使用一次 advisory 学习；完整的任务指纹、两次独立确认、Design Dossier 与持续修改门禁由可选 strict 模式承载。provider-neutral 核心同时导出相同的评估、确认和产物 API，供其他 agent harness 接入。

## 接入 Pi coding agent

推荐以 Pi package 安装薄扩展，不 fork agent core：

```powershell
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/kunjinkao55/imitator_agent_harness
```

在目标项目中设置 `GITHUB_TOKEN` 后启动 `pi`，然后直接发送完整开发任务。默认预编码流程只有一次自动工具调用：

1. Agent 可先用只读工具理解本地项目；
2. `imitator_learn` 提交任务、产品目的和 1–6 个核心能力；
3. 非视觉任务自动生成 repository `learn` 或 `skip` 决定；视觉任务由插件生成内置风格 `VISUAL_SPEC`，不调用远程仓库；
4. Pi 立即继续实现和测试，不需要 `/imitator-confirm`；视觉任务实现后额外调用一次 `imitator_visual_audit`，必要时只修复并复审一次。

`imitator_learn` 可额外接收 `referenceRepositories: [{ repository, revision? }]`。即使自动搜索检查了更多候选，最终 brief 也只允许来自 1–2 个通过收益门槛的仓库。

可用 `/imitator-status` 查看 mode、phase、决定和分数，用 `/imitator-doctor` 检查注册/hook/store 健康，换任务前用 `/imitator-reset`。若确实需要原来的双重确认，启动前设置 `$env:IMITATOR_MODE = "strict"`（Bash 为 `export IMITATOR_MODE=strict`）。

本地开发时无需安装 package：

```powershell
npm install
npx pi -e ./integrations/pi/index.ts
```

从认证、默认单次学习到可选 strict 审计的完整命令见 [启动与操作手册](docs/startup.md)；集中能力与拒绝边界见 [项目能力边界](docs/capability-boundaries.md)；更完整的集成原理、安全边界和测试方式见 [Pi 接入说明](docs/pi-integration.md)。Pi 扩展机制和 package 安装方式以 [Pi Extensions](https://pi.dev/docs/latest/extensions) 与 [Pi Packages](https://pi.dev/docs/latest/packages) 为准。

## 真实模型 A/B eval

先手动对照时，使用 [普通 Pi / 增强 Pi 对照提示词流](docs/pi-ab-prompt-flow.md)：包含可复制任务、两组分阶段提示、独立评审、盲评及成本记录；不需要先改 runner。

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

Star 只占成熟度的一部分。通过门禁还需要领域信号、测试/CI/文档、清晰的工程边界，以及可接受的维护和供应链风险。许可证作为独立使用限制提示，默认不计入可迁移性、风险或总分；严格模式另行检查白名单。当前评分是确定性启发式算法，原因全部写入 manifest，适合作为第一阶段粗排；它不应替代人或强模型的第二阶段设计审查。

## 为什么核心仍独立于 Pi

Pi 只是一层薄适配器：“参考发现”和 deterministic gate 仍是可测试、无模型绑定的领域核心。这里的 core 表示 provider-neutral domain core，而不是不包含产品策略的通用 kernel：评分、许可证和审批规则属于 Imitator 的核心价值；Pi/TypeBox 和宿主生命周期则严格留在 `integrations/`。适配器仅管理会话状态、渐进读取和修改工具门禁，因此同一核心仍可继续支持 Codex、Claude Code 和 CI。

## 当前边界与后续演进

Python 参考学习已增加可选的标准库 AST/TOML/INI 解析：读到内容才计算覆盖，源码/实际测试保底，条件导入与歧义保真，以及字段、协议/抽象类、导出、fixture 候选和 Poetry/setup.cfg 规格提取。Pi 需要可用的 Python 3.11+；不可用时明确降为 textual evidence，必要模态不足仍会阻断参考。配置和限制见 [Python 参考学习](docs/python-learning.md)。

Rust 参考学习已增加 dependency-free 静态语义分析：trait/impl、数据结构、可见性、错误/unsafe 信号、cfg/module/use、内嵌 `#[test]` 与 Cargo 规格进入 Atlas 和完整声明切片；不要求本机 Rust，也绝不编译或执行参考。配置和边界见 [Rust 参考学习](docs/rust-learning.md)。

源码语义入口现在由显式逐文件路由管理，支持多语言仓库、失败不串 parser、歧义 fail closed，并为后续语言保留 `SourceLanguageAdapter` 注册插槽。详见 [源码语义路由](docs/source-routing.md)。

解析能力不会直接奖励仓库设计分。独立的语义证据质量层将可读内容、完整语法单元、静态关系和实现—测试交叉印证分开记录，并修复“增强语言解析失败就像没有内容、普通语言非空就通过”的覆盖不对称。详见 [语义证据质量](docs/semantic-evidence-quality.md)。

见 [视觉风格学习与审计](docs/visual-style.md)、[Design Dossier 协议](docs/design-dossier.md)、[Reference Semantic Blueprint](docs/semantic-blueprint.md) 与 [架构和边界](docs/architecture.md)。当前已经实现 provider-neutral 的结构化协议、Repository Design Atlas、Evidence Bundle、事实/观察/推断/未知分级、插件内视觉路由与静态审计、默认 advisory 学习、可选 Pi 双重持久门禁、逐文件语义路由、TS/JS、可选 Python AST 和 Rust 静态语义切片及 paired A/B eval。尚未证明像素级审美或真实模型质量收益；参考观察到本地代码的映射继续由 coding model 与本地测试完成。
