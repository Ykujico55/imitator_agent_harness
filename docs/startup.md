# 启动与操作手册

这份手册描述如何从一个干净终端启动 Pi 与 Imitator，完成 GitHub 认证、模型认证、参考学习、两次人工确认并最终开始编码。

## 1. 前置条件

- Node.js 22.18 或更高版本；
- npm；
- GitHub CLI `gh`（推荐，用于安全保存 GitHub 登录）；
- 一个 Pi 支持的模型账号或 API Key；
- 当前终端位于待开发项目。开发 Imitator 本身时，进入本仓库：

```bash
cd "/mnt/c/Users/kunji/Desktop/work learn/imitator_agent_harness"
```

不要把 GitHub Token 或模型 API Key 写入仓库、命令行参数、聊天消息或可提交配置。任何已经暴露的 Token 都必须立即在服务商后台撤销并重新生成。

## 2. 配置 GitHub API 认证

### 推荐：GitHub CLI 登录

在 WSL/Bash 中执行：

```bash
gh auth login -h github.com --web
gh auth status
export GITHUB_TOKEN="$(gh auth token)"
```

在启动 Pi 前确认变量存在，但不要打印它：

```bash
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN configured"
else
  echo "GITHUB_TOKEN missing"
fi
```

检查 API 是否按账号认证：

```bash
curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/rate_limit |
  jq '.resources.core | {limit, remaining, used, reset}'
```

个人账号成功认证后，`limit` 通常为 `5000`；若仍为 `60`，说明请求仍是匿名请求。没有 `jq` 时可以省略最后一行，只检查返回 JSON 中的 `resources.core`。

`gh auth login` 和 Pi 必须运行在同一个环境。Windows 中保存的登录不会自动出现在 WSL 中；仅完成 `gh auth login` 也不会让当前 harness 自动读取 gh 凭证，必须通过 `export GITHUB_TOKEN="$(gh auth token)"` 桥接。

### 使用 Fine-grained PAT

只读取公开仓库时使用最小只读权限。若还要学习私有仓库，只为目标仓库授予：

- Metadata：Read-only；
- Contents：Read-only。

在 WSL 中使用隐藏输入，避免 Token 进入 shell history：

```bash
read -rsp "GitHub token: " GITHUB_TOKEN
echo
export GITHUB_TOKEN
```

PowerShell 对应语法为：

```powershell
$env:GITHUB_TOKEN = Read-Host "GitHub PAT" -MaskInput
```

Bash 赋值不能写成 `env:GITHUB_TOKEN = ...`，等号两边也不能有空格。

## 3. 配置模型

最简单的方法是在 Pi 中执行 `/login`，选择 OpenAI、Anthropic、OpenRouter 或其他供应商，再通过 `/model` 选择模型；在模型选择器中按 `Ctrl+S` 可保存启动默认值。

也可以在启动 Pi 前设置环境变量。例如：

```bash
export OPENAI_API_KEY="<openai-api-key>"
# 或：export ANTHROPIC_API_KEY="<anthropic-api-key>"
```

检查认证：

```bash
npx pi auth check --provider openai
# 或：npx pi auth check --provider anthropic
```

GitHub Token 只用于检索参考仓库，模型 API Key 只用于 Pi 调用模型，两者不能互相替代。

## 4. 选择一种启动方式

### 本地开发当前源码

首次使用先安装依赖：

```bash
npm install
```

然后显式加载当前工作区 extension：

```bash
npx pi --no-extensions \
  -e ./integrations/pi/index.ts \
  --provider openai \
  --model <model-id>
```

`--no-extensions` 会关闭自动发现，但显式 `-e` 仍然生效。这样可以避免已经安装的 Imitator 和本地源码同时加载、竞争同一个状态文件。

### 使用 GitHub 安装版

只需安装一次：

```bash
pi install git:github.com/kunjinkao55/imitator_agent_harness
pi list
```

之后直接启动，不要再加本地 `-e`：

```bash
pi --provider openai --model <model-id>
```

安装版只包含已经推送到 GitHub 的提交；测试尚未推送的本地修改时必须使用上一节的本地开发方式。

## 5. 确认 Imitator 已加载

进入 Pi 后执行：

```text
/imitator-status
```

首次启动的正常状态是：

```json
{
  "phase": "idle",
  "candidates": 0,
  "slices": 0,
  "bundles": 0,
  "approvedRepositories": 0
}
```

如果 `/imitator-status` 是未知命令，说明 extension 没有加载。重新检查启动命令，以及本地路径 `./integrations/pi/index.ts` 是否存在。

随后运行健康检查：

```text
/imitator-doctor
```

正常结果应同时包含 `registry: ok`、`hooks: ok` 和 `store: ok`。任一项为 `failed` 时不要开始 prepare；先根据同一行的缺失注册或状态完整性原因修复启动环境。

## 6. 完整任务流程

### 6.1 准备参考包

可以直接向模型发送完整任务，让它自行调用 `imitator_prepare`。手动验证时执行：

```text
/imitator-prepare 为 TypeScript coding agent 实现 extension tool registry、lifecycle hooks 和持久化安全门禁
```

斜杠命令只执行 prepare，不会自动触发下一轮模型推理。完成后再发送普通消息：

```text
继续完成任务。先检查 Evidence Bundle 和必要切片，提交参考评审；不要开始编码。
```

模型应依次使用：

1. `imitator_get_evidence_bundle`；
2. `imitator_get_evidence`；
3. `imitator_submit_review`。

状态应从 `reviewing` 进入 `awaiting_confirmation`。

### 6.2 第一次人工确认：参考选择

先检查状态返回的运行目录，以及其中的：

```text
review-proposal/GATE_REPORT.md
review-proposal/APPROVED_EVIDENCE_BUNDLES.md
```

确认参考仓库、许可证、风险、Evidence Bundle 和引用切片合理后执行：

```text
/imitator-confirm
```

成功后状态进入 `distilling`，编码仍然锁定。

### 6.3 蒸馏 Design Dossier

发送普通消息：

```text
继续蒸馏 Design Dossier。区分 explicit、observed、inferred 和 unknown，完成本地 adopt/adapt/reject 映射并提交设计方案。
```

模型应调用 `imitator_submit_design_dossier`。确定性校验通过后，状态进入 `awaiting_design_confirmation`。

### 6.4 第二次人工确认：设计方案

检查：

```text
design-proposal/DESIGN_DOSSIER.md
design-proposal/ADAPTATION_BRIEF.md
```

确认本地约束、架构职责、不变量、失败语义、测试 oracle、negative space 和验收测试后，再次执行：

```text
/imitator-confirm
```

状态进入 `approved` 后，修改工具才会解锁。然后发送：

```text
现在根据已批准的 Design Dossier 开始编码，并运行项目测试。
```

完整状态流：

```text
idle
→ reviewing
→ awaiting_confirmation
→ distilling
→ awaiting_design_confirmation
→ approved
→ coding
```

开始新任务前执行：

```text
/imitator-reset
```

## 7. 常见故障

### GitHub API 403 / rate limit exhausted

先退出 Pi，在同一终端重新执行：

```bash
gh auth status
export GITHUB_TOKEN="$(gh auth token)"
```

确认认证额度后重新启动 Pi。必须先设置环境变量，再启动 Pi；运行中的 Node 进程不会自动获得后来设置的 shell 环境变量。不要使用 `sudo npx pi`，否则环境变量可能被过滤。

### Persisted Pi state failed its integrity check

这通常表示升级后状态 schema 改变、工作区 Git HEAD 改变、状态文件写入不完整或 checksum 不匹配。警告出现时 extension 会自动删除旧状态并回到 `idle`。先运行：

```text
/imitator-status
```

如果每次启动都重复出现，确认没有同时加载安装版和本地版。退出 Pi 后可删除生成状态：

```bash
rm -f .imitator/pi-state.json
```

随后重新启动并重新执行 prepare。旧审批不会迁移，这是 fail-closed 安全策略。

### Prepare 完成但没有开始编码

这是正常行为。Prepare 后需要发送普通消息触发模型完成参考评审，随后还要进行两次 `/imitator-confirm`。只有状态达到 `approved`，修改与 shell 工具才会解锁。

### 没有找到可接受参考

检查返回的六维评分、许可证、Atlas 覆盖和可读证据错误。没有适合的参考时系统默认拒绝放行；不要仅通过降低门槛绕过许可证或关键 source/test 证据要求。

## 8. 最小日常启动清单

```bash
cd "/path/to/your/project"
gh auth status
export GITHUB_TOKEN="$(gh auth token)"
test -n "${GITHUB_TOKEN:-}" && echo "GitHub auth ready"
npx pi --no-extensions -e /path/to/imitator_agent_harness/integrations/pi/index.ts
```

进入 Pi 后：

```text
/imitator-status
/imitator-doctor
```

然后直接描述编码任务，并要求 agent 按 Imitator 流程继续到等待人工确认的阶段。
