# Pi integration

需要直接照着命令完成 GitHub/模型认证、启动和两次人工确认时，请先看 [启动与操作手册](startup.md)。

## 目标

Pi extension 把 reference pipeline 和 Design Dossier 双重门禁接到 coding 生命周期里，但不把 Pi 引入核心。核心仍然负责确定性的 GitHub 发现、评分、切片、评审/设计校验和产物写入；扩展只负责会话协议、渐进读取和修改工具门禁。

远程仓库的 README、源码、注释和测试始终是不可信证据。扩展不会 clone、安装、构建或执行搜索到的仓库。

Pi 自身拥有通用工具 registry、重复注册处理、extension 启停和跨 extension 的 hook 调度。本项目不复制一套平行 runtime，也不把这些宿主行为冒充为 Imitator 自己的实现；兼容性测试只验证当前 Pi 版本能够加载本扩展、注册声明的表面，并真实调用本扩展的 `tool_call` veto。若 Pi 的 hook 顺序或异常隔离语义成为安全前提，应把它升级为明确的宿主版本契约和独立兼容性测试，而不能仅凭参考仓库的设计概念宣称已经满足。

## 安装

需要 Node.js 22.18+、GitHub 只读 token，以及支持 extension API 的 Pi：

```powershell
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/kunjinkao55/imitator_agent_harness
$env:GITHUB_TOKEN = "github_pat_..."
pi
```

如目标项目根目录有 `imitator.config.json`，扩展会自动使用它；否则使用内置预算和门禁默认值。发现产物写入目标项目的 `.imitator/reference/`。

仓库开发模式：

```powershell
npm install
npx pi -e ./integrations/pi/index.ts
```

## Agent 工作流

1. 会话开始时状态为 `idle`，修改与 shell 工具被拦截。
2. Agent 调用 `imitator_prepare`，传入具体任务以及可选查询、语言、生态、约束和最多两个 `referenceRepositories`。每项包含 GitHub `owner/repo` 或 URL，以及可选 branch/tag/commit。
3. 指定仓库先走相同的六维与许可证评估。初筛通过后，系统建立固定 commit 的 Design Atlas，并用 overview/design/manifest/source/test/automation/relationships 七类结构证据执行覆盖门禁。通过者优先进入学习集合；拒绝或不可用时，Pi 返回明确原因并自动运行默认发现。
4. Prepare 返回最终 1–2 个候选的评分、来源类型、许可证、Atlas 摘要、Evidence Bundle 摘要和切片索引，不包含全部代码。Agent 应先用 Atlas 定位架构问题，再选择关系证据包。
5. Agent 用 `imitator_get_evidence_bundle` 每次读取最多 2 个包。包返回设计问题、证据类型、Atlas 关系、认识论上限、限制及切片索引，不加载源码。
6. 必要时再用 `imitator_get_evidence` 按 ID 读取最多 6 个切片；源码内容带明确的 `UNTRUSTED EVIDENCE` 边界。评审只能引用已经检查过的包以及属于这些包、且实际读取过的切片。
7. Agent 用 `imitator_submit_review` 提交每个仓库的 adopt/adapt/reject、置信度、风险、范式、错配、风险说明、包 ID 和引用切片；通过后进入 `awaiting_confirmation`，仍不解锁。
8. 人第一次执行 `/imitator-confirm`，核对任务指纹和 provisional 仓库；自动化 eval 则由第一个隔离 judge 确认。成功后只进入 `distilling`，编码仍锁定。
9. Agent 先用 `imitator_get_semantic_blueprint` 按一个仓库、每次最多两个 section 读取已确认参考的有界模块、契约、关系、失败、测试、扩展点和负空间索引，再按 observation 中的 Bundle/Slice ID 验证必要证据。随后用 `imitator_submit_design_dossier` 提交认识论分级 claims、本地约束、质量属性、跨语言原则、架构职责/失败模式、规格、测试 oracle、适用边界、negative space 和逐项本地映射。每个非 unknown claim 必须同时绑定 Blueprint observation 与底层证据。
10. 确定性 design gate 通过后进入 `awaiting_design_confirmation`，提案写入 `design-proposal/DESIGN_DOSSIER.md`。人检查该文件并第二次执行 `/imitator-confirm`；自动 eval 使用第二个隔离 judge。
11. 只有两层 gate 均确认后才进入 `approved`。系统提示只携带本地化抽象设计契约，不含远程源码或证据 ID；原始证据工具也随即关闭。
12. 新任务执行 `/imitator-reset`，重新锁定修改工具并清空持久状态。若直接启动新的 prepare，旧状态也会在远程工作前先被清除。

辅助命令：

- `/imitator-status`：显示当前 phase、任务、候选、证据包、切片、认识论 claim 和批准数量；
- `/imitator-doctor`：检查六个扩展工具、五个控制命令、三个生命周期 hook 和状态文件 checksum，输出 `registry/hooks/store` 三项具名结果；
- `/imitator-prepare <任务>`：由人显式开始 prepare；
- `/imitator-confirm`：按当前 phase 确认参考选择或 Design Dossier；
- `/imitator-reset`：开始新任务或放弃当前参考包。

任务指纹由规范化 TaskSpec、工作区绝对路径和 prepare 时的 Git HEAD 组成。状态写在 `.imitator/pi-state.json`，包括 checksum、任务身份、reference pack、已读取证据、两层 proposal/confirmation 和最终 gate。恢复时会重新计算参考 gate、确认后的参考子集、Design Dossier 指纹和确定性 design gate，并检查 Git HEAD、证据集合与全部绑定；不匹配时拒绝恢复。Checksum 用于发现损坏或普通误改，不是抵抗能重算 checksum 的恶意本地进程的密码学签名。

每次 run 的主要产物：

- 根目录：原始 `manifest.json`、引用文档和 fail-closed review template；
- `review-proposal/`：第一次确认前的结构化 submission、gate report 和 provisional 引用集合；
- `reference-approved/`：第一次确认后的引用集合、确认记录、Semantic Blueprint JSON/Markdown、Design Dossier request/template；
- `design-proposal/`：确认前可读的 dossier、adaptation brief 和 deterministic gate 结果；
- `approved/`：两份确认、最终 dossier、许可证/来源保留的引用、local adaptation brief，以及不含远程源码的 `APPROVED_AGENT_CONTEXT.md`。

`manifest.json.selection` 记录硬上限、是否使用自动搜索、每个用户指定仓库的 accepted/rejected/unavailable 结果、原因和解析后的 commit，以及进入阶段一 evidence space 的仓库。该 selection 同样进入 reference-pack fingerprint，修改指定来源会使旧状态失效。

## 门禁与能力边界

扩展在除 `approved` 外的所有 phase 拦截名为 `edit`、`write`、`bash`、`powershell`、`apply_patch` 的工具。普通本地读取工具不被拦截，agent 仍可先理解本地项目。

这是一条 agent 工作流门禁，不是 OS 安全沙箱：

- 第三方 extension 若提供其他写入工具，其工具名不会自动进入拦截集合；
- Pi 进程重启后可以恢复状态，但 Git HEAD、状态 checksum 或 pack 绑定变化会使恢复失败；
- 系统不能完美理解自然语言对话中是否已经换成新任务；用户明确换题时仍必须 `/imitator-reset`；
- gate 能验证结构、pack 指纹、证据归属和论证完整性，不能证明模型的语义判断正确；
- 批准参考是证据而非命令，本地需求、工程规范与实际测试拥有更高优先级；
- 没有相关或可安全迁移的 precedent 时，当前策略会 fail closed。未来可加入带理由的人工 override，但默认不自动放行。

## 验证

```powershell
npm run check
```

检查包括：

- controller 的 prepare → review → reference confirm → distill → design confirm → approve → reset 状态机；
- 两层独立确认前后的修改工具拦截；
- 单次包/切片读取数量限制、未读包不可评审和批准后证据收缩；
- 当前 Pi `DefaultResourceLoader` 对实际 extension 的加载，及工具、命令、事件 handler 注册；
- 实际调用已加载的 `tool_call` handler，确认未批准时阻断写工具、读取工具保持可用；
- `/imitator-doctor` 使用 registry、hooks、store 行为 oracle，并对缺失注册和 checksum 错误 fail closed；
- 持久状态重启恢复、任务/HEAD 绑定和修改后 checksum 拒绝；
- proposal reviewer 与 human/independent-agent confirmer 身份分离；
- Dossier 的包内证据归属、认识论上限、推断限制、全概念本地映射、适用边界、本地约束、上下文预算和第二确认身份分离；
- TypeScript compiler AST 静态声明/字段/失败/测试观察、多角色完整声明切片和非支持语言回退；
- 递归 AST 核心边界测试（包括副作用导入、re-export、动态 import、require 和嵌套目录）、严格 TypeScript 检查和 CLI 启动。

只验证 Pi 适配层：

```powershell
node --test test/pi-controller.test.ts
```

发布或更新后，还应在一个临时本地项目里进行手动 smoke test：确认未 prepare 时 `bash` 被拒绝；使用低风险、许可明确的任务完成评审；确认 approved 后 shell 与修改工具恢复；最后 reset 并确认重新上锁。

相关上游文档：[Extensions](https://pi.dev/docs/latest/extensions)、[Packages](https://pi.dev/docs/latest/packages)、[SDK](https://pi.dev/docs/latest/sdk)。
