# 启动与操作手册

Imitator 现在默认使用 **advisory 模式**：用户只需正常发送开发任务，Pi 在第一次修改或执行 shell 前调用一次 `imitator_learn`。系统自动决定采用参考还是跳过参考，两种结果都会立即允许继续编码，**不再需要人工执行 `/imitator-confirm`**。

原来的参考评审与 Design Dossier 双重人工确认仍保留为可选的 `strict` 审计模式。

## 1. 前置条件

- Node.js 22.18 或更高版本；
- npm；
- GitHub 只读 token；
- 一个 Pi 支持的模型账号或 API Key；
- 当前终端位于待开发项目。

不要把 GitHub Token 或模型 API Key 写入仓库、命令行参数、聊天消息或可提交配置。已经暴露的 Token 应立即撤销并重新生成。

## 2. 配置 GitHub API 认证

推荐使用 GitHub CLI。在 WSL/Bash 中：

```bash
gh auth login -h github.com --web
gh auth status
export GITHUB_TOKEN="$(gh auth token)"
```

在 PowerShell 中可以直接设置 PAT：

```powershell
$env:GITHUB_TOKEN = Read-Host "GitHub PAT" -MaskInput
```

Bash 赋值不能写成 `env:GITHUB_TOKEN = ...`，等号两边也不能有空格。Windows 与 WSL 是不同环境；Pi 在哪里运行，就必须在哪里设置变量。只执行 `gh auth login` 不会让 harness 自动读取凭据，仍需导出 `GITHUB_TOKEN`。

检查变量是否存在，但不要输出 token：

```bash
if [ -n "${GITHUB_TOKEN:-}" ]; then echo configured; else echo missing; fi
```

公开仓库只需要只读访问。私有仓库应仅为目标仓库授予 Metadata/Contents read-only。

## 3. 配置模型

进入 Pi 后可执行 `/login` 选择供应商，再用 `/model` 选择模型。也可在启动前设置供应商环境变量，例如：

```bash
export OPENAI_API_KEY="<openai-api-key>"
# 或 export ANTHROPIC_API_KEY="<anthropic-api-key>"
```

GitHub Token 只用于读取参考仓库；模型 API Key 只用于 Pi 调用模型，两者不能互相替代。设置变量后必须重启 Pi，运行中的进程不会自动获得后来设置的环境变量。

## 4. 启动默认 advisory 模式

开发当前本地源码：

```bash
cd "/mnt/c/Users/kunji/Desktop/work learn/imitator_agent_harness"
npm install
npx pi --no-extensions -e ./integrations/pi/index.ts
```

`--no-extensions` 关闭自动发现，但显式 `-e` 仍然生效，可避免本地版和已安装版同时加载。

使用 GitHub 安装版：

```bash
pi install git:github.com/kunjinkao55/imitator_agent_harness
pi
```

安装版只包含已推送的提交。测试未提交修改时使用本地 `-e` 方式。

不要设置 `IMITATOR_MODE`，或显式设置为 `advisory`：

```bash
export IMITATOR_MODE=advisory
```

PowerShell 对应为：

```powershell
$env:IMITATOR_MODE = "advisory"
```

## 5. 健康检查

进入 Pi 后执行：

```text
/imitator-status
/imitator-doctor
```

新项目应显示 `workflowMode: "advisory"`、`phase: "idle"`。健康检查应同时包含 `registry: ok`、`hooks: ok` 和 `store: ok`。Imitator extension 默认注册 `imitator_learn` 和 `imitator_visual_audit` 两个工具；没有加载插件的普通 Pi 不会出现它们。

若命令未知，extension 没有加载。若 registry 显示六个工具，当前运行的是 `strict` 模式或旧版本。

## 6. 默认操作顺序

直接发送完整开发任务即可，不要先执行 `/imitator-prepare`，也不需要向模型提供 `taskEvidence`、证据 ID 或确认命令。

```text
请完成以下开发任务：<完整需求、约束和验收命令>。
先理解现有项目，再按当前 Imitator 工作流工作；参考只影响确有证据支持的架构、契约、失败语义和测试设计，本地需求与测试优先。
```

Pi 的实际流程是：

```text
idle
  → agent 可用 read/ls/find/grep 检查本地项目
  → imitator_learn（预编码只调用一次）
  → 视觉任务：插件内置风格原型＋本地 VISUAL_SPEC → advisory_ready
    非视觉任务：足够的远程机制证据 → advisory_ready
    或证据收益不足、没有合适参考、网络或限额失败 → bypassed
  → 自动继续编码和测试
  → 视觉任务完成后 imitator_visual_audit（最多一次修复＋一次复审）
```

`imitator_learn` 的输入只有任务、一个产品目的短语和 1–6 个核心能力，可选指定最多两个仓库。系统负责将它们绑定到任务，不再要求模型构造容易出错的逐字 evidence 对象。

非视觉学习成功时，最多五条高价值观察进入不超过 6000 字符的 `ADVISORY_BRIEF.md`。视觉路由则不读取远程仓库，而是生成 `VISUAL_SPEC.json/.md` 和基线审计；实现后静态检查结果写入 `VISUAL_AUDIT.json/.md`。学习收益不足时会明确 `skip` 并退回普通 Pi。

可随时执行 `/imitator-status` 查看 `advisoryDecision`、分数和选中仓库。开始一个完全不同的新任务前执行 `/imitator-reset`；随后下一次开发会重新运行一次学习。

## 7. 可选 strict 审计模式

只有需要可审计的仓库选择、独立 judge 或高风险变更时才启用。必须在启动 Pi **之前**设置：

```bash
export IMITATOR_MODE=strict
npx pi --no-extensions -e ./integrations/pi/index.ts
```

PowerShell：

```powershell
$env:IMITATOR_MODE = "strict"
npx pi --no-extensions -e ./integrations/pi/index.ts
```

严格流程保持原有语义：

```text
prepare → 读取 Bundle/Slice → submit review
→ /imitator-confirm
→ 读取 Semantic Blueprint → submit Design Dossier
→ /imitator-confirm → approved → coding
```

严格模式注册六个工具，编码在两次确认前保持锁定。`/imitator-confirm` 必须由人或隔离 judge 根据实际提案执行；实现 agent 不能自我确认。详细协议见 [Pi 接入说明](pi-integration.md)。

## 8. 常见问题

### GitHub API 403 / rate limit exhausted

退出 Pi，在同一终端设置 `GITHUB_TOKEN` 后重新启动。advisory 模式会把这类失败记为 `skip` 并继续编码；strict 模式仍会 fail closed。

### Persisted Pi state failed its integrity check

这表示 `.imitator/pi-state.json` 的 checksum、任务、工作区或 Git HEAD 绑定不一致。不要手工修改 checksum。开始新任务时执行：

```text
/imitator-reset
```

若状态文件已经损坏且命令无法恢复，可在退出 Pi 后删除当前项目生成的 `.imitator/pi-state.json`，再重新启动。只删除精确文件，不删除整个项目或 `.git`。

### Agent 没开始编码

先看 `/imitator-status`：

- `idle`：模型尚未调用 `imitator_learn`；继续发送“请按默认 Imitator 流程完成任务”，不要手动 prepare；
- `preparing`：单次检索仍在运行；
- `advisory_ready` 或 `bypassed`：门禁已经释放，直接要求继续实现；
- `awaiting_confirmation` / `awaiting_design_confirmation`：当前是 strict 模式，需按提案进行相应确认。

### 指定参考不合适

指定仓库仍必须满足领域和证据收益下限。未通过时 advisory 模式会尝试默认发现，最终无收益则跳过；不会因为用户指定而强行把低质量证据注入实现上下文。许可证作为独立限制提示保留，默认不因未知或非白名单许可证单独拒绝设计学习。

## 9. 最短检查清单

```text
1. 在 Pi 所在环境设置 GITHUB_TOKEN 和模型认证。
2. 默认不设置 IMITATOR_MODE，加载 extension 并启动 Pi。
3. /imitator-doctor 三项均为 ok。
4. 直接发送完整任务。
5. 等待一次 imitator_learn 后自动编码；无需人工确认。
6. 视觉任务完成后检查 imitator_visual_audit；最多修复和复审一次。
7. 检查真实测试与实际页面，而不是只看模型总结或静态审计。
```
