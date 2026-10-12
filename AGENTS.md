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
- **表格（usheet）用的是第三方内核 Univer（`@univerjs/*`，全部精确锁版本）**：动表格前先读 `src/features/usheet/usheetKernelContract.ts`（我们依赖的内核触点，每条都写了失效表现）；**升级依赖一律走 `docs/USHEET-UPGRADE.md` 的 playbook**（静态护栏 `univerContract.test.ts` + 运行时探针 `scripts/usheet-kernel-probes.mjs`），一次全升、**不要 `npm update`**。
  **我们对 Univer 有一个补丁** `patches/@univerjs+ui+1.0.3.patch`：内核把 floating 层（CellAlert 警告徽标 / 下拉 / 日期 / 颜色 / 选区）的 portal 容器无条件挂到 `document.body` ⇒ 它逃出标签宿主（keep-alive 隐藏对它无效、切文档后残留）；补丁把它挂回实例宿主。理由、升级处置与 patch-package「本机失败不报错退出」的陷阱见该 playbook §4.7，守它的是护栏③ + 探针两条。**除这一处之外不要再给依赖打 patch**。
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
    - **文字色阶口径（261012 定稿）**：`--lake-text-*` 是设计系统档位，取值必须按「它**实际会被铺到的最浅/最深表面**」标定，
      **不能只按白底（浅色/暖色）或 panel（深色）标定**。261012 实测：`--lake-text-3` 旧值 `#6f7784` 是按白底标的（4.52），
      铺到 `--lake-bg-hover/-block/-window`（`#f0f1f3/#f4f6f8/#f3f4f6`）掉到 **4.00–4.36**、不达 WCAG AA 4.5
      ⇒ 三主题一起改档：浅/暖改用 **ink-3 ramp 深一档 `#5f6874`**（最严表面 4.95）、深色提一档 **`#9398a1`**（最严 4.86）；
      **色板 canonical 不动**（`#6f7784` 仍是 ink-3 的色板值，见 `.impeccable/design.json` 的 `tonalRamp`）。
      `--lake-text-4`（`#8b93a1` / 深色 `#6f7278`）是**有意的 3:1 档**（元信息/占位），**不追 AA 4.5，不要顺手把它提亮**（会与 text-3 塌成一层）。
      判据装置：`scripts/css-audit/walkthrough.mjs` 的 contrast 探针（261012 起扫**全仓自有文字** + **有效透明度**，排除 sr-only / 内核 / 第三方）。
    - **主色文字口径（261012 定稿）**：`--lake-accent` 是**图形 / 边框 / 焦点环 / 底纹**的锚点，**文字一律用 `--lake-accent-text`**。
      依据：暖色 accent（`#d45500`）当小字号文字在自家表面只有 **3.61–4.12**（AA 4.5 ✗），而 `--lake-accent-text`（暖 `#a8440a`）三主题都 ≥ **5.27**；
      把 accent 压到 AA 需 `#b84a00`，会与 `--lake-accent-ink`（`#b34900`）视觉重合 ⇒ **不改令牌、只改用法**。
      261012 已切 17 处文字站点（`.badge--accent` · `.bt-option-chip` · `.bt-tool-btn.is-active` · `.bt-form-ok` · `.bt-cal-day-num` · `.bt-panel-add` · `.bt-option-create` ·
      `.bt-date-foot button` · `.bt-cell-ai-action` · `.quick-notes-link` · `.quick-note-preview-toggle` · `.quick-notes-toast button` · `.emoji-picker-tab.active` ·
      `.document-notice-toast button` · `.tab-gone-banner button` · `.edge-hotzone-handle:hover` · `.md-preview a`）；
      **纯图标站点保留 accent**（`.ln-iconbtn*` · `.ln-menu__check` · `tree-chevron` · `tab-pin` · `tree-row-icon` · `empty-workspace-icon` · `settings-nav-item svg` ·
      `document-statusbar-lock` · `bt-add-round` · `bt-link-open` · `draft-recovery-restore` …）—— 图形只需 **3:1**，暖色 accent 最差 3.61 已达标。
      **移动端 14 处同类站点未动**（属移动端会话写域）。
    - **死 CSS 判定口径（261012 定稿）**：判「这个类名没人用」**不能只 grep 一下** —— 必须排除三类，否则会误删：
      ① **内核 / 第三方命名空间**（`ne-` `ant-` `lakex-` `plait-` `univer-` `b3-` `fn__`）：这些类由 lakex / Univer / Drawnix / 思源 legacy 渲染，我们源码里**本来就不会出现**
      （例：`.lakex-material-trigger`、`.ne-card-resizer-*`）；② **动态拼接**：`` `sync-toast-icon--${kind}` ``、`` `bt-file-icon--${kind}` `` 这类类名**永不字面出现**，
      必须从模板字符串 / 字符串拼接里提取**前缀与后缀片段**来保护 —— **串中间的拼接也要算**（261012 正因为漏了它，把**活的** `sync-toast-icon--error` 误判成死类）；
      ③ **设计词表**：`kit.css`（头注释写明 = COMPONENTS.md 14 件、**P5 才逐屏迁移**）、`themes/`、`fonts/`、`kernel-theme.css`、`compat.css` —— 暂未使用的原语/令牌是**迁移目标**，不是死代码。
      ⇒ 工具 `scripts/css-audit/audit-dead-css.mjs`（口径写在文件头，退出码恒 0 = 报告而非门禁）。
      **只删「确认无人施加」的规则块**；删完必须跑走查**对拍**：死 CSS 删对了 ⇒ 22 屏的**探针结果与截图应逐项/逐字节不变**（261012 用 `.css-audit/d5` vs `d7` 验证）。
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
- **互斥域 = 写域 / 维护域，判据单一来源 `src/core/maintenancePolicy.ts`**（261010 F16 定稿；移动端实例 `src/mobile/maintenanceLocks.ts`）：
  **本地写**（saveNote / 目录 / 小记 / 历史 / 回收站 / 孤儿资产 / GC 账本 + 同步引擎的 DB 片段）入**写域**；
  **轮次级网络与维护**（syncNow / gcDeepCleanup / 资产补拉）入**维护域**。三条不变量：
  **I1** 网络往返不得持有写域（历史缺陷：两域共用一条队列 ⇒ 弱网下本地写等 **152.0s**，基线 32ms）；
  **I2** 跨网络窗口的「读 → 标记/落地」必须靠"未变才标 / 未变才应用"守卫（内容 hash 比较），不靠全局互斥
  （Lake `markSyncedIfUnchanged` / 小记同名方法 / `syncDbPort.flushNoteBatch` 批窗口守卫）；
  **I3** 同域内串行；**禁止同域嵌套**（KeyedAsyncQueue 无重入 ⇒ 自锁）。
  桌面反向护栏 `electron/maintenanceQueueScope.test.ts`（维护队列只包维护操作）；规格与验收见 `docs/MOBILE-TECH-STACK.md` §二。

- **小记预览 = 快路径 + 内核只读兜底（261010 定稿；不要再去写第二套"卡片覆盖清单"）**：
  自研解析器（`features/quickNotes/quickNotePreviewParser.ts`）只是**快路径** —— 纯文字/列表/媒体用普通 DOM 画，
  **零内核实例**（移动端冷开不受影响）；一旦出现它还原不了的块（表格/代码块/公式/画板/思维导图/日历/日期/表情…），
  **整条卡片改由内核只读视图渲染**（`QuickNoteKernelPreview`：`createLakeDocument(host,"viewer",…)`，
  用 `IntersectionObserver` 只给视口内的卡片挂实例）。判据 = 解析器自己的 `unsupported` 节点（`hasUnsupportedNodes`），
  **不另立清单**（两份必然漂移）。⇒ **格式覆盖度由内核保证，不存在"我们没实现所以显示不出来"的格式**。
  配套：「+」插入面板 = **内核全量**（261010 删掉 `quickNoteInsertFilter`）——旧的"不能预览展示的就不让插入"已废，
  它正是"移动端没有日期/表情"的真因（内核面板「小工具」里本就有 `/rl` 日历 / `/rq` 日期 / `/bq` 表情）。
  证据与浮层定位见 `docs/LAKEX-CONTRACT.md` §5.28、`docs/MOBILE-TECH-STACK.md` §七。
- **小记写作卡工具条 = 用户指定的九项**（261010 定稿）：**日期·表情·图片·附件·待办·无序·有序·引用·分隔线**。
  字符串 id 走内核内置；日期/表情/附件走**自定义工具项类**（`features/quickNotes/quickNoteToolbarWidgets.ts` ——
  内核没导出 `ToolbarUIDescriptor`，按 `Button` 控件的实际调用面自实现）；**移动端不提供「展开」**
  （`fullscreen.enable = isDesktop()`，用户定稿"一行放下、不要展开"）。三个坑（漏 `enable/disable` 整块白屏、
  `unicodeEmoji` 卡是死占位只能插文本、条目自带 12px 间距 ⇒ 9 项一行要收到 6px）见 `LAKEX-CONTRACT.md` §5.29。
- **内核浮层 portal 到 `body`**（`.ne-overlay-container`）：它们不在我们的组件树里 ⇒ 移动端要覆盖内核浮层
  （尺寸/定位）**必须用 body 级选择器**；移动端入口已加 `body.lake-mobile` 标记（`src/mobile/main.tsx`）。
  实例（插入面板夹进视口）见 §7「移动端验收」第 24 条。
- **移动端 Lake 输入面 = 底部 dock，没有第二条路**（用户 261010 定稿，实测见 `docs/MOBILE-TECH-STACK.md` §八、
  `LAKEX-CONTRACT §5.30`）：移动端编辑态 **内核固定工具栏整条不存在**（`showToolbar:!editing` ⇒ `disabledPlugins:["save","toolbar"]`），
  **块悬浮手柄 / 选区浮栏不挂载**（两者是 opt-in prefs，移动端没传），**`/` 斜杠面板不可触发**（真实 IME 实测：
  只落一个字面 `/`，面板计数 0）。⇒ 移动端能输入什么，**只取决于 dock 接线了什么**；桌面固定栏 27 项 + 插入面板 22 项
  里没接进 dock 的，移动端**能显示、不能输入**。新增移动端输入能力一律走 dock（图1 那条），不要再试内核工具栏/斜杠。

## 5. 数据路径与安全

| 项 | 路径 |
| --- | --- |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| B 端开发数据 | `$TMPDIR/lake-device-b` |
| 日志 A | `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log` |
| 日志 B | `$TMPDIR/lake-device-b/logs/lake-notes.log` |
| 只读检查 DB | `workspace-default/metadata.sqlite3`（小记 `workspace-default/quick-notes/metadata.sqlite3`） |

- **移动端 secret（S3 密钥）不落 WebView 存储**：走 Android Keystore（`android/.../SecureStorePlugin.kt` + `src/mobile/keystoreSecretStore.ts`），
  密文在应用私有 SharedPreferences；`localStorageSecretStore` 只是 Web/vitest 后端 + 历史值迁移来源（261010 设备验证：重启后仍可读、localStorage 已无 secret）。

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

### 并发 / 互斥域
21. **`KeyedAsyncQueue` 无重入 ⇒ 同域嵌套必自锁**（261010）：在同一 `key` 的任务里再 `run(同一个 key, …)` 会**永久挂起**（表现为"功能莫名不返回"，不是报错）。写互斥域时按 I3 自查：同一方法体内同域只允许一个取锁点，已取锁的方法不得再调同域的同类方法。护栏 `src/mobile/maintenancePolicyCoverage.test.ts` 静态卡住（含"同方法体同域多取锁"与"跨方法同域调用"两条）。

### 移动端验收
22. **移动端改动必须过走查装置**（261010 定为硬约定）：`npm run check:mobilesnap`（6 态视觉基线）+
    `scripts/css-audit/mobile-walkthrough.mjs`（22 屏，设备级截图 + 五类探针）。**移动端验收一律设备级截图**
    （`adb exec-out screencap -p`）—— CDP 的 `Page.captureScreenshot` 抓不到 GPU canvas 层，会误报「表格空白」。
    keep-alive 隐藏视图仍在 DOM ⇒ 自动化导航必须带命中测试（`elementFromPoint`）。
23. **移动端懒加载入口若会挂内核，必须自带内核样式**（261010 立护栏，来自真实缺陷）：`TrashPreviewPage`（设置→回收站→预览）
    挂了 `LakeEditor` 却没引内核 CSS —— 冷启动直走这条路径同样是"第一个内核消费者"，会渲染成大图标 + 原生控件（261009 小记同款）。
    护栏 `src/mobile/kernelStyleBootstrap.test.ts`：懒入口 + 其直接 import 层里出现内核挂载点 ⇒ 必须出现 `@dlient/lakex-doc-react/style.css`。
24. **内核「+」插入面板在手机上必须夹进视口并归位**（261010 立护栏，来自真实缺陷）：面板全量 **24 项 ≈1294px 高**，
    手机视口只有 842px ⇒ 内核判定"下方放不下"、把整块面板翻到 caret 上方（它的浮层容器是**视口左上、0 尺寸的 fixed 盒**，
    用**负 bottom** 定位，实测落在 `top=-558`）⇒ 顶部整段出屏、"基础"那些条目**点不到**。
    **只夹高度不解决**（翻转判定不吃高度）⇒ 两条一起：① `max-height` + `overflow-y:auto`（交回内部滚动）；
    ② 改锚点 `top:120px !important; bottom:auto !important`（内核写的是**行内样式**，只能 !important 压，§14 允许的例外）。
    落点 `src/mobile/mobile-kit.css`、作用域 `body.lake-mobile`（内核无相关配置项：官方文档 55 只给 `groups`/`disableQuickInput`）。

### 走查装置 / 探针
25. **写进「引号字符串」里的正则，反斜杠会被 JS 吃掉 ⇒ 探针静默失效（261012 实测，静默了 3 个月）**：`walkthrough.mjs` 的对比度探针把
    `/rgba?\(([^)]+)\)/` 写在**单引号字符串**里 —— `\(` 被字符串字面量解释掉，运行期正则退化成 `/rgba?(([^)]+))/`，
    匹配 `rgb(31, 35, 41)` 时 `m[1]` 捕获到 `"(31, 35, 41"` ⇒ `parseFloat("(31")` = **NaN** ⇒ 所有 ratio 都是 NaN、
    `NaN < 4.5` 恒 false ⇒ **探针从不报任何对比度问题（假阴性）**。判定真相：`fg.r` 为 null/NaN（Chromium 里 JSON 化后是 `null`）。
    ⇒ **口径**：探针/脚本里凡「字符串内嵌正则」一律写**双反斜杠**（`\\\\(`），改完**必须**用一条已知会命中的样本自证（不能只看"跑通了、结果是 0"）。
    `scripts/css-audit/mobile-walkthrough.mjs:18` 是**同一份拷贝、同一个 bug**（**261012 已由移动端会话修掉**：与桌面版逐字一致的 `\\(` 双反斜杠写法；
    自证 = 拿**运行期**正则跑已知样本：#6f7784 on #fff 由 NaN → **4.52**（该值在 §3#14 有独立记录，故是交叉验证不是自证自话）。
    ⚠️ 这意味着**修好之后移动端走查会第一次真的报对比度数据** —— 那批新数字属"探针从死转活"的首次产出，不是回归；判读时别当基线漂移。）
26. **探针"看不见"比探针"报错"危险**：261012 对比度探针还存在第二重盲区 —— 旧口径只扫组件族选择器（`ln-/config-/bt-/…`）且只读**元素自身** opacity
    ⇒ 状态栏内层"无类名 span"看不见、docked 下父级 `opacity:0` 的 `.edge-hotzone-handle__label` 反而误报。
    修法：扫**全仓自有文字** + **祖先连乘的有效透明度** + 排除 1×1 sr-only / 内核(`.ne-*`) / 第三方(univer/drawnix)。

## 8. 会话启动指引

1. 按 **README → HANDOFF → AGENTS** 阅读（当前状态与真正的待办以 HANDOFF 为准）；**涉及编辑器/lakex 一律按 §2「内核资料检索顺序」走三级检索**（官方 `yuque-developer-docs` → `docs/LAKEX-CONTRACT.md` → `lake-editor-main`/`lake-main` 源码字典），新观测回填 CONTRACT。
2. 查 `git status`/`git log` 确认当前状态，并 **`git worktree list`** 检查有无未记录的在途 worktree 改动（2026-09-03 就漏看过一次）；
   `vite.config.ts` 不应有改动（除非多端调试中的 onstart 补丁）。
3. 需要用户确认产品语义时，给出选项和推荐，但**当前删除/恢复语义已定稿**（见 §3），不要重新争论。
