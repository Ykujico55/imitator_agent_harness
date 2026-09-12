# 领域提取、评分与评审

领域回答“产品解决什么问题、提供什么行为”，工程约束回答“用什么语言、如何打包、有哪些质量要求”。共享 TypeScript、零依赖、ESM 或测试框架，不构成同领域依据。

## 任务专属描述，不使用领域白名单

Pi 在第一次 `imitator_prepare` 时，根据本地任务填写 `domain`。这使用当前 coding agent 的模型，不引入额外模型服务，也不在核心维护缓存、支付、认证等领域词典。

- `purpose`：产品职责及其检索别名。
- `capabilities`：1–8 个具体产品行为及其代码/文档术语别名。
- 每项的 `taskEvidence`：本地任务或 `mustHave` 中的原文片段，不能引用发现的仓库倒推任务。

例如任务 `Build a job queue with retries and acknowledgement` 对应：

```json
{
  "purpose": {
    "name": "job queue",
    "aliases": ["task queue"],
    "taskEvidence": "job queue"
  },
  "capabilities": [
    {"name": "retry", "aliases": ["retries", "backoff"], "taskEvidence": "retries"},
    {"name": "acknowledge", "aliases": ["acknowledgement", "ack"], "taskEvidence": "acknowledgement"}
  ]
}
```

同一结构用于其他领域。中文任务可以提供英文别名，以便跨语言检索；别名须表达同一职责或行为，而不是堆砌相关词提高分数。

结构、长度、通用工程词、原文片段在首次 GitHub I/O 前校验。描述进入任务指纹；修改描述需要重新 prepare，旧审批不能沿用。引用原文只证明描述有所依据，不证明翻译或语义解释正确，后者仍需独立评审。

## 搜索与评分

自动查询围绕产品职责的名称和别名生成，不把工程属性作为领域查询。目标语言只用于一个优先查询，其余查询允许不同语言实现。

- 无产品职责匹配：领域分 0，硬拒绝；内部目录恰好有缓存等子模块不能改变仓库的整体产品职责。
- 产品职责匹配：60 分。
- 产品行为元数据覆盖：最多再加 25 分。
- 同义词只算一个概念，不堆词加分。语言、星数、依赖与打包属性不贡献领域分。
- 许可证单独列为使用限制，默认警告，不计入领域、技术可迁移性、风险或总分；可选严格模式仍会独立拒绝非白名单项。

未提供描述时，CLI/旧调用方可以做保守的英文词汇检索，但只是探索，不能通过参考评审。无法提取时要求补充描述，而不是填入无关项目凑满 1–2 个参考。

## 评审约束

每个 adopt/adapt 决策必须包含 `domainFit`：

```json
{
  "relation": "same-domain",
  "rationale": "说明共享的产品职责、行为边界及引用实现如何支持判断",
  "evidenceSliceIds": ["已读取且在本次评审中引用的代码或测试切片 ID"]
}
```

门禁重新计算领域匹配，不信任旧 `accepted` 标志。`adjacent-domain`、`unrelated`、`unknown` 不能进入主学习集。引用必须属于该仓库、本次已读证据与已引用证据束。README、package.json 或只有产品名称的代码不满足行为证据下限；至少一份代码/测试切片须包含描述中的具体能力术语。

置信度衡量“参考适合当前任务的证据强度”，不是“确定某条通用经验存在”。从 0.4 提高到 1.0 不能覆盖领域或证据检查失败；不应为过门槛而抬高置信度。

这些是必要条件，不是语义证明：关键词可能只是注释，模型也可能给出错误别名。独立 judge/人工必须核对实际行为、任务解释和迁移边界，不能自动确认。系统不要求每个本地功能都在参考中存在，但本地新增需求不能伪称来自参考。

## 使用和迁移

### 许可证策略

默认 `acceptance.licensePolicy` 为 `"warn"`：缺失、未识别或不在白名单内的许可证不会单独淘汰参考仓库。`licenseWarnings` 会出现在候选评估、Pi prepare 结果、评审请求和参考文档中；源码切片仍保留许可证、固定 revision 和来源链接。

需要严格准入时，在传给 `--config` 的配置文件中设置：

```json
{
  "acceptance": {
    "licensePolicy": "allowlist",
    "allowedLicenses": ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]
  }
}
```

严格策略在初筛和评审时均检查，不能依靠旧的 accepted 标志绕过。已有配置未指定 `licensePolicy` 时使用新默认值 `warn`；修改磁盘配置后需要重新 prepare 才会应用，旧的被拒绝结果不会自动放行。

为避免隐性许可证门禁，技术可迁移性的启发式基础分统一为 65（保持原白名单候选的基准），不再按许可证增减；非许可证风险仍独立检查。该基础分不是设计质量的证明。

本策略仅控制设计参考的学习准入，不提供法律判断或代码复用授权。复制、再分发或引入依赖前仍需核对实际适用条款；未知许可证不应被当作允许复用。独立评审应记录使用限制，不应仅因许可证元数据未知而把设计学习判为高风险；具体使用方案的真实风险仍可以阻断。

Pi：重启本地新版插件，执行 `/imitator-reset`，用普通消息发送完整任务。默认 advisory 模式由模型在一次 `imitator_learn` 中提供简化领域描述，系统自动绑定任务并在 learn/skip 后继续编码，不需人工确认。只有显式 `IMITATOR_MODE=strict` 才使用原 prepare 与两次确认流程。

CLI：把上述 JSON 保存成 `domain.json`，执行：

```bash
node src/cli.ts prepare --task "Build a job queue with retries and acknowledgement" --domain-file domain.json
```

旧版缺少领域描述/同领域声明的审批恢复时会重新校验，不能继续解锁编码。保留旧记录用于诊断，不要手工修改状态或校验和。

## 验证边界

离线测试使用缓存、队列、解析器、日历等不同任务验证同一套规则，并复现轮播、JWT、工具库、秘密分享被选入缓存任务的反例。还覆盖置信度抬高、证据缺失、旧通过标志和状态恢复。

这验证确定性规则、模拟 GitHub 流水线及 Pi 扩展加载，不代表新版已经通过真实模型端到端测试。

Atlas 的源码/测试文件识别覆盖多种语言和常见根目录布局。Pi 对 Python 可启用标准库 AST/TOML 解析、静态导入关系和完整声明切片，见 [Python 参考学习](python-learning.md)；其余未支持语言及解析失败仍降级为结构索引和行窗口，不声称支持所有语言的运行时语义分析。
