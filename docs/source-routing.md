# 源码语义路由

Pi 不再按 `Python → Rust → TypeScript` 顺序试探解析器。每个文件先经过一次确定性的路径路由，再交给至多一个深度适配器；多语言仓库会逐文件选择，不使用 GitHub 的仓库主语言替代真实文件类型。

## 默认路由

| 文件 | 适配器 | 能力 |
|---|---|---|
| `.py`、`pyproject.toml`、`setup.cfg` | `python-stdlib-ast` | 静态语法/manifest 分析；Python 源码完整声明切片 |
| `.rs`、`Cargo.toml` | `rust-static-syntax` | 静态语法/manifest 分析；Rust 完整声明切片 |
| TS/JS/TSX/JSX/MTS/CTS/MJS/CJS | `typescript-compiler-ast` | 完整语义单元切片 |
| 其他文件 | `structural-fallback` | Atlas 通用结构索引与确定性行窗口 |

路由只表示选中了什么能力，不表示解析成功。已支持语言返回 `invalid`、`unavailable` 或 `budget-exceeded` 时，不会继续拿另一种语言的 parser 猜测；切片可退回 `line-window`，Atlas 仍保留原失败状态。若两个扩展适配器同时声明同一路径，路由以 `ambiguous` fail closed，两个解析器都不运行。

`DESIGN_ATLAS.json` 的 `sourceRoutes` 记录 `selectedAnalyzer`、具名 `routeReason`、能力、解析状态与预定 fallback。每个 evidence slice 的 `sourceRoute` 还记录实际得到 `semantic-window` 还是 `line-window-fallback`。这些字段进入 Pi prepare 预览和 judge 的 review request。

## 增加下一种语言

新适配器实现 `SourceLanguageAdapter`，提供唯一 `id`、只依赖路径的稳定 `match(path)`，以及 `analyze`、`selectWindow` 中至少一个。通过 `createDefaultSourceRouter({ additionalAdapters: [...] })` 注册：

```ts
const goAdapter: SourceLanguageAdapter = {
  id: "go-static-v1",
  match: (path) => path.endsWith(".go") ? "extension:.go" : undefined,
  analyze: analyzeGoWithoutExecutingUpstream,
  selectWindow: selectCompleteGoDeclaration,
};

const router = createDefaultSourceRouter({ additionalAdapters: [goAdapter] });
```

随后用 `{ sourceRouter: router }` 把整套路由一次性注入 `prepareReferencePack`。兼容接口仍允许分别注入三个函数，但不能与 `sourceRouter` 混用。语言名和切片 `strategy` 都允许新适配器使用自己的稳定名称，无需修改路由核心。适配器仍须遵守输入/输出预算、确定性、不执行上游内容、保留失败状态等工程契约。

核心 CLI 默认不导入 `integrations/`；provider-neutral 调用方可以自行组合同一接口。通用路由类型在 `src/source-routing.ts`，默认语言注册表在 `integrations/source-router.ts`，依赖方向仍是 `integrations → src`。

## 验证

```powershell
node --test test/source-router.test.ts
npm run check
```

路由回归覆盖多语言逐文件选择、Windows 路径归一化、未知语言降级、解析失败不串线、重复 ID、路径所有权歧义、额外语言插槽，以及 Atlas/切片/render 的审计字段。
