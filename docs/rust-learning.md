# Rust 参考学习：静态语义与模块架构证据

Pi 的 Rust 增强从参考源码中提取有界、可追溯的静态结构，帮助 Design Dossier 讨论职责、契约、错误边界和测试概念。它不编译、不运行、不安装参考仓库，也不把静态候选关系描述成已经验证的运行时事实。

## 启用方式

Pi 默认运行时通过逐文件 Source Router 同时注册 Python、Rust 和 TypeScript/JavaScript 的分析入口。Rust 分析器使用 harness 内部的 dependency-free lexer/结构解析器，不依赖本机安装 Rust、Cargo、rust-analyzer 或第三方 parser。重新启动 Pi 并执行新的 prepare 后生效；旧 reference pack 不会自动升级。

核心 API 调用方可注入组合后的 `SourceAnalyzer` 和 `SemanticSliceSelector`。`node src/cli.ts prepare` 仍保持 provider-neutral 的结构/窗口路径，不自动导入 integration adapter。

## 提取内容

| 证据 | 静态观察 | 明确不证明 |
|---|---|---|
| 声明与公共面 | struct、tuple struct、union、enum、trait、impl、fn/async/const/unsafe/extern fn、type、const/static、macro_rules、pub/pub(...)、属性和完整行范围 | 名称解析、类型正确、ABI 正确、API 稳定性 |
| 数据与契约 | 命名/tuple 字段、枚举 variant、trait/auto/unsafe trait、关联类型/方法、inherent/trait impl、实现目标 | layout、MRO 等价物、对象安全、coherence 或 trait solver 结果 |
| 失败与风险 | Result 返回、`?` 传播、panic/todo/unimplemented 宏、assert 宏、unsafe 语法次数 | 分支可达、错误类型闭包、panic-free 或 soundness |
| 模块与导入 | `mod`、`use`、分组名称/别名、作用域、cfg/cfg_attr/path 条件，crate/self/super 的常规文件候选 | extern prelude、宏生成模块、feature 取值、glob 展开、item 与 module 身份 |
| 测试结构 | `#[test]` 及限定测试属性、`#[cfg(test)]` 模块、内嵌于 src 的单元测试、断言数量 | 测试能编译/通过、异步 runtime 存在、oracle 充分性 |
| Cargo 规格 | package 名、edition、依赖/dev/build 依赖、features、workspace members、lib/bin/example/test/bench 显式 target | workspace 继承、target cfg 选择、patch、feature unify、build.rs 或 proc macro 结果 |

Cargo 解析结果当前明确标为 `partial`。只有显式 target path 写入 manifest 观察；Atlas 会在仓库树中实际存在时补充同目录的 `src/lib.rs` / `src/main.rs` 入口，不凭约定制造不存在的文件。

## 内嵌测试与覆盖门禁

Rust 单元测试通常位于 `src/lib.rs` 或实现模块，而不是单独的 `tests/` 目录。Atlas 的 `read-content-v2` 门禁优先使用成功解析的真实 `#[test]` 函数体；解析失败时只接受同时含测试属性、函数和 assertion 宏的保守文本候选，并把强度限制为 textual。普通源码文件名本身不会产生测试分。

同一文件同时包含实现和测试时，slicer 会生成各自完整声明窗口，并为精确窗口记录 `evidenceRoles`。pipeline 和 Evidence Bundle 可因此分别确认 implementation/test，而不会因为一个文件路径同时承担两种职责就把任意片段重复解释为两类证据。空测试体不满足测试门槛。

根目录 `build.rs` 是构建支持，不计作应用 source，也不作为普通实现切片。它仍保留在仓库树中，但不会用构建逻辑替代产品实现证据。

## 关系的保守含义

Rust 文件关系标记为 `resolution: "rust-module-candidate"`。下列规则只建立文件系统候选：

- `mod store;` 在常规模块目录中查找唯一的 `store.rs` 或 `store/mod.rs`；
- inline mod 的词法作用域参与子模块目录计算；
- `crate::`、`self::`、`super::` 只在同一常规 `src` crate 根内解析；
- `#[path = ...]` 不猜路径，记录 `explicit-path-module-unsupported`；
- bare use 可能来自 extern prelude，默认记录为未解决；
- cfg、测试条件、别名、词法作用域和来源行保留在 Atlas 中。

嵌套 use tree 当前只在共同前缀保留观察，glob 与最终名称究竟是 item 还是子模块不求值。Evidence Bundle 会附带对应限制，不能把这些边升级为已验证调用图。

## 切片、预算和安全

lexer 跳过行/嵌套块注释、普通/byte/C/raw string 和字符字面量，因此其中的伪代码不会生成声明、测试、panic 或断言信号。分隔符失衡、字符串/注释未终止时返回 `invalid`，不发布部分结构。

输入限制为每文件 120000 字符；每份结果最多 200 个声明、200 个导入，并受 32000 字符 JSON 预算限制。Atlas 另有 40000 字符语义元数据总预算。缓存限于单次 analyzer 实例的 128 项。完整声明超出单片行数或剩余字符预算时跳过，不截断后仍声称 `rust-syntax`。

所有远程字节只作为字符串交给可信本地解析代码。流程不调用 rustc/cargo/rust-analyzer，不克隆、构建、安装或执行参考代码，不加载 build.rs/proc macro。该 parser 是有界结构观察器，不是完整 Rust grammar、编译器前端或操作系统沙箱。

## 验证与剩余边界

```powershell
node --test test/rust.test.ts
npm run check
```

回归覆盖注释/字符串伪代码、声明/字段/trait/impl/错误信号、条件 use、extern 拒绝、常规模块与 inline scope、显式 path 拒绝、Cargo 工作区/依赖/target、内嵌测试覆盖、双角色切片、Atlas→Bundle 和完整 pipeline。

当前没有宏展开、完整 use-tree flatten、跨 workspace crate 图、Cargo.lock 分析、类型/生命周期/borrow checker、调用图、数据流、unsafe soundness 或真实编译测试。合成测试证明边界规则可重复，不证明对真实大型 Rust 项目的架构召回率，也不证明增强 Pi 的模型输出优于普通 Pi；这些属于后续人工标注项目与端到端 eval。
