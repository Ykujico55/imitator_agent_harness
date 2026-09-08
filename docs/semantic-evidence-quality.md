# 语义证据质量

`analysisQuality` 衡量的是在当前文件、字符和解析预算内，系统对参考证据看清了多少。它不是仓库设计质量、运行正确性或领域适合度评分，当前固定标记为 `calibrationStatus: "observational-only"`，不进入六维技术总分，也不设置新的自动拒绝门槛。

## 与覆盖分分离

Atlas coverage 回答“源码、测试、文档等必要模态是否真实读到”；semantic evidence quality 回答“这些内容只是文本，还是已确认完整语法单元、静态关系和跨模态印证”。解析器 `invalid`、`unavailable` 或超预算不会抹除已经完整读取的保守文本证据，但不能产生语法、关系或印证信号。空包入口、test-support 和占位测试仍不能满足对应模态。

每个 slice 和 Atlas 文件记录使用五级强度：

| 等级 | 含义 |
|---|---|
| `missing` | 没有得到可用的有界内容 |
| `textual` | 只有有界文本窗口 |
| `syntactic` | 解析器给出完整语义单元或静态结构 |
| `resolved` | 存在带来源的静态关系候选 |
| `corroborated` | 实现与测试/fixture 在有界证据中交叉印证 |

这些等级不能命名为 verified：pipeline 从不运行上游项目，静态候选也不证明运行时绑定或测试通过。

## 具名信号

报告只使用七个固定信号，总计最多 100 分：

| 信号 | 分值 |
|---|---:|
| `readable-implementation-evidence` | 15 |
| `readable-test-evidence` | 15 |
| `syntactic-implementation-evidence` | 15 |
| `syntactic-test-evidence` | 15 |
| `parsed-declaration-structure` | 15 |
| `resolved-static-relationship-evidence` | 10 |
| `cross-modal-corroboration-evidence` | 15 |

每个实际得分信号都带固定 commit 的来源；不存在证据就不出现该信号，不使用语言、解析器品牌或“支持 AST”本身加分。文本模式的仓库可得到可读实现/测试两项，但不会凭空得到 syntax、relation 或 corroboration 分。

## 输出与评审

- Atlas `analysisQuality` 保存总分、信号、五级计数、逐文件路由/解析状态和限制。
- Slice `evidenceStrength` 保存精确窗口的等级、信号与负空间。
- Evidence Bundle 保存所选切片的 strongest/weakest 范围，并汇总解析限制。
- Pi prepare、渐进 evidence API、REFERENCE、DESIGN_ATLAS、EVIDENCE_BUNDLES 和 review request 都携带这些字段。
- Judge 被明确要求把 textual-only、unresolved 和 parser-limited 当作负空间，不能因为语言有适配器而提高置信度。

当前总分尚未经过真实项目校准，因此仍不参与候选排序或门禁。Design Dossier 只使用单条 Blueprint observation 的离散证据强度限制 observed claim 置信度（textual 0.65、syntactic 0.8、resolved 0.9、corroborated 0.95），不会把 repository-level `analysisQuality.score` 当作设计质量。下一步应使用人工标注参考仓库测量完整声明、静态关系和 test-target 的 precision/recall，再校准这些上限。

## 验证

```powershell
node --test test/analysis-quality.test.ts
npm run check
```

回归包含七个信号的确定性满分、text-only 仅 30 分、解析失败的文本覆盖、占位测试拒绝、Bundle 强度传播和完整 Rust pipeline。
