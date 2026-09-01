# Architecture and roadmap

## 核心假设

高质量参考能够改善 agent 的局部搜索空间，但前提是参考本身相关、成熟、可迁移，并且上下文中包含的是设计证据而不是海量代码。系统因此把“召回”和“准入”分开：高 Star 只帮助召回，不能单独通过准入。

## 当前数据流

1. Query planner 从任务、显式查询、语言和生态生成最多五条 GitHub 查询。
2. Discovery 只读取 repository search、Git tree 和 content API，不 clone 或运行仓库。
3. Assessor 给六个维度打 0–100 分，其中风险越高越差；许可证、领域最低分和总分是硬门禁。
4. Slicer 先按路径语义选择文件，再从长文件中选一个固定大小窗口；预算在字符层硬截止。
5. Renderer 生成机器可读 manifest、证据文档和防提示注入的 agent 工作协议。

## 威胁模型

- 上游 README、源码注释或测试可能包含 prompt injection，因此永远只作为引用数据呈现。
- 仓库可能利用构建脚本或依赖投毒，因此 discovery 阶段禁止 clone/install/build/execute。
- 无许可证代码默认不可迁移；强 copyleft 或自定义许可证必须显式配置并由人复核。
- 默认分支会漂移。生产版应先解析 commit SHA，并让 tree、content 和链接全部固定到 SHA。
- Star、topic 和描述可被操纵，因此需要测试、CI、治理文件、维护时间等交叉信号；后续再接安全扫描和组织信誉。

## 推荐的二阶段系统

第一阶段用当前廉价确定性算法从几十个候选压到 3–6 个。第二阶段由一个只输出结构化 JSON 的 judge 比较：任务不变量、架构适配、运行规模、故障模型、许可证和负迁移风险。judge 只能从带来源的证据中作答，不能凭 Star 补全事实。

执行 agent 不直接得到所有参考。先为当前设计决策检索 reference pack，最多注入 2–4 个切片；子 agent 也只能在这个包内搜索。这个“先构造个性化空间，再在空间内枚举”的分层方式，才是算力换智力的关键。

## Pi integration

推荐做成薄 extension，而不是 fork Pi：

- `before task`：获得用户任务，运行 prepare；
- review gate：展示候选、分数、许可证和预算，允许用户剔除；
- context provider：只注入 `AGENT_CONTEXT.md` 与按决策检索的切片；
- `after task`：记录采用/拒绝的范式、测试结果和回归，形成 eval 数据。

只有当 Pi extension 生命周期无法提供可靠的 gate 和 context provider 时，才值得 fork agent core。

## 评估计划

选择 30–50 个有明确测试的真实任务，固定模型、提示词和 token 预算，对比：无参考、整个仓库、仅 README、当前 reference pack 四组。至少测量测试通过率、回归数、review 缺陷、上下文 token、完成时间、与上游的无意义结构相似度。没有这组实验，产品只能证明“检索能跑”，不能证明“软件质量提高”。
