# Architecture and roadmap

## 核心假设

高质量参考能够改善 agent 的局部搜索空间，但前提是参考本身相关、成熟、可迁移，并且上下文中包含的是设计证据而不是海量代码。系统因此把“召回”和“准入”分开：高 Star 只帮助召回，不能单独通过准入。

## 当前数据流

1. Query planner 从任务、显式查询、语言和生态生成最多五条 GitHub 查询。
2. Discovery 只读取 repository search、Git tree 和 content API，不 clone 或运行仓库。
3. Assessor 给六个维度打 0–100 分，其中风险越高越差；许可证、领域最低分和总分是硬门禁。
4. Slicer 先按路径语义选择文件；TS/JS 适配器优先选择完整 AST 声明或测试单元，其他语言确定性回退到行窗口；预算在字符层硬截止。
5. Renderer 生成机器可读 manifest、证据文档、防提示注入的 agent 工作协议和 pack-bound 评审请求。
6. 人或外部 judge 提交结构化决策；deterministic gate 校验 fingerprint、证据 ID、置信度、风险和审查完整性。
7. Proposal 通过 deterministic gate 后仍进入 `awaiting_confirmation`；只有不同身份的人或独立 agent 才能确认参考集合。
8. 参考确认后进入 `distilling`。agent 必须把已批准证据转换为语言无关的 Design Dossier，而不是直接编码。
9. Design gate 验证任务/pack 指纹、仓库和证据归属、本地约束、概念完整性、适用边界、权衡、negative space、本地映射、目标路径、验收测试与 8 万字符预算。
10. Dossier 通过后进入 `awaiting_design_confirmation`；第二个独立身份确认后才生成最终抽象 agent context、关闭原始证据读取并解锁编码。

## 威胁模型

- 上游 README、源码注释或测试可能包含 prompt injection，因此永远只作为引用数据呈现。
- 仓库可能利用构建脚本或依赖投毒，因此 discovery 阶段禁止 clone/install/build/execute。
- 无许可证代码默认不可迁移；强 copyleft 或自定义许可证必须显式配置并由人复核。
- 默认分支会漂移，因此 tree、content、证据 ID 和链接全部固定到解析后的 commit SHA。
- Star、topic 和描述可被操纵，因此需要测试、CI、治理文件、维护时间等交叉信号；后续再接安全扫描和组织信誉。
- `AGENTS.md`、`CLAUDE.md`、`.agents/` 和常见 IDE agent 指令文件默认不进入切片；其他远程内容仍按不可信证据处理。
- 外部 judge 也可能被证据中的提示注入影响。结构化 gate 能防止串包、伪造引用和缺失论证，但不能证明 judge 的语义判断正确；高风险任务仍需人工确认。
- 最终 implementation context 不包含上游代码或证据 ID，只包含已确认的本地约束、设计决策、适用边界、规格、失败语义、测试 oracle 和验收契约；这减少逐行模仿和提示注入继续传播的机会。

## 已实现的双层独立确认系统

第一阶段用廉价确定性算法从几十个候选压到 3–6 个。第二阶段通过 `REVIEW_REQUEST.json` 和 `REVIEW_TEMPLATE.json` 与人或任意模型交互。评审必须给出 adopt/adapt/reject、置信度、风险级别、摘要、可迁移范式、错配、风险和证据切片 ID。

模板默认是 pending/high-risk/zero-confidence。参考 gate 对 fingerprint 不一致、伪造或跨仓库证据、低置信度、高风险、缺失证据、空范式，以及论证不完整的 adapt 决策全部 fail closed。第一次确认后生成 `reference-approved/` 和 fail-closed 的 Design Dossier request/template。

Design Dossier 是第二层压缩与判断协议：它先写入 `design-proposal/` 供检查，再由不同身份确认。最终 `approved/` 保留两份确认、引用和许可证元数据、完整 dossier、local adaptation brief，以及不含远程源码的 implementation context。详细 schema 和不变量见 [Design Dossier](design-dossier.md)。

执行 agent 不直接得到所有参考。先为当前设计决策检索 reference pack，最多注入 2–4 个切片；子 agent 也只能在这个包内搜索。这个“先构造个性化空间，再在空间内枚举”的分层方式，才是算力换智力的关键。

## Pi integration

已经实现为薄 extension，而不是 fork Pi：

- `before_agent_start`：注入当前 gate 状态、远程证据不可信规则和渐进式工作协议；
- `tool_call`：参考选择与 Design Dossier 两层 gate 均确认前拦截 Pi 的修改和命令工具；
- `imitator_prepare`：调用 provider-neutral 核心并返回候选摘要与切片索引；
- `imitator_get_evidence`：每次最多读取 6 个明确 ID 的切片，批准后只能读取被引用的批准切片；
- `imitator_submit_review`：绑定当前 pack、任务指纹和实际读取过的证据，生成 proposal；
- `imitator_submit_design_dossier`：在参考确认后提交跨语言设计、规格、测试概念和本地适配图；
- `/imitator-confirm`：根据当前 phase 分别确认参考 proposal 或 Design Dossier；自动 eval 的两个阶段使用隔离 judge 进程；
- `.imitator/pi-state.json`：持久化 task-bound 状态并在重启时重新校验 Git HEAD、checksum 和 pack 结构；
- `/imitator-status`、`/imitator-reset`、`/imitator-prepare`：提供显式的人机控制面。

新任务仍必须 reset，因为自然语言任务切换不能被可靠自动判定。启动新的 prepare 会在远程请求前清除旧批准状态，避免失败后重启恢复陈旧授权。扩展只认识配置的工具名，第三方扩展注册的其他写入工具不在拦截集合内（本阶段按产品选择暂不处理）。若未来需要不可绕过的 OS 级权限边界，应在 Pi 之外增加 sandbox，而不是把会话 hook 当安全边界。

## Semantic slicing

Provider-neutral core 接受注入式 `SemanticSliceSelector`，本身保留零依赖的确定性行窗口。Pi adapter 注入 TypeScript 5.9 compiler AST selector，对 TS、TSX、JS、JSX、MTS、CTS 等选择预算内的完整 interface、type、enum、class、function、method、variable statement 或测试调用，并记录 strategy 与 symbol。没有合适 AST 单元或语言不支持时回退到原行窗口。

## 评估计划

选择 30–50 个有明确测试的真实任务，固定模型、提示词和 token 预算，对比：无参考、整个仓库、仅 README、当前 reference pack 四组。至少测量测试通过率、回归数、review 缺陷、上下文 token、完成时间、与上游的无意义结构相似度。没有这组实验，产品只能证明“检索能跑”，不能证明“软件质量提高”。
