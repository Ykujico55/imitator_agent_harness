# Real-model paired evaluation

需要手动逐步执行、直接复制提示词时，使用 [普通 Pi / 增强 Pi 对照提示词流](pi-ab-prompt-flow.md)。它包含自然使用与流程对齐两种协议、统一任务卡、独立阶段评审、匿名最终盲评和记录模板。本页描述现有 runner，不代表 runner 已实现该文档的新版协议。

## Purpose

单元测试只能证明检索、门禁和适配器按规格运行，不能证明参考包提高了软件质量。本 runner 在相同本地 fixture、任务、模型、推理环境和验收命令下生成 paired runs：

- `baseline`：一个 Pi coding call，不加载 Imitator；
- `imitator`：参考 proposal agent、独立参考 judge、Design Dossier 蒸馏 agent、独立 design judge、implementation agent，共最多五个 model calls。

每个 run 使用 fixture 的独立副本，不复制 `.git`、`.imitator` 或 `node_modules`，并拒绝带 symlink 的 fixture，避免副本写出实验目录。

## Dry run first

仓库自带 `eval-fixtures/retry-queue`：它是一个无外部依赖、初始隐藏要求未实现的微型任务，可直接用于 smoke eval。正式实验应复制并编辑 `eval-suite.example.json`，使用更多本地 fixture 和无交互、确定性的验收命令。先执行：

```powershell
npm run eval:pi -- `
  --suite eval-suite.example.json `
  --provider <provider> `
  --model <model>
```

这只解析 suite、生成 baseline/imitator 配对计划并报告预计付费调用数；不会启动模型、复制 fixture 或执行验收命令。

## Execute explicitly

确认计划后设置 GitHub token，并显式授权执行：

```powershell
$env:GITHUB_TOKEN = "github_pat_..."
npm run eval:pi -- `
  --suite eval-suite.example.json `
  --provider <provider> `
  --model <model> `
  --judge-provider <provider> `
  --judge-model <model> `
  --execute
```

Runner 在产生任何付费调用前执行 Pi auth readiness check。`--judge-provider` 和 `--judge-model` 可省略，默认使用相同模型但独立进程和独立上下文；更强的独立性应使用不同模型或供应商。两个 judge 都要求结构化 JSON 和有内容的 rationale，且理由会进入持久确认记录。

Imitator run 的五阶段顺序：

1. proposal agent 只能检索、读取证据和提交参考决策；
2. reference judge 只可从 provisional 集合中批准仓库；
3. distillation agent 基于已批准证据和本地项目提交 Design Dossier，不得编码；
4. design judge 核对证据忠实度、架构/规格/测试完整性、本地适配与 cargo-cult 风险；
5. 两层状态都确认后，implementation agent 只获得抽象设计契约并执行原任务。

执行模式会运行 suite 中的本地 `verify.command`，所以 `--execute` 只应用于你已经检查过的本地 suite。远程发现仓库永远不会被 clone 或执行。

## Outputs and interpretation

每次实验写入 `.imitator/eval/<suite>-<timestamp>/`：

- 每个 run 的五阶段 agent/judge 输出、退出码、耗时、变更文件数和验收结果；
- `report.json` 中按 variant 汇总的 verification rate、平均耗时和平均变更文件数；
- 每个 run 的隔离工作区，便于后续人工 review。

Verification rate 不是完整的软件质量。正式实验还应对隐藏测试、回归、安全缺陷、review 缺陷、token/费用和无意义上游模仿进行盲评。单个成功任务不能证明产品假设，建议至少 30–50 个任务、多次重复并报告方差。

本仓库目前只验证 runner 的计划、输入校验和 dry-run 安全性；在没有用户模型认证和显式 `--execute` 的情况下，不声称已经获得真实模型效果数据。
