# Lake Notes Electron — 项目记忆（AGENTS.md）

> 本文件是本项目的**长期记忆**，每次会话自动加载。接手顺序固定为 **README → HANDOFF → AGENTS**：README 看概览，HANDOFF 看当前状态/待办/坑，本文看长期红线与机制。
> 用户反复强调的背景与原则都写在这里，**不要等用户重复**。
> **本文只写长期内容**（红线/机制/坑）：分支名、commit hash、测试计数、当前焦点等易过期事实一律放 `HANDOFF.md` §0。

## 1. 项目是什么

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo S3 兼容 API）。**本地是真相，S3 只是镜像。**

- 目录：`/Users/admin/file/local-lake/lake-notes-electron`
- 开发分支：`master`（唯一持续演进的业务分支；历史分支一律已合入并删除，勿基于它们开发）
- Node：**必须优先 Node 24**：`$HOME/.nvm/versions/node/v24.18.0/bin`
- Electron：**44.3**（`package.json` 为 `^44.3.0`，以实际安装版本为准）；better-sqlite3 13.x（N-API 单二进制、无需 rebuild）
- **目标数据量级**：压测做到 **10 万文档 / 100 万附件**（≈100k notes / 1M assets）。性能与同步决策按此量级验证，**勿用"小库正常"下结论**；同步/搜索/GC 相关改动的预期场景均以此为准。

## 2. 长期方向与文档分工

- **长期焦点**：同步/存储热路径的性能与健壮性、移动端编辑收口、可维护性（安全、IPC、资源服务、渲染层职责、测试覆盖、大文件按领域分批拆）。
- **具体待办与优先级只在 `HANDOFF.md` §3 维护**（`docs/TODO.md` 已删：历史总表无独立文档，权威待办只看 HANDOFF §3）。
- 删除/恢复语义与 Electron 43 升级均已验收，后续改动必须保持现有同步语义（§3 原则 1~17）与全绿门禁。
- 先修 Critical/Warning，再按模块拆分大文件；不在没有测试护栏的情况下进行大规模架构重写。
- **编辑器内核（lakex）资料检索顺序 —— 涉及调用内核 API/配置项/命令时必走**：
  ⓪ **先翻我们自己 vendored 的包源码树**：`vendor/lakex-doc-react/src/**` —— 尤其 `components/plugin/**` 与 `components/lakex/icon.tsx`。**按「能力」搜，不按「调用栈」搜**：grep **类名族**（如 `ne-card-toolbar`）与**图标族**（`ne-t-*` / `icon-*`），别只盯运行时 bundle。⚠️ 该包里已有大量成品组件，但它们可能**只挂在 vendor 的 `LakexEditor` 入口上**，而我们的应用是直接 `Doc.createOpenEditor`（`lakeRuntime.ts`）、**从不走 `LakexEditor`** ⇒ 这些组件在我们的产品里**从不运行**，极易被整片忽略。
  ① **官方出处优先** `/Users/admin/file/local-lake/yuque-developer-docs/`（语雀开发者文档本地副本；`docs/` 按主题编号，如 `65 - 大纲（toc)`、`47 - 通用配置`、`07 - API与事件`、`08 - 命令列表`、`48 - 适配器`）——**先确认官方到底有没有这个能力/配置/命令及其语义**，不要凭 bundle 反编译猜用法；官方有就用官方途径（例：阅读态大纲挂载点走 `toc.reading.getContainer`、阅读器偏移走 `boundaryTopOffset`），而不是自己写 CSS/私有 hack 绕过。
  ② **本项目契约与踩坑** `docs/LAKEX-CONTRACT.md`（闭源 lakex 已核实的行为契约 + 调试速查表；含我们实测出的内核行为与反例）——**新观测必须回填此处**，别只留在 HANDOFF 或代码注释里。
  ③ **更精细的源码字典对照** `/Users/admin/file/local-lake/lake-editor-main/`（第三方 VSCode yuque-editor 插件）与 `/Users/admin/file/local-lake/lake-main/`（lakejs 开源社区版，仅"机制字典"）——用于挖机制/实现细节与交叉验证；**注意 lake-main 序列化方言已与运行内核分叉，结论不得直接套用**。
  最终仲裁 = 仓库内 vendor 内核 bundle `vendor/lakex-doc-react/src/components/lakex/lakex.js`（即语雀 @alipay/lakex-doc，实际运行的代码）+ 运行时实测；以上资料与实测冲突时以实测为准。
- **文档分工（防漂移）**：`README.md`=项目概览（不维护进度/计数）· `HANDOFF.md`=唯一交接（当前基线/待办/本轮踩坑）· `AGENTS.md`=长期红线/机制/坑。
  **仓库只保留当前有效的契约/规格/指南与仍在使用的设计依据**；已完成的研究、计划、spike、审计和 dated review 直接删除，需要时从 git 历史恢复，不建 archive 目录。**HANDOFF 只保留最新 §0 + 基线/待办/坑**，不要堆历史。

## 3. 核心设计原则（用户反复强调，务必遵守）

1. **本地是真相，S3 只是镜像**：数据不丢由本地保证（回收站软删保留文件、历史快照、恢复标记），S3 仅用于多端同步。
2. **目录强一致性是 S3 同步的基础**：删除必须传播到所有端（墓碑权威）。
3. **墓碑权威（删除压编辑）**：A 删除后，B 的编辑**无论早于还是晚于删除**都抵抗不了墓碑——B 跟随删除。理由：删除意味着该文档被判定为错误/无效，继续编辑是在错误方向上工作。被删设备的本地编辑**强制留档**（历史快照，Lake）；小记**不备份**（随手记语义，丢了就丢，云端为主，不搞复杂机制）。
4. **恢复是唯一显式例外**：用户从回收站恢复 = 明确撤销删除 → 写入恢复标记（`notes.restore_pending_at`，小记 `quick_notes.restore_pending_at`）→ 同步时 local-wins，上传 active 覆盖墓碑并传播给其他端。恢复标记在 `markSynced` 时清除（绝不能残留，否则墓碑永胜失效）。
5. **墓碑携带删除前内容**：墓碑条目 `contentHash` 填**真实 hash**（删除方软删保留 `.lake`，同步时读文件算 hash + 上传对象）。其他设备下载时**先拉删除前内容再应用墓碑**（先内容、后标志）→ 回收站/恢复拿到的是删除方最新编辑版。旧墓碑（占位符 contentHash）靠容错下载天然兼容（对象不存在则跳过），无需判断占位符形态。
6. **同步顺序**：先拉远端（带冲突判定地合并）→ 推合并后的本地。墓碑是标志，内容照常走同步路径。
7. **不考虑数据兼容 / 不为旧数据写兼容代码**：开发版数据可删可重建，不做迁移/兼容层、不做"为了历史数据"的过度设计；坏数据直接删掉重建。判断标准：**先问"这些数据能不能删了重新生成？"——能，就绝不写兼容**。
8. **（并入 #17）** KISS/DRY/SOLID：优先最简单可靠的实现；不引入未经验证的抽象；用已有依赖解决，不随意加依赖。**拒绝过度设计/迎合式找需求 = #17 红线**。
9. **多表写必须用事务**：`this.db.transaction(() => {...})`。
11. **资产存在性判定 = 远端清单声明差集（对齐思源 dejavu），禁止逐对象 HEAD/GET 探测、禁止本机陈旧缓存**：同步下载时已拿到远端 latest 清单，其 `notes[].assets` 就是「云端当前被引用集」的权威快照（发布顺序=先对象后清单；GC 只删「未被任何在留清单引用的键」+ 年龄保护）。⇒「清单声明该资产」即「云端存在且未被删」。上传只对「清单未声明的缺失资产」做 PUT，但 `manifest.assets` 仍**全量声明**（裁剪声明 → 他端 GC 把在用资产误判未引用而删）。**禁止**退回每对象 HEAD；**禁止**「本机记过=已上传」的持久缓存（GC 可能删过对象，缓存会失真并破坏跨端自愈）。
**两个外部前提（协议契约外，按红线不写检测、仅记录）**：① 无带外删除——不绕过本协议手工删/生命周期规则删云端对象（若发生，latest 仍声明但对象已失，属契约外）；② 资产按 filename 内容寻址——skip 只比对 `assets/{noteId}/{filename}` 是否已声明、不校验云端字节，靠 `buildAssetFilename`（时间戳+hash 前缀）保证「同名即同内容」。
对称地，**下载侧同样走差集**：`downloadNoteAssets` 按本地实扫的 size+sha256 跳过已持有资产；`active→trash` 跟随删除仅在**实读正文 sha256 相等**时复用本地、否则 GET 自愈——两处都验真实字节、不盲信 `contentHash` 缓存（`localHashOf` 对 synced 走 baseHash 缓存不读盘）。
12. **兜底"未分类"笔记本只惰性创建**：仅当某笔记真正回落到兜底父时才创建。禁止在下载阶段或"最终可能不应用"的冲突探测中提前解析兜底父。
13. **S3 并发上限 = 8（七牛建议）**：峰值并发 PUT = `NOTE_UPLOAD_CONCURRENCY(2) × ASSET_CONCURRENCY(4) = 8`；正文对象 `UPLOAD_CONCURRENCY(4)`、下载 `ASSET_CONCURRENCY(4)` 各自 ≤8 且与资产阶段串行、不叠加。**不得**为吞吐调到 16+（日常用不到、易触七牛限流）。
14. **桌面 UI 一律走「自有设计系统」，禁止再写内联样式，也禁止新增 `!important`**：
    - **怎么找「又写了一套」**（260930 用户要求做一次全局审计后固化）：跑 `scripts/css-audit/audit-lookalike.mjs`（以 kit 的 `.ln-*` 为签名找「长得像原语却自己写的规则」）与 `scripts/css-audit/audit-primitives.mjs`（找跨文件/跨类名的**规则体重复族**）；判定只认这两份数据 + 实机几何实测，不认「看着像」。当前剩余项见 HANDOFF §3「样式大统一」。
    - **样式统一是硬要求（260929 用户定为固定规则，最高优先）**：**同一个交互语义，全仓只能有一套视觉与几何** —— 一个「添加」、一个「分组头」、一个浮层、一个按钮，只能有一个类/一个实现。做任何 UI 改动前先 grep 已有的同类控件并**复用它**；一旦发现自己又写了一套（新类名、近似几何、另一套间距/圆角），**先合并到单一来源再继续**，不许用"这个位置特殊"当理由另起一套。已有单一来源清单：**「添加」= `.bt-add-round`（表头新增字段 / 表底添加记录 / 分组加进本组）**；**浮层表面 = Overlay 原语的 `.ln-menu`/`.ln-popover`/`.ln-dialog`**；**浮层定位 = `usePopoverPosition` + `topMenuPosition.placeVertical`**；**分栏分隔条 = `src/components/ui/SplitHandle.tsx`（唯一实现；回收站 / 历史版本 / 资源的 `SplitPane` 与文档分屏共用）**；**文档面包屑 = 文档宿主 `EditorTab` 内自渲染**（用本文档自己的大纲句柄；每栏一条、随栏宽收缩；分屏下隐藏右端「更多」，AI 只走浮窗）**；**图标/按钮/行/菜单件 = `kit.css` 的 `ln-*`**；**横向页签 = `kit.css` 的 `.ln-tabs`（墨线 + 计数徽标）**；**列表/菜单的「选中行」= `kit.css` 的 `.ln-row.is-selected`**（260930 收编 legacy `.tab-switcher-item.active` / `.settings-panel .settings-nav-item.active`）；**菜单项 = `kit.css` 的 `.ln-menu__item`**（260930 收编：顶栏下拉 / 右键菜单 / ＋菜单 / 多维表列菜单都并到这一处，legacy 选择器 `.top-menu > button`、`.context-menu > button`、`.context-menu-item`、`.create-menu > button` 与 `.bt-menu-item` 仍作 JSX 钩子保留）；**图标按钮 = `kit.css` 的 `.ln-iconbtn`**（变体 `--compact` 22×22 / `--accent` 主色 hover；260930 收编：目录栏 `.dock-icon-btn`、目录行动作 `.tree-row-action`、多维表 `.bt-th-more`/`.bt-row-grip`/`.bt-row-expander`/`.bt-attach-card-icon`/`.bt-attach-card-remove`/`.bt-file-chip`）；**单行省略 = `kit.css` 的 `.ln-ellipsis`**（260930 已落到 16 处；**宽度/flex 属于布局，仍留在各自业务规则里**）；**附件/图片展示 = `AttachmentChipList`（`bitableCells.tsx`，表格/详情/表单/选择器/看板/画册共用）**；**附件类型图标 = `FileKindIcon` + core 的 `fileKindOf()`**；**hover 名称气泡 = `useNameTip()`（`.ln-tip` 表面 + `usePopoverPosition`）**；**打开一条附件 = `openBitableAttachment()`**；**图片「填满容器并裁切」= `kit.css` 的 `.ln-imgfill`**（260930 收编 4 处）；**搜索/文本输入框 = `kit.css` 的 `.ln-input__field`**；**Markdown 渲染 = `src/components/markdown/MarkdownView.tsx`（自研轻量子集、零依赖、无 innerHTML；排版 `.md-preview`）**；**AI 回答正文渲染入口 = `features/ai/AiMessageBody.tsx`**（唯一可替换缝：当前接自研 MarkdownView，换 react-markdown / remark-gfm / llm-ui / streamdown 只改这一处）；**「复制为 Lake」剪贴板负载 = `features/ai/aiLakeClipboard.ts`**（内核 readData/writeData + ne-clipboard 外壳，见 LAKEX-CONTRACT §5.17；内核实例经 `features/editor/editorRegistry.ts` 取）；**AI 结果落库（替换 / 插入到选区后）= `features/editor/selectionToolbar/aiResultOps.ts`**（文字浮栏与块句柄菜单同源，禁止另写一套）；**AI 附件内容解析 = `electron/ai/aiContentResolver.ts`**（图片 → `image_url` data URL / PDF → 文本，唯一入口；附件跨 IPC 只传 `{noteId, filename}` 引用，字节只在主进程）；**AI 消息内容块模型 = `src/core/aiProviders.ts`**（`text` / `image` / `document`；图片 / 文档只允许 `user` 消息）；**文本选中 = 固定 `--lake-select-bg`（主题无关，用户 261006 定稿：不跟主题走，别改回主题色）**；**hover 气泡 = `--lake-tooltip-bg/-fg`（同色系）**。发现重复声明或近似重复规则**当场收敛**（`cssLayers.test.ts` 的「重复(选择器,属性)组数」就是为此设的，只许变小）。
    - **令牌是唯一来源**：颜色/圆角/间距/字号/动效/字体只用 `--lake-*`，定义在 `src/styles/themes/{base,light,dark,warm}.css`（**主题即数据**：结构/几何/动效不随主题变，只换变量）；`data-theme` 由 `src/lib/themes.ts` 的注册表驱动。**颜色字面量只允许出现在 `src/styles/themes/`**（其他任何桌面 CSS 里出现 hex/rgb 都算缺陷）。
    - **词表口径（261007）**：尺度 ramp（`--lake-space-*` / `--lake-motion-*` / `--lake-ease-*` / `--lake-font-*` / `--lake-line-height-*`）与层序阶梯（`--lake-z-*`）作为**设计词表整体保留**（暂零引用也留，完整 ramp 是设计系统常态）；只有**被取代 / 无归属的特性令牌**才裁剪（如被 `-hover-2` / `on` / `on-soft` 取代的 `--lake-media-*`）。
    - **组件库**：`src/styles/kit.css`（14 件：`ln-btn/ln-iconbtn/ln-row/ln-list/ln-menu/ln-modal/ln-scrim/ln-drawer/ln-toast/ln-input/ln-select/ln-switch/ln-tag/ln-card/ln-tip/ln-segment/ln-scroll/ln-form`）+ 外壳 `chrome.css` + 领域 `feature.css` + 浮层 `overlay.css` + 无障碍 `a11y.css`。设计规格在仓库根 `DESIGN.md`（YAML 令牌前置 + 八节规范）与 `.impeccable/design.json`（组件快照 / 令牌元数据）——**新 UI 先查它有没有现成件**。
    - **浮层只走原语**：所有对话框/菜单/气泡必须用 `src/components/ui/Overlay.tsx` 的 `Dialog/Menu/Popover/HoverPopover/Submenu`（`HoverPopover` = 悬停可交互气泡：锚点与表面共享悬停区 + 开/关延时；`Submenu` = 父菜单里的悬停子菜单：相邻侧定位 + 视口夹取），**不要手写 `createPortal`**；表面（`.ln-dialog/.ln-menu/.ln-popover`）只在 `styles/overlay.css` 定义一处，层序用 `--lake-z-overlay-{menu,scrim,dialog,lightbox}`。由 `src/styles/uiPrimitives.test.ts` 卡住（createPortal 白名单 / 表面唯一 / 层序令牌高于 topbar）。改浮层先读 `docs/UI-PRIMITIVES-PHASE1-260926.md`。
    - **浮层定位也走单一来源**（260929）：用 `src/hooks/usePopoverPosition.ts`（**先量真实尺寸** → 下方优先、**贴底翻上方** → 夹进视口；垂直口径 `topMenuPosition.ts` 的 `placeVertical`）。**禁止**用估算高度自己夹（历史写法 `innerHeight - 48/90/200/260/300`：猜小了贴底必被裁、且不翻转——这个问题反复出现过多次，已有源码护栏卡住）。
    - **层序即优先级**：`src/styles/index.css` 顶部 `@layer legacy, tokens, reset, kit, shell, feature, overlay, a11y;`。新样式写进对应层即可压过旧样式，**不需要靠特异性或 `!important` 取胜**；a11y 是最高层，无障碍契约放那里天然生效。
    - **思源层已整体移除**：`src/b3/**` 目录已删除；仅 **类名**（`.b3-*` / `fn__*`）作为 JSX 契约保留，其承重规则收编在 `src/styles/compat.css`（双端共用，值一律 `--lake-*`）。**不要**再引入 `src/b3/*`。
    - **设置页骨架**仍是 `.config-group / .config-title / .config-items / .config-item / .config-name / .config-block / .config-empty`（分组标题在灰卡外、卡内一行一项、行间 1px 分隔）—— 这组类现在由 `compat.css` 定义。**设置页每加/改一行都要同步 `settingsSearch.ts` 的 `SETTING_ITEMS`**（行原语带 `itemId` → `data-set-id`，支撑条目级搜索定位；漂移有单测卡住，改完跑 `vitest src/components/settingsSearch.test.ts` 即知）。
    - **不要**在组件里写 `style={{...}}`，也不要再造第五套视觉类；**横向 tab 一律用 `kit.css` 的页签原语 `.ln-tabs`**（260929 用户在多方案对比里选定「B 墨线 + 计数徽标」：文字 + 选中项变强调色 + **与文字等宽**的 2px 下划线，压在容器 1px 分隔线上；数量放 `.ln-tabs__count` 徽标位，选中时跟强调色）。结构固定为 `.ln-tabs > .ln-tabs__track[role=tablist] > .ln-tabs__item[role=tab][aria-selected]`（+ 可选 `.ln-tabs__count` / `.ln-tabs__action`）。**260929 已全量落地**：关联选择器、回收站、历史面板、表单编辑·预览都走它，`.ln-tabs--seg` 过渡变体已删除。`.seg` / `.seg__item` **只剩「取值选择 / 图标型开关」这一类用途**（设置页的主题三选一、小记的列表·卡片版式），**不要再拿它做横向 tab**。
    - **改动落点（硬约束）**：**所有 UI/前端改动必须找到根位置、直接改那一处；禁止一层层套 CSS 覆盖**（层压层会越积越多、越来越难查）。流程：先定位该视觉/几何的**单一来源规则**（组件根规则、令牌、layout 常量）→ **就地改**；不要为了调观感再往更高层加一条覆盖，也不要同一选择器多处重复声明。**唯一例外**：目标是**内核(lakex) / 第三方组件**（运行时注入的无层样式、或 element 上的 inline style，层序压不过）时，才允许更高层或 `!important`，且必须写明理由。
    - **`!important` 是例外而非手段**：当前全桌面只允许 **9 条**（每条都在代码里注明为何必需，典型是「要压过 JS 写进 element 的 inline style」如 `.settings-panel-large` 宽度，和双端共享文件里必须压住 `.b3-button--outline` 的 `.seg__item`）。目标 ≤10，**新增任何一条都要写明理由**。
    - **两条护栏**（改样式后必跑）：① `src/styles/cssLayers.test.ts` —— 逐文件「声明数 / 重复(选择器,属性)组数」基线上限，只允许变小；**注意它的扫描器不进入 `@layer {}` 块，所以新层文件要由入口 `@import … layer(x)` 指定层，不要在文件内自包 `@layer`**；② `node scripts/ui-metrics.mjs` —— 硬指标（桌面 `var(--b3-*)`=0、非主题颜色字面量=0、**字号字面量=0**、`!important`≤10、入口 b3 import=0、同名文件对=0）。**字号口径（261008 收敛批）**：桌面 CSS 里 `font-size`（含 `font:` 简写里的尺寸）**一律走 `--lake-font-size-*`**，令牌值只在 `themes/base.css`；离档值一律**向上取档**（9.5/10→nano、11→micro、12/12.5→tiny/small、13→small、14→body、15→bodyLg、16→title），不许出现字面量 px（`ui-metrics` 会以退出码 1 卡住）。要"整体抬一档"就**改 `themes/base.css` 的 9 个令牌值**，别去改使用处。
    - **内核组件里 `div[tabindex]` 这类元素的焦点环也要收编**（261008）：`tokens.css` 的焦点规范只覆盖 `button/input/textarea/select/[role=button]`；内核用 `focus()` 聚焦普通 div 时浏览器会画**它自己的默认环**（颜色与我们的主题无关）。命中就给 `:focus-visible` 补 `outline: var(--lake-focus-ring-width) solid var(--lake-accent)`（贴合容器边缘用负 `outline-offset`）。表格右键菜单项是第一处。
    - **内核/第三方库的「模块级单例状态」遇到多实例挂载（本应用：标签页常驻挂载）会串台**（261008 结案）：这类库里常有模块级单例（缓存 / 标志位），而每个挂载实例各挂一个 document 级监听、判据只看 document.activeElement ⇒ 隐藏标签页里的实例也会命中，抢先消费掉标志、把数据写进自己那份。**口径**：碰这类全局态时，判据一律**限定在本实例容器内**（本实例容器 .contains(document.activeElement)），**不要**靠在库里放宽判据来绕过；同类隐患出现时先查「谁在抢这份全局态」。

15. **"已彻底删除"的判定必须永久**：`deleted_notes.purged_at` 只是"待删 S3 前缀"的工作标记，前缀删完就被 `markPurgeSynced()` 清空——**不能**拿它当"这条已被 purge"的依据（否则陈旧清单会把它重新导入/让子文档挂到不存在的父下，产生侧栏看不见却仍在同步与占资源的"幽灵文档"）。永久口径：folder 看 `deleted_notes` 是否存在 `node_type='folder'` 墓碑；note 看其墓碑。purge 时**无条件**写墓碑（`notes` 行缺失就从 `tree_nodes` 兜底取元数据），漏写等于云端永不下架、必然复活。`runDataHealthCheck` 的 `treeDanglingParent` 就是查这类节点。

16. **任何打开文档的入口都必须先判定"是否已进回收站/被他端 purge"**：统一用 `src/core/syncDecisions.ts` 的 `isGoneNote({parentId, syncState})`（parentId=TRASH 或 syncState='purged'）。命中则标签页以 `deleted` 打开 → 编辑器只读（复用 `EditorTab.locked` 的 viewer 模式）+ 顶部横幅提示 + 保存被拦时明确提示，**绝不允许静默丢弃编辑**。恢复走 `handleTrashRestored`（重载正文并清标记）。

17. **拒绝"迎合式找需求"：任何非 bug 改动先证真实价值，证不了就直说"不做"（红线）**。不要为了顺着用户去发明需求、把"看起来该做"的改动包装成必要。判断三问，**缺一即不做**：① 问题真实存在吗（有复现/数据/历史 bug 证据）？② 不做会付出什么代价？③ 收益是否明确大于新增复杂度？用户明确要求这种诚实——"不用迎合我、一定拒绝过分设计"。
    - **过度设计的信号**（命中即警惕）：为"统一/优雅/以后可能需要"而加抽象层或共享层；把两个本就不同的东西强行合并；用新依赖解决旧依赖能解决的问题；收益只停留在"代码更整洁"而非"解决了已发生的问题"；只给方案不给反对意见。
    - **实例（SQL 统一）**：曾提议"抽共享 SQL 常量 / 统一两端查询入口"。核查后**否决**：桌面 `notes` 只存元数据（正文在 `.lake`）、树是 `tree_nodes`；移动 `notes` 含 `content`、树是 `folders`，连 `search_index` 列都不同（多 `title`/`raw_hash`）→ 看似"重复"其实是**两套持久化模型**，不是同一份抄了两遍；共享 SQL 文本的前提是先收敛 schema（产品级决策），收益仅是整齐。真正该做的是**共享 core 逻辑 + 跨端对拍测试**（已有 `syncEquivalence`/`syncAdapterEquiv`/`syncDualAB`/`treeRules.equiv`）；**SQLite 也不需要连接池**（单写、better-sqlite3 同步单连接）。
    - 宁可少做，不要多做；不确定时先自问："这是真问题，还是我想做的？"

18. **依赖 / vendor 代码的「冗余、未用路径、死代码」不做清理**：`vendor/**` 与任何第三方依赖本来就带冗余，**不因为"我们没用到"就去删/重写**（会牵动 vendor 构建与上游契约，且不属于我们维护的范围）。只在我们**必须改行为**时，按 `vendor/lakex-doc-react/LOCAL-CHANGES.md` 的流程做最小改动。**以后不要再提议清理依赖侧的死路径。**

19. **多维表条件求值必须单一来源**：视图筛选、关联选择器临时筛选以及条件填色，统一使用 `BitableFilterRule` / `BitableFilterNode`、`filterOperatorsFor()`、`evaluateFilterNode()`、共享 `BitableFilterEditor` / `BitableFilterRuleEditor`。禁止为填色、图表或某个视图另造一套操作符、空值语义或条件 UI；字段取值继续走 `bitableFieldValue()`。填色的 `cell / row / column` 候选按规则数组下标做钉钉同款 alpha 混色，`rowSide` 独立，不得擅自改回“后色压前色”或其他混色语义。**应用内所有选色**统一走 `src/core/colorPalette.ts` 的 70 色实色阶 + `ColorPalette`（最近使用/自定义）；最近使用必须按入口分桶，禁止选项/进度/列文字/填色模式混用；Lake 编辑器继续通过 `LakeColorBoard` 适配器调用自己的内核色卡，样式和渐变色入口不得改。

20. **云同步只有一套状态判据（`src/core/cloudState.ts`），桌面与移动端共用**：`cloudStateOf(configured, syncSettings)` → `unconfigured | offline | manual | auto`；`canTouchNetwork()` 是「能不能出网」的**唯一**判据，`isCloudActive()` 是 UI（顶栏状态灯 / 离线禁用态）的判据。**关闭云同步 = 当作完全没配置 / 离线本地空间**（用户 261006 定稿）：任何路径都不出网 —— 手动同步、回收站恢复与预览的按需补拉、云 GC / 深度清理 / 换机恢复、自动同步与定期对账定时器，全部先过这一关；移动端 `src/mobile/bridge.ts` 用同一份 core 与同一语义。**新增任何联网功能必须挂这个判据**，不许各自去读 `enabled`。恢复红线不变且**不等网络**：恢复立刻生效，缺失资源后台补拉并给明确提示（"正在从 S3 拉取缺失数据…" / "未能下载…" / 离线未尝试）。
    - 判据入口：`canTouchNetwork(cloudStateOf(...))`；离线文案统一走 `cloudStateHint(state)`，不要各写一句。护栏测试：桌面 `electron/syncDualAB.test.ts`（注入会抛错的远端工厂，断言调用次数 0）、移动 `src/mobile/bridgeCloudState.test.ts`（断言引擎未被调用）。

## 4. 关键机制速览（同步）

- **Manifest V1 重置**：旧数据与远端清零后，Lake manifest 重新使用 `version=1`，但内容 schema 沿用原 v7（folders/墓碑/锁/`kind`/board 保留）。代码只读写 `{1}`；所有端必须一起升级。传输/GC/类型分别见 `electron/s3Store.ts` / `electron/s3Maintenance.ts` / `electron/syncTypes.ts`，编排见 `electron/syncEngineController.ts`。

- **壳层双 origin**：打包版渲染层跑私有协议 **`lake://app`**（`electron/appOrigin.ts` + `electron/appProtocol.ts` 服务 `dist/`；标准/安全/fetch/cors/stream/codeCache 全套 privilege），dev 跑 vite dev server（`LAKE_RENDERER=scheme` 可在 dev 下强制走前者自验）——桌面与浏览器端由此共享同一套 origin 语义（localStorage/CSP/fetch/clipboard）。**判定页面来源禁止比较 `URL.origin`**：非特殊 scheme 在 Node 的 URL 里 origin 恒为 `"null"`（Chromium 侧才是 `lake://app`）⇒ 必须比 scheme+host（`isAppOriginUrl`），否则 page 能加载、preload 在、但每个 IPC 都报「来源不受信任」。资产服务的 Origin 白名单 / ACAO 回显必须同时放行 `APP_ORIGIN`。**主进程 external 从 `package.json.dependencies` 派生**（+ `@smithy/` 传递依赖），别退回逐个硬编码。

- 冲突四分支在 `src/core/syncEngine.ts` 下载阶段；`baseHash + lastUploadedHash` 存本地 `sync_base`，**绝不上 manifest**。
- `supersededNotes`：本地改动被远端覆盖时先强制 `createHistorySnapshot` 留档再接受远端。
- `folders[]` 必填；手动同步只发回触发窗口；自动同步广播所有窗口。
- 同步/GC/深度清理共用 `enqueueMaintenance` 串行队列（进程内唯一必需互斥）。
- 资产上传差集：`scanLocalAssets(cfg,s3,db,noteId,stats,cloudDeclaredFilenames)`，`cloudDeclaredFilenames` = 本笔记在**已下载远端清单**里声明的 `assets[].filename`；缺省/为空（新笔记、桶重置 rn=null）→ 全量上传。跨笔记并发：决策环登记 `assetTasks`，环后 `runAssetPool(NOTE_UPLOAD_CONCURRENCY=2)` 回填 `entry.assets`（语义与串行逐字节一致，由 syncEquivalence/syncDualAB 保证）。见原则 11/12/13。
- manifest commit 链保留 `MANIFEST_CHAIN_KEEP=3`（设计 D4 O(3)），prune/gc-reconcile/deep-cleanup 三者共用、滞后裁剪（水位超过 target+SLACK 才裁），活动对象恒在 latest 全量快照内、被降级旧键靠本地历史 refs + 7 天年龄保护 + 重新引用撤销 pending 兜底。
- 小记独立前缀 `quick-notes/` + 独立小记库 `quick-notes/metadata.sqlite3`。
- **编辑器本机视图 = 设备本地**（用户 261006 审计「只改展示不得触发 S3」）：当前工作表 / 缩放 / 选区 / 滚动 / 折叠 / 画板视口这类**展示态不进正文、不标脏、不进 S3**；表格列宽/行高/隐藏/冻结与多维表视图配置（列宽/行高/隐藏/排序/筛选/分组/填色）仍属文档数据、照常同步。**编辑器 `onDirty` 必须只在正文真的变了时触发**。
- **多维表导航 = 设备本地**（用户 261006 选 C）：`activeTableId` / 每张表的 `activeViewId` **不进正文真相** —— `useBitableSession.serializeBody` 序列化时恒写「第一张表 / 第一个视图」，切表 / 切视图只写 `localStorage`（`lake-notes-v3.bitable-nav.<noteId>`，见 `BitableEditor`；历史快照预览 `chrome=false` 不读写）。⇒ 切表不落盘、不标脏、不进 S3；每台设备各记各的。**不要**再把导航写回正文（会让纯导航产生一次 S3 上传）。

## 5. 数据路径与安全

| 项 | 路径 |
| --- | --- |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| B 端开发数据 | `$TMPDIR/lake-device-b` |
| 日志 A | `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log` |
| 日志 B | `$TMPDIR/lake-device-b/logs/lake-notes.log` |
| 只读检查 DB | `workspace-default/metadata.sqlite3`（小记 `workspace-default/quick-notes/metadata.sqlite3`） |

## 6. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run          # 必须全绿；当前计数看 HANDOFF §0 或直接跑，别写死进文档
node node_modules/vite/bin/vite.js build
git diff --check

# 多端（vite 必须 tty=true 长驻；electron 手动前台 tty=true）
#   A: ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9222 .
#   B: LAKE_USER_DATA="$TMPDIR/lake-device-b" LAKE_ASSET_PORT=19877 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9223 .
#   （启动前临时给 vite.config.ts 的 electron 入口加 onstart: () => {}，备份为 vite.config.ts.multidev-bak；结束必须还原）

node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>   # 云端对象查看
```

## 7. 踩坑记录（务必记住）

### 环境 / 进程
1. vite dev server 会被 exec 会话回收：必须长驻 tty（`tty=true`）。vite-plugin-electron 会自动拉起 electron，手动控端前临时加 `onstart: () => {}`，验证完必须还原。
2. 单实例锁按 userData 隔离；资源端口 A=19876、B=19877。
3. 结束 electron 只能 kill 具体 PID，**不要 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae；**DSH 宿主自己也是 Electron**，是头号误伤目标）。区分我起的实例：按**唯一 CDP 端口** `pgrep -f "remote-debugging-port=92xx"` 精确 kill。

### 七牛 S3
4. `ObjectStore.test()` 必须用 ListObjectsV2（七牛 HeadBucket 对存在的桶也返回 404）。
5. 正确配置：Endpoint=`https://s3.cn-north-1.qiniucs.com`、Region=`cn-north-1`、Bucket=`local-lake-hebei`、`forcePathStyle=false`。

### 同步 / 代码
6. 同步完成必须广播 `sync-progress`，否则打开 tab/状态栏/小记列表不刷新。
7. `markSynced` 只改 notes 不够：`tree_nodes.sync_state` 也要改（状态栏读它）。
8. `contentCache` 会导致冲突后 tab 不刷新：`reloadKey` 变化时先清缓存。
9. IPC 三处同步：`main.ts`(handle) + `preload.cjs`(invoke) + `src/lib/native.ts`(类型+封装)。
10. **变量 shadow 坑**：同步函数里外层 `remote` 是 ObjectStore，循环内若再 `const remote = remoteById.get(...)` 会 shadow 掉它，导致 `remote.put is not a function`。改名 `remoteNote`/`remoteItem`。

### 日志 / 构建
11. 主进程 external **从 `package.json.dependencies` 派生**（`vite.config.ts` 的 `isMainProcessExternal`：deps + 子路径 + `node:`/`electron` + `@smithy/`）；`electron-log`/`better-sqlite3`/`sharp`/`@aws-sdk/*` 都因此在列。**不要再退回逐个硬编码**——新增原生依赖漏项 = 被打进 bundle、打包后才炸。
12. Electron 33 的 `console-message` 事件签名是 `(event)`（`event.message`），logger 已兼容。
13. better-sqlite3 是 Electron ABI 编译，系统 Node 24 跑不了；bench 等用 python3 sqlite3 代替。
14. vitest 下 electron-log 要静音（`process.versions.electron` 不存在时关 transports）。

### 在 DSH（DeepSeek Harness）宿主会话里工作
15. **启动本仓库 Electron 必须 `env -u ELECTRON_RUN_AS_NODE`**：DSH 宿主环境注入 `ELECTRON_RUN_AS_NODE=1`（它用同一份 Electron 当 Node），直接跑 `./node_modules/.bin/electron ...` 会以纯 Node 启动并报 `bad option: --disable-gpu`。完整写法：`env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=92xx .`
16. **DSH 自身就是 Electron 实例**，且会话宿主进程就在这台机器上 ⇒ §7.3 的「只 kill 具体 PID」在这里尤其致命化：**永远按唯一 CDP 端口 `pgrep -f` 精确定位**再 kill，任何 `pkill -f Electron`/`killall` 都可能把当前会话打断。
17. 改了本仓库的 `electron/*.ts` / `src/**` **不会**影响 DSH 自身（两者产物、userData 完全独立）；但**别去动 DSH 的安装目录**（`Contents/Resources/app.asar` 及 `app.asar.unpacked/dsh`），那属于它的运行时。

### 打包 / 网络
18. **`electron-builder` 默认源在弱网下会整批失败**（症状 `Timeout awaiting 'request' for 600000ms`，且**不产出** `release/**/*.app`）：换镜像即可 —— `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npx electron-builder --dir --mac --arm64 --publish never`。判断"是不是网络"先看 `~/Library/Caches/electron` 是否为空。
19. **打包版 .app 默认写正式数据目录** `~/Library/Application Support/lake-notes-electron`（§5 **禁止触碰**）⇒ 自己试跑打包产物**必须**覆盖 `LAKE_USER_DATA`：`env -u ELECTRON_RUN_AS_NODE LAKE_USER_DATA=/tmp/lake-x "./release/mac-arm64/Lake Notes.app/Contents/MacOS/Lake Notes"`。`npm run test:packaged` 已自带隔离 userData/端口，可放心跑。
20. **e2e/冒烟脚本里"非 http(s) 页面"的判定不要写死 `file:`**：打包版页面是私有协议 `lake://app`（§4 壳层双 origin）。要表达"这是非 http 的本地页面"就写 `/^https?:$/.test(protocol)`，否则换 origin 后会误报（`e2e-drawnix-smoke.mjs` 踩过）。

## 8. 会话启动指引

1. 按 **README → HANDOFF → AGENTS** 阅读（当前状态与真正的待办以 HANDOFF 为准）；**涉及编辑器/lakex 一律按 §2「内核资料检索顺序」走三级检索**（官方 `yuque-developer-docs` → `docs/LAKEX-CONTRACT.md` → `lake-editor-main`/`lake-main` 源码字典），新观测回填 CONTRACT。
2. 查 `git status`/`git log` 确认当前状态，并 **`git worktree list`** 检查有无未记录的在途 worktree 改动（2026-09-03 就漏看过一次）；
   `vite.config.ts` 不应有改动（除非多端调试中的 onstart 补丁）。
3. 需要用户确认产品语义时，给出选项和推荐，但**当前删除/恢复语义已定稿**（见 §3），不要重新争论。
