# 两端 UI 解耦基线（桌面 ↔ 移动）

> **状态**：**已评审通过（261012 移动端会话，含 4 处修改）** —— 本文件定位为**逐项归属基线**（谁定义什么），**不再是待评审草案**。
> **执行方案在看 `docs/MOBILE-UI-REDESIGN.md`**（范围三层 / IA 冻结清单 / 皮肤取值表 / P0–P7 任务书）；长期判据在 `docs/MOBILE-TECH-STACK.md` §九。
> 评审对象 = **§0 评审清单**（结论见下），修改处已在本文件对应表里就地标注。
> **背景（用户 261012 定方向）**：移动端要有**自己的设计语言**（自有原语/几何/密度/动效），**不再复用**桌面的设计原语；
> 但**技术方案与桌面一致** —— 统一收口成可复用原语、有类型/单一来源、**不重复写代码**。即：两端各一套设计系统，
> 共享的只有**内核与逻辑**。
> **用法**：逐项在「归属」列签字；移动端会话按「移动端自建」列建原语，桌面会话按「桌面侧动作」列去耦合 + 上护栏。
> **不要**照本宣科大爆炸重写：护栏先立（允许红），按 §5 顺序分批转绿。

## 0. 评审清单（请移动端会话逐条回「是/否/改」）
1. **四层边界**（§0）是否同意？特别是：**品牌与语义槽共享**、**行为与契约共享**、**视觉/几何/动效彻底分叉**、**内核渲染外观分不了**。
2. **层 1（品牌/语义槽）要不要也分叉？**（若"要" ⇒ 接受双份主题维护。）
3. **内核(lakex)正文/卡片/表格外观两端一致**是否接受？（我认为只能接受。）
4. **移动端新类名前缀**用什么？（建议 `md-*`；`mobile-*` 已被既有类占用。）
5. **§3 的五条护栏**是否接受"先立、允许红、分批转绿"的推进方式？有没有更省的路径？
6. **§2.3 的 6 个共享 UI 组件**：变体化（`variant`/平台类）可接受，还是你们更想各自复制一份？
7. **工作量与顺序**（§4）是否认可？是否需要把某个阶段提前/拆小？
8. **补充**：你们那边已定的移动端设计语言（色板/密度/动效）能否给一份清单？我可以据此把 §2 的归属表逐行对齐。

> **评审结论：可行（4 处修改）** —— 移动端会话 261012。
>
> | # | 他们的问 | 我的回 |
> | --- | --- | --- |
> | 1 | 四层边界 | **同意**（比移动端自己那版更准，采纳） |
> | 2 | 层 1 是否也分叉 | **不分叉（采纳）**，但**补一条不变量**：移动端不得 import 桌面的**取值文件**（`themes/**`）——否则"语义槽共享"会退化成"取值共享"，桌面改色板仍会静默改移动端 |
> | 3 | 内核外观两端一致 | **接受**（只能接受；否则等于 fork 内核，AGENTS §3#18 不做） |
> | 4 | 新前缀用 `md-*`？ | **❌ 改**：`md-*` 与既有 `.md-preview`（Markdown 排版，41 处）**撞族**。改用 **`mb-*`**（实测 `.mb-` 占用 **0**；`mobile-*` 已被外壳 278 处占用，保留不动） |
> | 5 | 护栏先立、允许红、分批转绿 | **接受**，并加一条：**基线只许降**（对齐桌面 `cssLayers` 的做法） |
> | 6 | 6 个共享 UI 组件变体化 | **接受变体化（不复制）**；但 **§2.3 的分类要改**：`settingsPrimitives` 是 **143 行 / 10 个 UI 组件**（Group/Item/Field/Block/Switch/Shortcut/Seg/NumField/TextField/Section），**不是纯逻辑** ⇒ 应归"移动端自建" |
> | 7 | 工作量与顺序 | **基本认可**（~64 处 + 150–250 规则 + 6 组件 = 独立批次）；顺序**插一步"样板屏（设置页）"**验证骨架，最终以 `MOBILE-UI-REDESIGN.md` §6 的 P0–P7 为准 |
> | 8 | 要移动端设计语言清单 | **已给**：`MOBILE-UI-REDESIGN.md` §5（39 个语义槽颜色映射 + 几何档位 + 交互形态清单 + 偏离项）。来源 = 你我都可复用的 `yuque-re` 静态提取（颜色令牌）+ 反编译 RN bundle 数值分布（几何） |
>
> **范围澄清（用户 261012，很容易读偏）**："分叉"= **皮肤层 + 页内交互形态**；**信息架构 / 页面层级冻结**（小记·知识库 第一层 → 笔记 第二层这种不动）；弹层改底部 Sheet 这类**页内交互属于允许范围**。

## 1. 边界（先认死，否则会撞墙）

| 层 | 归属 | 理由 |
| --- | --- | --- |
| **品牌与语义槽**：`--lake-*` 的**变量名/语义**（text/bg/border/accent/status/z 阶梯/尺度 ramp）+ 品牌色、状态色 | **共享** | 分叉它 = 三套主题维护两遍、品牌分裂。移动端要的是**取值与几何**不同，不是另一套命名 |
| **行为与契约**（**不是样式**）：`Overlay` 的 portal/层序契约、`usePopoverPosition`、焦点环与 a11y 契约、内核样式引入护栏 | **共享** | 分叉这些会成对出 bug，收益为零 |
| **视觉/几何/动效/原语**：kit 14 件、浮层件、弹窗、小记外壳、密度与点按目标、动效曲线 | **分叉**（本文重点） | 这就是"移动端自己的设计语言" |
| **内核(lakex)自己渲染的外观**：正文/卡片/表格/画板 | **分不了** | 闭源内核 CSS 决定（我们只做变量桥接 `kernel-theme.css`）⇒ 两端**正文观感一致**；除非 fork 内核（AGENTS §3#18 明确不做） |

## 2. 现状（261012 实测）

| 面 | 数字 |
| --- | --- |
| 移动端入口 import 的桌面样式层 | **10 个**：`themes/`×4、`tokens.css`、`compat.css`、`kit.css`、`components.css`、`dialog.css`、`app/quick-notes.css`、`features/{image-lightbox,attachment-preview}.css` |
| 移动端 tsx 里的桌面类名 | `.ln-*` **56 处 / 10 文件**；`.b3-*`·`fn__*` **8 处 / 3 文件** |
| 移动端 import 的桌面模块 | **69 条**：`lib/`(13 文件)、`features/`(21 模块)、`components/`(2：`treeDrag`/`settingsPrimitives`) |
| 桌面样式里的移动端分支（反向耦合） | **19 行 / 2 文件**（`kit.css` 18 行 checkbox/radio 的 `:is(.app-shell,.mobile-app)` + `tokens.css` 1 条注释） |
| 移动端自有 CSS 体量 | `mobile.css` 348 + `editor-dock.css` 57 + `mobile-kit.css` 40 ≈ **445 条规则**（桌面 ~2100） |

### ⚠️ 关键发现：`ln-` 命名空间**已经是混用的**
| 来源 | 类名 |
| --- | --- |
| **桌面 kit 定义**（`styles/kit.css`） | `.ln-btn` `.ln-iconbtn` `.ln-row`(+__title/__icon) `.ln-list` `.ln-input` `.ln-select` `.ln-tag` `.ln-form__desc` `.ln-ellipsis` |
| **移动端自建**（`mobile/mobile.css`） | `.ln-indent` `.ln-chevron` `.ln-chevron-spacer` `.ln-tree-icon` `.ln-menu-note` `.ln-menu-head-action` `.ln-row__action` |
| **移动端覆盖**（`mobile/mobile-kit.css`，即"密度补丁层"） | `.ln-row` `.ln-row__title` `.ln-row__meta` `.ln-row__chevron` `.ln-select` `.ln-input` |

⇒ 现状 = **桌面 kit + 移动端覆盖层 + 移动端自加**，三样共用一个前缀 ⇒ 看不出"谁是谁的"，也解释了两端为何容易互相牵动。
**解耦的机械核心** = ① 移动端自建类名换到**新前缀**；② 移动端**重新实现**（而非覆盖）它现在覆盖的那些原语；③ 桌面删掉为移动端开的分支。

## 3. 逐项归属

### 2.1 样式入口（10）
| 入口 | 用途 | 归属 | 动作 |
| --- | --- | --- | --- |
| `themes/{base,light,dark,warm}.css` | 品牌 + 语义槽 | **共享** | 拆成「共享语义槽 + 两端取值层」；移动端加 `mobile-theme` 覆盖几何/密度/圆角/动效时长 |
| `tokens.css` | 非令牌基础规则（keyframes/焦点环/reduced-motion） | **共享** | 保持（它是契约不是视觉） |
| `kit.css` | 桌面 14 件原语 | **移动端停用** | 移动端在自有 kit 里重建（见 2.2） |
| `components.css` | 共用浮层件（seg/badge…） | **移动端停用** | 移动端自建；桌面顺带清移动端分支 |
| `dialog.css` | 浮层通用弹窗 | **移动端停用** | 移动端自建（`ConfirmDialog` 已大半自有） |
| `app/quick-notes.css` | 小记容器 + 卡片 | **拆** | 容器逻辑共享、**视觉移动端自建** |
| `compat.css` | 思源类名契约 | **桌面保留 / 移动端停用** | 移动端 8 处 `b3-*`/`fn__*` 改写（见 2.2） |
| `features/{image-lightbox,attachment-preview}.css` | 图片灯箱 / 附件预览 | **组件级共享 → 变体化** | 见 2.3 |

### 2.2 类名迁移清单（现状 → 归属）
| 现用类名 | 现在谁定义 | 移动端归属 | 备注 |
| --- | --- | --- | --- |
| `.ln-btn`(+--primary/--secondary/--danger) | 桌面 kit | **移动端自建按钮原语** | 2 文件在用 |
| `.ln-row` + `__title/__meta/__action/__icon/__chevron` | 桌面 kit **+ 移动端覆盖** | **移动端自建行原语** | `__action` 本来就是移动端自加的 |
| `.ln-list` `.ln-input` `.ln-select` `.ln-iconbtn` `.ln-tag`(+--pending) | 桌面 kit | **移动端自建** | `mobile-kit.css` 现在是覆盖，改成重新实现 |
| `.ln-ellipsis` | 桌面 kit（工具类） | **移动端自建**（2 行）或明确定义为共享工具层 | 6 文件在用，建议自建以免**工具层**也被裹进解耦争议 |
| `.ln-indent` `.ln-chevron` `.ln-chevron-spacer` `.ln-tree-icon` `.ln-menu-note` `.ln-menu-head-action` | **移动端自己** | **只改前缀**（本就是移动端原语） | 换到新前缀即可，零风险 |
| `b3-list-item` `b3-list` `b3-menu*` `b3-dialog` `b3-label` `b3-switch` `b3-button--outline` `b3-theme-error` `fn__size200` `fn__space` `fn__flex-1` | compat.css（思源契约） | **改成移动端类名** | 8 处 / 3 文件；桌面继续按契约保留 compat.css |

### 2.3 复用的桌面模块（21 features + 2 components）—— 只有 6 个是 UI
- **纯逻辑/契约（继续共享，与样式无关，不要动）**：
  `editor/lakeRuntime` · `editor/editorCommands` · `editor/clipboardHtml` · `editor/noteRef` · `editor/resourceUpload` ·
  `attachment/attachmentPreviewController` · `usheet/univerTheme` · `usheet/usheetKernelContract` ·
  `editor/selectionToolbar/{colorMemory,selectionToolbarModel,linkEditor,kernelUiAtoms}` · `quickNotes/quickNoteToolbarWidgets` ·
  `components/treeDrag` · `components/settingsPrimitives` · `lib/**`
- **UI 组件（必须变体化，**不要复制组件**）**：

| 组件 | 逻辑部分 | 样式分叉方案 |
| --- | --- | --- |
| `editor/LakeEditor` | 内核挂载 + prefs（共享） | 宿主类名由平台决定；移动端宿主类走自有前缀 |
| `attachment/AttachmentPreview` | 预览调度（共享） | **移动端自建外观**（自有浮层原语） |
| `editor/ImageLightbox` | 灯箱交互（共享） | 移动端自建外观（全屏手势）+ 自带 CSS |
| `quickNotes/QuickNoteEditor` | 内核实例 + 工具条（共享） | 容器/工具条样式移动端自建 |
| `quickNotes/QuickNotePreview` | 解析器 + 兜底判定（共享） | 渲染层移动端自建 |
| `bitable/FileKindIcon` | 纯逻辑 + 图标 | 无样式分叉 |

### 2.4 桌面侧要清的**反向耦合**（19 行）
- `styles/kit.css` **18 行**：`:is(.app-shell, .mobile-app) input[type=checkbox|radio]…` ⇒ 移动端分叉后**收窄回 `.app-shell`**
- `styles/tokens.css` 1 条注释（引用 `.mobile-htab`）⇒ 顺手改正

## 4. 护栏（每条都写成可断言的测试，**先红后绿**）
1. **import 白名单**：`src/mobile/**` 不得 import `styles/{kit,components,dialog,compat}.css`（现状红：`mobile/main.tsx` 4 条）。
2. **类名归零**：`src/mobile/**/*.tsx` 里 `ln-*` / `b3-*` / `fn__*` 计数 = **0**（现状 56 + 8）。
3. **前缀归属**：`ln-*` 只允许出现在 `src/styles/**` 与桌面 tsx；移动端类名走新前缀（建议 `md-*`）。
4. **两端各自基线**：移动端新建一份 `cssLayers` 基线（现在只有桌面那份）+ `ui-metrics` + `check:mobilesnap`（6 态）+ 设备级截图。
5. **主题双份**（仅当层 1 也分叉）：主题切换测试要覆盖两端取值层。

## 5. 工作量与顺序
- **粗估**（按 §1 数字）：类名替换 **~64 处** + 移动端原语补齐（约 **150–250 条规则**）+ **6 个组件变体化** + 护栏/装置 ⇒ **独立批次**，不是顺手改。
- **顺序**：① 本表定稿 → ② 先立护栏（允许红）→ ③ 移动端 kit（原语）→ ④ 浮层/弹窗 → ⑤ 小记外壳 → ⑥ 组件变体化 → ⑦ 清反向耦合 + 摘护栏。

## 6. 待拍板（3 条）
1. **层 1（品牌/语义槽）是否也分叉？** 建议**不分**（分开后主题维护 ×2）；若要求"移动端连色板都独立"，需接受双份主题。
2. **内核正文/卡片/表格外观两端一致**是否接受？建议**必须接受**（否则等于 fork 内核）。
3. **移动端新类名前缀**用什么？建议 `md-*`（`mobile-*` 已被既有类占用，混用会重演今天 `ln-` 的问题）。
