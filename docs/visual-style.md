# 视觉风格学习与静态审计

Imitator 的视觉能力完全位于插件内；不加载 extension 的普通 Pi 没有视觉路由、风格规格或审计工具。当前实现不调用多模态模型，也不声称能从截图判断美感。

## 为什么不自动搜索“好看的 GitHub 仓库”

Star、README、组件库名称和代码工程质量不能证明页面视觉质量。在没有视觉模型的情况下，自动搜索会把不可靠的风格猜测加入上下文。因此视觉任务不进入普通 GitHub precedent pipeline，而是从六个内置 seed 风格原型选择一个：general product、data console、editorial docs、expressive marketing、productivity editor、commerce catalog。

这些原型不是第三方品牌复制品，也不包含上游源码。每个原型明确 palette 角色、字体方向、布局密度、空间节奏、圆角/层级、动效、适用场景和应避免的模式。它们是待 A/B 和人工视觉检查校准的初始先验，不冒充已经由设计师验证的审美标准。

## 路由

`imitator_learn` 根据四个具名信号决定是否进入视觉分支：

| 信号 | 分值 | 例子 |
|---|---:|---|
| `explicit-visual-language` | 50 | UI、视觉、审美、布局、响应式 |
| `user-facing-surface` | 30 | 页面、dashboard、landing、文档站、商城 |
| `frontend-stack` | 20 | React、Vue、CSS、Tailwind、前端 |
| `visual-quality-requirement` | 20 | polished、精致、品牌感、去 AI 味 |

阈值为 50，并且必须出现明确视觉语言，或者“用户界面表面＋前端栈/视觉质量要求”。例如 React 状态竞争修复只有 20 分，不会因为使用前端框架而误入视觉路线。

## 本地源码提取

插件只读扫描最多 5000 个目录条目和 256 个候选，最终读取最多 48 个、总计 160000 字符的 CSS/SCSS/Less、HTML、TSX/JSX、Vue/Svelte、Tailwind/theme/token 文件。它不跟随 symlink，忽略 `.git`、`.imitator`、`node_modules`、构建输出和依赖目录，不执行任何文件。

当前提取：

- CSS custom property 定义与引用；
- 颜色、字号、圆角、边框、阴影和渐变；
- media query 与 Tailwind 响应式 utility；
- card/panel/tile 类词法信号；
- pure-black 和常见 near-black background/token 信号。

结果形成 `VISUAL_SPEC.json/.md`、基线审计和不含源码的 source index。

## 实现后审计

模型完成视觉实现后调用 `imitator_visual_audit`。它按选中原型检查：

- pure-black surface；
- 边框或 card/panel 饱和；
- 单一圆角机械重复；
- 字体层级不足；
- 响应式证据缺失；
- 与原型冲突的渐变；
- 大量 raw color 且缺少 semantic token。

每项发现都有具名 signal、严重度、证据路径和修复建议。一次任务最多进行“实现审计＋修复后复审”两次，防止模型为了启发式分数无限改样式。审计不重新上锁，也不需要人工确认。

## 能力边界

静态源码无法知道 selector precedence、运行时条件、字体是否加载、图片质量、实际几何布局、像素节奏或品牌适配。因此：

- `clean` 只表示没有触发已配置的源级反模式，不表示页面漂亮；
- class-name 计数可能包含未激活代码；
- 本地已有设计系统和明确用户要求优先；
- 对视觉质量敏感的发布仍应由人查看实际渲染页面。

下一阶段可以在插件 integration 层为**本地生成项目**增加浏览器 DOM geometry/computed-style 报告；它仍可以由文本模型读取，不需要视觉 API。远程参考项目依然不会被 clone、安装、构建或执行。
