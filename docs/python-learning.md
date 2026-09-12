# Python 参考学习：静态语法与架构证据

Python 参考不再只能按目录与固定行数读取。Pi 接入了可选的 Python 标准库 AST/TOML 解析适配器，向模型提供更完整的设计证据；它不是新的推理模型，也不是运行时语义证明。

## 使用

本地需要 **Python 3.11+**（使用标准库 `ast`、`tomllib`），不需要 pip 安装任何包。Pi 每次 prepare 自动创建适配器，并在 Atlas 与切片之间复用有界解析缓存。

Linux/WSL 默认调用 `python3`，Windows 默认调用 `python`。如果默认命令不可用，启动 Pi 前显式指定**可信本地解释器**：

```bash
# WSL/Bash：替换为你的实际解释器路径
export IMITATOR_PYTHON='/usr/bin/python3'
"$IMITATOR_PYTHON" --version
```

```powershell
# Windows PowerShell：替换为你的实际解释器路径
$env:IMITATOR_PYTHON = 'C:\path\to\python.exe'
& $env:IMITATOR_PYTHON --version
```

该环境变量是解释器可执行文件路径，不是 shell 命令，不能写成 `python -m ...`。不要使用参考仓库内的解释器或启动脚本。设置后重启 Pi，用普通任务消息重新 prepare；旧 reference pack 不会自动补出 AST。

目标实现语言不必是 Python；只要选中的参考包含 `.py`、`pyproject.toml` 或 `setup.cfg`，Pi 就会尝试解析。任务领域、1–2 个参考限制和许可证策略保持不变；默认 advisory 自动 learn/skip，只有 strict 模式保留两次独立确认。

独立核心 API 的调用方可向 `prepareReferencePack` 注入 `sourceAnalyzer` 和 `semanticSelector`；核心不依赖或导入适配器。当前 `node src/cli.ts prepare` 仍不自动启动 Python 解析器，默认使用原来的结构索引与行窗口。不要把 Pi 的能力误认为所有调用入口都已启用。

## 新增证据

| 内容 | 目前提取什么 | 不代表什么 |
|---|---|---|
| 声明边界 | 类、函数、异步函数、嵌套限定名、装饰器起始行至完整结束行 | 不证明代码会成功执行 |
| 接口与职责线索 | 函数参数/返回注解、类基类、装饰器；Protocol、TypedDict、ABC/ABCMeta、abstractmethod、dataclass 的静态标记 | 不做类型检查、MRO、继承闭包或装饰器语义求值 |
| 数据契约与公共面 | 类体赋值/注解字段、`__init__` 中的 `self` 字段、默认值表达式；字面量 `__all__` 与公共绑定候选 | 不执行默认工厂；不推断动态字段，公共名称不等于有意承诺的稳定 API |
| 失败/测试线索 | 当前声明体内的 `raise`、`except`、`assert` 数量；测试/fixture 命名提示 | 不证明异常必达、测试充分或测试通过 |
| 模块关系 | 静态导入、别名、限定作用域、TYPE_CHECKING/if/try/except/循环/with/match 条件；常见包根与字面量配置根下的候选目标 | 不推断任意 `sys.path`、动态导入和条件是否成立；歧义不冒充已定位关系 |
| fixture—测试关联 | 参数请求、字面量 usefixtures/name、直接/间接参数化区别；同文件及祖先 conftest 的唯一可见候选 | 不验证 pytest 注入；插件、autouse、动态 getfixturevalue、继承与覆盖顺序未求解 |
| 项目规格 | PEP 621、Poetry、setup.cfg 的静态名称/依赖/脚本；setuptools/Poetry 的字面量源码根 | 不运行 setup.py、构建后端、动态元数据或 group includes；Poetry 约束不转换为可安装要求 |

异常与断言观察不跨越嵌套声明归属边界。例如方法中的 `raise` 不会被报成类体执行时的异常。测试角色使用 `test_` / `Test` 命名与 fixture 装饰器语法提示；支持唯一、未冲突的模块级导入别名，对重绑定/遮蔽保守放弃框架标记，不进行全作用域名称分析。自定义测试收集规则和实际框架身份不能仅凭名称确定。

源码识别增加了常见顶层 Python 包布局（如 `cache/core.py`），入口索引识别 `__init__.py`、`__main__.py` 和静态脚本入口，`conftest.py` 被视为测试支持文件。文件存在或 fixture 存在不等于有有效行为测试，独立评审仍须检查实际测试内容。

导入目标必须实际存在且可唯一定位。常见入口根为仓库根、`src`、各 Python manifest 所在目录及其 `src`，以及安全的字面量源码根。绝对路径、上级目录、通配符不会成为解析根。任意父包前缀跨根歧义也会阻止建边，即使叶子模块文件唯一；多个 namespace portion 也保守视为未解决，不猜加载顺序。外部模块、超出包根的相对导入不建立边。`from pkg import name` 可能在包导出与子模块之间产生运行时差异，因此图只表示静态候选关系，不能当作已验证调用图。

`__all__` 字面量列表/元组及直接 `+=` 可记录为 `static`；观察到条件写入、方法修改或动态赋值时标为 `dynamic`。没有显式列表时只提供 `implicit` 公共绑定候选。这不是对所有 Python 导出机制的完整解释。

## 先读到证据，再计算覆盖

新 Atlas 标记 `coverageBasis: "read-content-v2"`。目录树中的模块、入口、测试/文档索引仍可保留，但**不能仅凭文件存在赚取覆盖分**；覆盖来源必须是预算内完整读取的非空文本。Python source 要有实际声明观察，test 要有非类、非占位的测试函数体；`conftest.py` 单独标为 `test-support`，不是实现或行为测试。自定义测试 oracle 不必使用字面量 `assert`，而有测试体也不证明测试有效。

读取优先为源码与测试保底，再轮询 manifest、overview、design、automation 缺口。类别尚未形成证据时定向尝试该类别的其他候选，每次失败也占用 `atlas.maxFiles`；不无界扩大请求。最多尝试两个 `__init__.py`，优先非包入口。切片也优先实际覆盖来源，避免大量包入口挤掉核心实现。

空、不可读、二进制、超大或截断文件留下 `readFailures`；覆盖不足仍拒绝学习，并保留读取原因。总字符预算耗尽时不会继续补读。默认七项权重和 source/test 必需项不变：分数衡量有限样本是否够进入审查，不是整个项目的语义覆盖率。解析不可用时只允许保守文本模式识别声明以及带 assertion 的测试候选，analysisQuality 保持 textual；其他未增强语言仍使用通用非空内容门槛，差异会明确进入质量负空间。

配置文件的 `parseStatus` 区分 `parsed`、`partial`、`indexed` 等状态。Poetry、setup.cfg 或含动态/组引用的元数据明确不算完整解释；未知 pyproject 格式只索引，不报告空元数据为完全解析。此处 `partial` 描述元数据解释范围，不表示拿截断文件声称完成 AST。

## 输出在哪里

- `DESIGN_ATLAS.json` / manifest 的 Atlas 中，`sourceAnalyses` 保留文件路径、固定 commit 的来源链接、解析状态与限制；`sourceRoutes` 另行记录为何选择该解析器及其 fallback。
- `analysisQuality` 与切片 `evidenceStrength` 把文本可读、完整 AST、静态关系和跨模态印证分开；这些观察不增加仓库设计总分。
- `DESIGN_ATLAS.md` 展示 Python 声明、字段、契约标记、导出、条件导入、异常与测试线索，以及读取失败原因。
- Atlas 的 `unresolvedImports` 保留未定位原因、条件与作用域；`fixtureRelations` 使用 `candidate/unresolved`，不伪造已验证的注入关系。
- Pi prepare 仅预览每文件最多 8 个声明、12 个导入；完整的有界观察在 Atlas 中。结构摘要不是替代源切片的评审证据。
- 成功选择的 Python 声明切片标为 `strategy: "python-ast"`，`symbols` 记录限定名，`sourceRoute` 记录实际是否降级，原始代码、行号、许可证和 commit 来源保持可追溯。
- 关系进入现有 Evidence Bundle，并使用已有 `relationships-evidence` 信号（10 分）；没有额外“Python 更优秀”加分。
- Python 关系带 `resolution: "static-candidate"`，Bundle 同时声明运行时导入未验证以及包导出遮蔽的限制，不把候选文件边升级为确定的运行时依赖。

AST 窗口优先使用任务词在符号名和声明内容中的匹配，权重分别为 8 和 5；并列按源码顺序确定。完整类过大时可选择预算内的完整方法；这种方法片段不等于完整类的独立实现，所属类可通过限定名和 Atlas 检索。当前每个文件仍只选一个窗口，不保证覆盖全部关键能力。

## 安全、预算和降级

参考内容只作为 JSON 经 stdin 传给仓库自带的可信解析脚本。进程以 `-I -S -B` 启动：隔离 Python 环境/工作目录导入路径，不加载 site hooks，不生成 pycache。没有 `eval`、执行型 `exec`、上游模块导入、包安装或构建步骤；解析器只构建 AST 或 TOML/INI 数据。

每文件输入最多 120000 字符；默认解析超时 2 秒、输出缓冲上限 2 MB；解析结果最多 200 个声明与 200 个导入，并压到 32000 字符 JSON 预算。Atlas 的完整语法观察另设 40000 字符预算，超限保留状态说明。缓存每次 prepare 独立，最多 128 项。进程超时和输入预算减少风险，但不等于操作系统级内存沙箱。

解析状态包括 `parsed`、`invalid`、`unavailable`、`budget-exceeded`。Python 不存在、版本不支持语法、输入损坏、进程超时等情况下，不把部分文本冒充完整 AST。Atlas 对被字符预算截断的文件不进行完整语法解析。

切片没有合适的完整声明时会退回 `line-window`；已选中的完整 AST 声明如果放不进剩余总字符预算，则跳过该片段，不在保持 AST 标志的同时截断它。Pi 的 Python 解析不可用/失败时保留状态：完整读取且匹配保守声明/测试候选的内容仍可满足 modality coverage，但只能成为 textual evidence，不能产生 syntactic、resolved 或 corroborated 主张。未注入适配器的核心调用方同样使用保守文本门槛；两者都不声称完成 AST 理解。

## 验证与边界

```bash
# 设置 IMITATOR_PYTHON 后，在 harness 根目录执行
node --test test/python.test.ts
npm run check
```

测试包含真实标准库解析、装饰器/注解/嵌套声明、异步方法、字符串里的伪代码、异常归属、CRLF、语法错误、缺失解释器、有界窗口、TOML/INI、导入歧义、Atlas→切片→Bundle 和来源保留。新增合成项目反例覆盖大量包入口、空/占位测试、读取失败补齐、父包歧义、条件/别名/局部导入、字段/契约/导出、fixture 可见性与参数化、Poetry 和自定义源码根。安全反例在待解析文本中放置顶层文件写入与异常，检查它们没有执行。

本轮完成的是证据读取、导入语义保真与架构结构提取三个工程步骤。**人工标注的真实 Python 项目评估尚未进行**；这些回归测试不能替代真实项目的架构召回率测量或普通 Pi / 增强 Pi 的模型对照实验。

没有解释器时，真实解析测试明确 skip；只看到其他单测通过不能声称已验证 Python AST。此增强仍不能自动证明领域相同、架构优秀、注解正确、异常真的可达或测试真的有效；也不进行 Python 类型推导、全程序数据流、调用图、metaclass/monkey patch 分析。最终的设计解释仍由 agent 和独立 judge 对照源码与本地需求完成。
