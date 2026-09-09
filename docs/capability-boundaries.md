# 项目能力边界

本文集中描述当前实现可以建立的证据、不能建立的结论，以及各阶段的拒绝条件。实现细节仍以 architecture、source-routing、Python/Rust learning 和 Design Dossier 文档为准。

## 信任与执行边界

- 发现源仅为 GitHub API。发现流程只读取仓库元数据、commit 固定的 tree 和有限文本，不 clone、install、build 或执行上游仓库。
- 递归 tree 被 GitHub 标为 truncated 时直接拒绝画像；仓库名、路径、revision、元数据形状和 base64 内容在使用前验证。
- 远端正文始终是带仓库、commit、路径、行号、URL 和许可证元数据的非可信证据。它不会成为 agent 指令。
- 评分、Atlas coverage、analysis quality、Bundle 和 Blueprint 都是静态观察。它们不能证明运行时正确性、测试通过、作者真实意图或复制许可。

## 发现、评分与预算

- 任务领域优先来自任务原文约束的 purpose/capabilities profile。英文词法回退只能提供保守候选；纯工程偏好和含糊中文不会被当作产品领域。
- 自动搜索对领域、成熟度、可迁移性、模式清晰度、设计质量和风险使用具名信号。许可证策略独立于技术评分，默认警告，可显式改为 allowlist 门禁。
- 学习空间最多包含两个同领域仓库。最终切片硬上限为每仓库 12 个文件、总计 48 个切片和 120000 字符。配置载入时会归一化发现、评分、Atlas、切片、Bundle 和评审阈值；非法风险枚举或许可证列表直接拒绝。
- Atlas 默认尝试 12 个文件和 120000 字符；配置可在 1–64 个文件和 10000–1000000 字符内调整。读取失败和截断同样消耗预算，不能提供语义角色。

## 语言分析边界

| 路径 | 能建立的静态观察 | 明确不建立的结论 |
|---|---|---|
| TypeScript/JavaScript 家族 | compiler AST 声明、公开面、字段、继承、静态 import、throw/catch、测试调用和完整声明窗口 | 不运行 TypeChecker，不解析动态目标，不证明运行时控制流 |
| Python 与 pyproject/setup.cfg | 隔离的 Python 3.11+ 标准库 AST/TOML/CFG 子集、声明、decorator、异常、静态 import、常规包布局和词法 fixture 候选 | 不 import 项目，不执行 decorator/build 配置/pytest，不猜 sys.path、插件 fixture 或歧义包 |
| Rust 与 Cargo.toml | 内置静态 lexer/parser 的声明、trait/impl、字段/variant、失败信号、测试、Cargo 子集和文件系统 module candidate | 不展开宏，不求值 cfg，不运行 build.rs，不做类型、extern prelude 或依赖 feature 求解 |
| 其他文本语言 | 路径、manifest、测试/源码模态和有界行窗口 | 不授予 syntactic、resolved 或 corroborated 强度 |

增强 parser 失败、超时、语法不完整或路由歧义时，单文件降级到结构/行窗口；不会串到另一语言的 parser，也不会继承别的文件的语义强度。

## 证据闭环

1. Atlas 依据架构角色缺口主动读取 manifest target、静态 import/module target 和可见 fixture scope；角色满足后停止，不把剩余额度当作读取配额。
2. Slicer 只保留完整语义单元或明确的文本窗口。提纯器按证据类型、contract/invariant/failure/relationship/test 角色和任务相关性计算边际收益，审计 duplicate、redundant、low-value 与 budget 丢弃原因。
3. 关系只有在 source line 区间完整覆盖且 target 文件也有同 revision 证据时成立。fixture 还要求完整覆盖 requester 和 provider 声明。
4. Bundle 至少满足配置的多模态数量，保存关系、最弱/最强证据级别和限制。没有 ADR/RFC/architecture/design 正文时，认识论上限为 observed。
5. Semantic Blueprint 只从已批准 Atlas、Bundle 和切片编译。缺失端点、部分声明、revision 不一致或 parser 限制都会形成 limitation 或被扣留。
6. Design Dossier 必须把 observation → claim → concept → adopt/adapt/reject mapping 串联起来。非 unknown 主张必须引用完整 Blueprint observation、Bundle 内切片并遵守强度置信度上限；inferred 只能 adapt/reject，unknown 只能支持 reject。
7. Pi 控制器只接受本任务实际通过工具读取过的 Bundle、切片和 Blueprint observation。确认后 Bundle 的关联切片保持完整，但未读取的关联切片仍不能进入 Dossier。

## 生命周期与拒绝

Pi 生命周期为 prepare → review → reference confirmation → distill → design confirmation → approved。edit、write、shell 和 patch 类内置 mutation 工具在最终批准前保持锁定。

- 参考确认重新运行 deterministic review gate，并绑定完整 reference pack、任务指纹、review submission 和确认身份；修改切片正文、出处、Atlas、Bundle 或评审结果会拒绝确认或恢复。
- Design 确认绑定 dossier、任务、reference pack 和独立身份。被 reject 的概念不会进入 coding context，原始上游正文也不会进入最终 context。
- 持久状态绑定规范化任务、工作区路径和 Git HEAD；恢复时重新计算两层 gate。checksum 用于发现损坏和普通误改，不是抵抗可重算 checksum 的恶意本地进程的签名。

## 评测边界

`eval/pi-runner.ts` 默认仅生成计划。只有显式 `--execute` 才调用模型和本地验证命令。suite 名称、任务数、重复数、prompt、timeout、参数和 fixture 相对路径均有界；fixture 必须位于 suite 目录内，复制前拒绝 symlink，并在复制时排除 `.git`、`.imitator` 和 `node_modules`。

verification pass rate 只能说明任务定义的命令通过，不能单独证明实现质量。语义质量还需要冻结任务、盲评规则、失败分类和人工复核。本轮项目检查按要求没有运行普通 Pi / 增强 Pi 对照实验。
