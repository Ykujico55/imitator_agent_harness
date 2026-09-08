# Reference Semantic Blueprint

## 定位

增强分析首先服务于**理解已确认的参考仓库**，然后帮助 coding agent 为本地项目作设计和编写代码。它不是新的仓库排行榜，也不能因为某种语言拥有更强的解析器，就把该仓库判断为更相关、更成熟或更值得学习。

完整主链路是：

```text
候选发现与领域评估
  → 1–2 个参考仓库确认
  → 有界静态语义分析
  → Reference Semantic Blueprint
  → evidence-bound Design Dossier
  → 本地项目语义地图与 adopt/adapt/reject 映射
  → 编码、测试和验收
```

其中仓库评估回答“参考是否适合”，`analysisQuality` 回答“在当前预算内看清了多少”，Semantic Blueprint 回答“从批准证据中观察到了哪些可迁移机制”。三者不得混成同一个分数。

## 输入边界

Blueprint 只能使用已经固定到 commit、通过参考选择确认并进入 reference pack 的 Atlas、Evidence Slice、Evidence Bundle 和静态关系。所有远程字节仍是不可信数据，不能被当作指令；pipeline 不 clone、不安装、不构建、不执行参考仓库。

语言适配器可以提高观察精度：例如识别声明、公共契约、数据字段、错误路径、测试体、fixture 和文件间静态候选关系。解析失败、关系歧义、宏或动态分派等无法确认的内容必须进入 limitations/negative space，不能由模型补成确定事实。

## Blueprint v1 的有界结构

每个已确认仓库生成一份 Blueprint，并保留以下部分：

- `modules`：模块或包的职责候选、公开入口和边界；
- `contracts`：公共类型、协议、trait、抽象类、导出面和关键调用约束；
- `dataModels`：影响不变量和状态迁移的数据结构与字段；
- `relationships`：导入、实现、组合、测试目标和 fixture 使用等静态候选边；
- `failureSemantics`：错误类型、抛出/捕获、Result 风格、unsafe 边界和可观察失败路径；
- `testConcepts`：测试层级、被测行为、setup/fixture、oracle 和失败案例；
- `extensionPoints`：插件、策略、provider 或显式扩展表面；
- `negativeSpace`：没有证据、只得到文本窗口、未解析或不应迁移的内容；
- `sources`：每个观察引用的 slice、bundle、固定 commit URL、许可证和证据强度。

Blueprint 是**确定性、有界的观察索引**，不是最终设计结论。它不保存整仓源码，也不声称恢复了作者意图。因果理由和技术选型动机仍需要 ADR/RFC/design 文档支持，否则只能进入 inferred 或 unknown claim。

## 证据强度约束

证据等级决定能够安全提出什么类型的主张，而不是决定仓库质量：

| 强度 | 允许支持的观察 | 不允许冒充的结论 |
|---|---|---|
| `textual` | 有界文本中明确出现的事实 | 完整语法边界、已解析依赖关系 |
| `syntactic` | 声明、字段、签名、测试体等语法结构 | 跨文件目标已经唯一绑定 |
| `resolved` | 带来源和条件的静态关系候选 | 运行时分派或行为正确性 |
| `corroborated` | 实现与测试/fixture 的有界交叉印证 | 上游测试真实通过或设计必然优秀 |

Blueprint 生成器必须保留较弱证据和限制。`analysisQuality` 可用于安排补读、限制 claim 置信度和提示 judge 负空间，但 v1 不进入仓库领域/设计评分，也不形成新的自动准入门槛。

## 驱动 Design Dossier

Design Dossier 蒸馏阶段不应面对一堆未组织的 parser 输出，而应以 Blueprint 作为导航索引，再按 ID 渐进读取批准的 Evidence Bundle 和 Slice。Dossier 必须把参考机制翻译成本地设计语言：

1. 从 `modules`、`contracts` 和 `relationships` 提炼职责边界及协作方式；
2. 从 `dataModels` 和 `failureSemantics` 提炼不变量、前后置条件与错误语义；
3. 从 `testConcepts` 提炼行为、oracle、setup 和失败案例，而不是照搬测试框架；
4. 对每个概念写明 adopt/adapt/reject、本地目标路径和验收测试；
5. 将 parser limitation、无证据动机、语言特有机制及关系歧义明确写入 negative space。

Blueprint 中的观察不能代替 Dossier claim。每个参考派生概念仍必须引用批准切片，并通过 explicit/observed/inferred/unknown 分类与独立确认。

## 本地项目映射

要真正帮助编写本地项目，后续需要以同一套 provider-neutral 接口生成 `Local Project Atlas`。本地分析是权威上下文的一部分，可以读取工作区，但不应运行未授权命令。映射器随后把参考 Blueprint 与本地模块、契约、测试和约束对齐：

- 相同职责且约束兼容时 `adopt`；
- 核心机制可用但语言、框架、规模或既有规范不同时 `adapt`；
- 与本地需求、验证测试或工程边界冲突时 `reject`。

最终 implementation context 只包含已确认的本地设计、规格、风险和验收契约，不包含远程源码。实现 agent 学的是职责划分、不变量、失败语义和测试思想，而不是上游文件名、目录形状或具体语法。

## 实施顺序

1. 定义 provider-neutral Blueprint schema、预算、稳定 ID 和确定性编译器；
2. 把 Blueprint 放入 Design Dossier request，并强化蒸馏提示与确定性验证；
3. 在 Pi 中提供 Blueprint 摘要和按概念渐进读取，保留来源与不可信边界；
4. 建立 Local Project Atlas 和 reference-to-local matcher；
5. 用人工标注的 Python、Rust、TS 项目验证关键模块、契约、失败语义和 test-target 的 precision/recall；
6. 最后再扩展更多语言或引入 TypeChecker、CFG、call graph、taint/dataflow 等静态分析能力。

更深的静态分析只有在其输出能进入 Blueprint、能携带来源和不确定性、并能通过人工标注回归证明增益时才应加入。否则它只会增加上下文体积和虚假的确定感。
