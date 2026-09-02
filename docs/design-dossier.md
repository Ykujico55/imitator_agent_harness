# Design Dossier protocol

## 目标

Design Dossier 是 reference selection 与实际编码之间的压缩层。它不回答“上游代码长什么样”，而回答：上游面对什么问题和约束、做了什么决定、靠什么机制维持、付出什么代价、何时适用或失效，以及这些判断在本地应该 adopt、adapt 还是 reject。

参考是证据，不是权威。本地需求、现有工程规范和已经验证的测试始终拥有更高优先级。

## 必填结构

一份 schema v1 dossier 绑定 `taskFingerprint`、`referencePackFingerprint`、作者和全部已确认仓库，并且仓库数必须为 1–2 个。它包含：

- `localContext`：本地硬约束、既有惯例和质量属性，防止上游设计覆盖本地事实；
- `claims`：把每条参考派生判断标为 `explicit`、`observed`、`inferred` 或 `unknown`，绑定 Evidence Bundle、支持/反证切片、置信度和限制；
- `principles`：问题、约束、决定、机制、权衡、非目标、适用与失效条件；
- `architecture`：职责、协作者、不变量、失败模式和扩展点；
- `specifications`：前置条件、后置条件、不变量和错误语义；
- `testConcepts`：行为、测试层级、oracle、setup 和失败案例；
- `negativeSpace`：上游刻意没有做、或本地不应迁移的内容；
- `localMappings`：每个参考概念在本地的 adopt/adapt/reject 决策、理由、必要改造、目标路径和验收测试；
- `globalRisks`：仍可能破坏设计意图的跨模块风险。

每个参考派生的 principle、architecture、specification、test concept 和 negative-space 选择都必须引用已批准的 evidence slice ID，而且该切片必须先被一条非 `unknown` claim 分类。Local context 和适配决策来自本地事实，不应伪装成上游证据。

Repository Design Atlas 随 request 提供模块、入口、manifest、测试和依赖关系索引，帮助 agent 判断应该读取哪些证据以及概念处于什么结构位置。Atlas 事实不能替代 slice ID：尤其是技术选型理由，若 ADR/RFC 或其他批准证据没有明确说明，就必须视为未知或模型推断，不能写成上游作者的明确意图。

Evidence Bundle 是 claim 的最小关系边界。Claim 引用的支持和反证切片必须属于它引用的包。`explicit` 必须引用上限为 explicit 的包，并直接引用 ADR、RFC、architecture 或 design 文档切片；`observed` 必须有支持切片；`inferred` 必须有支持切片、明确限制且置信度不高于 0.8；`unknown` 必须说明缺失什么，置信度不高于 0.2，并且不能单独支撑设计概念。

## 确定性不变量

Design gate 默认拒绝以下情况：

- task 或 reference pack 指纹不匹配；
- 使用未确认仓库、遗漏已确认仓库、或引用未批准证据；
- claim 引用未知 Evidence Bundle、包外切片，或把 observed 上限的证据写成 explicit 意图；
- 推断没有限制、置信度超过 0.8，unknown 没有说明缺失证据，或概念使用了只被 unknown claim 分类的证据；
- 任一设计概念没有证据，或任一仓库没有被实际用于设计证据；
- 缺失架构、规格、测试、negative space、本地上下文或全局风险；
- 原则没有约束、机制、权衡、fits-when 或 fails-when；
- 架构没有职责、不变量或失败模式；规格没有后置条件或错误语义；测试没有 oracle 或失败案例；
- 任一概念没有本地映射，adapt 没有具体改造，非 reject 映射没有目标路径或验收测试；
- 内容超过 80,000 字符或分区数量预算；
- dossier 作者试图确认自己的产物，或确认记录缺少有意义的 rationale。

这些检查证明的是绑定和结构完整性，不证明语义一定正确。因此最终仍需要不同身份的人或隔离 judge 审查。

## 上下文策略

远程源码只在参考审查和设计蒸馏阶段按 ID、按小批次读取，并始终包在 `UNTRUSTED EVIDENCE` 边界内。最终实现阶段获得的是：

- 本地权威约束和质量属性；
- 带适用边界与权衡的原则；
- 架构职责、不变量和失败模式；
- 行为规格与错误语义；
- 测试 oracle、失败案例和本地验收测试；
- 明确的 adapt/reject 边界与 negative space。

最终 context 不包含远程源码、证据 ID或上游目录形状；批准后原始证据工具也会关闭。这使“高度效仿”集中在设计品味和概念结构，而不是表面代码相似度。

## 产物和审计

第一次确认后，`reference-approved/` 会生成 dossier request 和 fail-closed template。提交后，`design-proposal/` 保存确认前的 JSON、Markdown、adaptation brief 和 deterministic gate 结果。第二次确认后，`approved/` 保存最终 dossier、两层确认、来源/许可证完整的批准引用和 implementation context。

确认身份字符串提供可审计 provenance，但不是密码学身份认证。`.imitator/pi-state.json` 的 checksum 用于检测损坏和普通误改，也不是针对能重算 checksum 的恶意本地进程的安全边界。

## 当前能力边界

- TS/JS 有 compiler AST 切片；其他语言仍是确定性行窗口，因此跨语言“设计抽取”由 dossier 协议和 judge 完成，而不是所有语言的静态语义分析。
- gate 能发现无证据、漏映射、上下文爆炸和结构性 cargo cult，不能自动证明架构优雅或测试充分。
- Pi 门禁只拦截已知修改工具名；按当前产品范围，未知第三方修改工具尚未默认拒绝。需要不可绕过边界时应叠加 OS sandbox。
- 系统没有真实模型质量结论。必须运行足量 paired eval，并对隐藏测试、回归、安全缺陷、token/费用和无意义上游相似度做盲评。
