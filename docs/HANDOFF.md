# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留【最新几个批次 + 当前基线 + 真正的待办 + 长期坑】；历史 dated handoff 已删除，只在 git 历史可查（`git log -p --follow docs/HANDOFF.md`）。
> **⚠️ 261022 历史已重写两次（品牌/邮箱标准化 → 闭源内核移出公开仓库）**：旧 commit hash 全部失效，文中旧 hash 只作历史记录，`git show` 不可达。
> **§8 是移动端（Android）专职交接**；桌面会话不要改 §8，移动端会话不要改 §0–§7 之外的桌面文件。

## 0. 最新交接（261023）

> **当前基线**：`master`；项目/身份 = **local-lakex-notes**（productName `LocalLakexNotes`；appId `com.locallakexnotes.desktop` / `com.locallakexnotes.mobile`；数据目录 `local-lakex-notes-dev` / `local-lakex-notes`；私有协议 `locallakexnotes://app`；S3 迁移码 `LLN1.`）。文档：根 `README.md` / `AGENTS.md`，其余在 `docs/`。门禁：tsc 0 / vitest 363 文件 2528 例（261023 快照，**含并行会话的在途用例**）。
> **待用户验收**：表格 P4/P5 桌面侧、小记搜索/标签（桌面+Android）、CSS 层修复、长按 capture 启动、移动端表格「链接/十字高亮」设备点按、多维表重命名单边框 + 创建项「新建多维表」、默认标题/筛选单边框/云同步默认关、AI 面板全文开关只给无选区入口、macOS 全屏顶栏去掉红绿灯让位、表格第三方输入框单边框（vendor 焦点归属）、全屏附件预览/顶栏不加红绿灯让位。
> **待用户裁决**：移动端表格 ⋯ 面板逐项去留（29 项：22 可点 + 7 置灰占位；已给出逐项功能与建议，等用户点单后再裁）。
> **下一会话焦点**：① 表格 P4/P5 剩余（移动阅读态/保护语义）；② 移动端文本格式缺口（H5/H6、缩进、行高、清除格式、格式刷）；③ 画图插入项解禁；④ 逐页走查；⑤ GitHub Releases 与签名/公证。
> **已定不再讨论**：长期红线见 `AGENTS.md` §3；历史决定见 git。

### 261023(五) · 桌面端日志系统重做（分级 / 关键流程埋点 / 错误捕获 / 文档）· **待验收**

- **用户要求**：整理桌面端日志并按同样思路埋点；开发环境 debug 多、正式环境把 info/warn 用起来、重点处理 error；关键流程记录耗时与数据量，积累一段时间后做针对性性能优化。
- **分级（单一来源 `electron/logLevels.ts`）**：dev = file/console/renderer 全 debug；prod = file info、console 关、renderer info；现场覆盖 `LAKE_LOG_LEVEL=…`、`LAKE_LOG_CONSOLE=1`（不改代码）。
- **格式（单一来源 `src/core/logFormat.ts`）**：一行一条；耗时统一 `[perf] label <ms>ms k=v`；错误带 `error=` + 前 3 帧 `stack=`；字段 `k=v`；不记正文/密钥。
- **渲染层**：新增 `src/lib/log.ts`（debug 仅 DEV；perf 走 info）；`main.ts` 的 console-message 按 Electron 新旧签名映射级别（error 不再被压成 info）；入口装 window error / unhandledrejection 兜底。
- **主进程**：logger 重写（10MB 轮转、`[start]` 启动上下文含版本/平台/userData/生效级别）、uncaughtException/unhandledRejection、preload-error、unresponsive/responsive、`[security]` 拦截导航、`[quit]` 时序、`[perf] boot.ready`。
- **关键流程埋点**：`[perf] ipc.<channel>`（debug）+ `ipc.slow` ≥200ms（warn）+ 失败（error）；`[perf] note.save`（耗时+字数，慢保存升 info）；`[perf] sync.round`（耗时/条数/字节/墓碑/冲突/warnings）；`[perf] paste.html`（bytes/getData 次数/升级耗时/护栏命中）；沿用资源上传爆发统计与 CSP 折叠。
- **文档**：新增 `docs/LOGGING.md`（分级 / 作用域 / 格式 / 埋点清单 / 排查手册 / 性能优化用法 / 新增埋点规范）；AGENTS §6 加一行；TROUBLESHOOTING §M 在上一批。
- **实测（隔离实例）**：dev 日志 27 行（info 12 / debug 13 / error 2）——`[start]`、`boot.ready 1834ms`、逐次 ipc debug、`paste.html 0ms bytes=24 getData=9`、`note.save 2ms chars=181` 均正常；`LAKE_LOG_LEVEL=info` 时 12 行且 ipc debug = 0。
- **顺带发现（未修，登记待查）**：新建文档后渲染层抛 `IndexSizeError: Failed to execute 'getRangeAt' on 'Selection': 0 is not a valid index`（与本次改动无关，隔离实例必现；已由新增 `[window]` 兜底捕获）。
- **门禁**：tsc 0 · 全库 vitest **375 文件 / 2561 通过（17 skip）** · 双端构建 ✓ · check:core ✓ · git diff --check ✓。
- **落点**：同一 worktree（分支 `fix/paste-perf`，第 2 个 commit），**未合并、未推送**。

### 261023(四) · 粘贴整页网页：CSP 噪音折叠 + 上传爆发统计（分支 fix/paste-perf，未合并）· **待验收**

- **背景**：用户报「值得买」文章（4700 字 / 67 图）从浏览器全选粘贴进文档非常卡，日志同时刷出上百条 CSP 报错，怀疑是日志记录导致。
- **结论（已实测，不改粘贴逻辑）**：日志不是原因。同内容在隔离实例复现：同步 dispatch 341ms、96 条 CSP 全落在 1 秒内、端到端 ≈3s；12:24 重粘同一页：63 张图卡 21ms 内插完、端到端 ≈2.2s ⇒ 11:54 那次的 8.8s 静默是当时的机器负载（同机并行开发会话）造成的偶发卡顿。判据与取证方法见 docs/TROUBLESHOOTING.md §M。
- **本批只加可观测性**：
  - electron/consoleNoise.ts：CSP 拦截通知折叠成一行（条数 + 示例 URL），main.ts 接线、窗口关闭时 flush；护栏 consoleNoise.test.ts（6 例）。
  - src/lib/uploadStats.ts + src/features/editor/resourceUpload.ts：上传爆发聚合（次数 / 远程 / 墙钟 / 单次最长 / 重试 / 失败），阈值（≥3 次 / 墙钟 ≥1.5s / 有失败）才落一行 [perf]；src/core/retry.ts 加可选 onRetry（唯一调用方，重试语义不变）；护栏 uploadStats.test.ts（7 例）。
  - docs/TROUBLESHOOTING.md 新增 §M（症状 / 四条判据 / 结论 / 稳定复现时怎么查）。
- **明确不做**：粘贴前把远程 img 换成占位。实测这 90+ 次被 CSP 拦截的请求只花 21ms / 20KB 日志；唯一能真正消除的实现 = 把粘贴改成异步预取再重派发（会改选区/撤销语义）⇒ 按 AGENTS §3#17 不做，等真有网络/大图瓶颈再单独立项。
- **门禁**：tsc 0 · 全库 vitest **365 文件 / 2541 通过（17 skip）** · git diff --check ✓。
- **落点**：worktree lake-notes-electron-worktrees/paste-perf（分支 fix/paste-perf，基于 master 73f63039），**未合并、未推送**。

### 261023(三) · 桌面逐页走查（隔离实例 + 合成夹具，用户点单）· **仅验证，无代码改动**

- **方法**：`make-fixture.mjs` 合成夹具（富文本/表格/多维表/画板/2 回收站/2 小记/4 类资产）→ 独立 userData + 独立资源端口 + CDP 9231 的**隔离窗口**（不碰用户 dev 实例与数据）→ CDP 驱动逐页截图；全程收集 `Runtime.exceptionThrown` = **0 条**。
- **覆盖**：资料库/编辑器（H1/列表/代码块/表格/图片卡）、表格、多维表、画板、小记、全文搜索、AI 助手、云同步浮窗、历史版本、回收站、资源、设置（编辑器/外观/快捷键/文档与历史/云端与同步/AI/回收站/浏览器端/日志/关于）、标签右键菜单。
- **结论**：**未发现视觉缺陷/回归**。四类「看似异常」经复验均为夹具/环境所致：① 双工具条 = 隐藏窗口（`document.hidden=true`）下 keep-alive 清理被节流，出帧后 mounts=1/toolbars=1（与 §3#9 已知空帧同源，暂不做）；② 富文本「图片」区块空 = 夹具是 **1×1 PNG**（`<img width="1">`），非加载失败；③ 画板空白 = 夹具画板无图形；④ 小记页红色校验横幅 = 自动化上一轮空提交残留，冷启动复验不存在。
- **资源页数据自洽**：可删 2 / 历史保护 3 / 缺失 0（共 5 个 · 350B · 4 篇文档）。
- **产物**：`.css-audit/walkthrough-261023/`（gitignored，31 张）。**没跑 42 态 stylesnap**：本批未动外壳几何，且发版线已放弃。

### 261023(二) · 桌面收尾：查替面板单边框实测 + 全屏 chrome 收口（附件预览不留缺口）· **已改，未提交**

- **① 表格「查找替换」面板实测**（补上一批只测了「插入链接」的缺口）：数据页签 →「查找替换」→ 查找输入框（316×32）实测 `border 1px #3f5fa0` / `outline 0` / `box-shadow 0 0 0 2px rgba(28,31,36,.2)`（= 自有 `.ln-text-field` 口径，单条边）；`window.__vendorFocusProbe()` = `[]`（无叠层）。宿主是 `.usheet-editor` **内联**（不是 portal）——与链接弹窗的 `[data-lake-univer-floating]` 两类宿主都已被 `vendor-focus.css` 覆盖。证据 `.css-audit/vendor-focus-261023/find-input-after.png`。
- **② 全屏 chrome 收口（单一来源）**：新增 `src/styles/window-chrome.css`（unlayered，`main.tsx` 引入）：
  - `:root.window-fullscreen .platform-mac .tab-bar` → `padding-left: 10px` + `no-drag`（从 `tabs.css` **搬进来**，`tabs.css` 恢复原样、全屏规则不再散落）；
  - `:root.window-fullscreen .attachment-preview.is-mac .attachment-preview__toolbar` → `padding-left: 16px`（正常窗口 82px 让位 → 全屏不再留左侧缺口）。
  - `cssLayers` 登记新文件（3 声明）；`layoutMetrics.test` 改指新文件并锁两条规则（含「tabs.css 不得再出现 window-fullscreen」）。
- **实测**（同一页面实时切 `:root.window-fullscreen`）：顶栏 `82px → 10px`；附件预览工具栏 `82px → 16px → 82px`（动态加载其 CSS + 同构 DOM 验证，验完清掉根类）。
- **门禁**：tsc 0 · 全库 vitest **363 文件 / 2528 例** · ui-metrics 0 · check:bundle ✓ · `git diff --check` ✓。

### 261023 · 表格第三方输入框「两层边框」根因 + 系统性收口（用户点单：「最后一次彻底排查」）· **已提交 `41d0a597`，待验收**

- **用户口径**：桌面表格后续接入的功能输入框（插入链接、查找替换…）都是 2 层边框，怀疑没接原语；要求彻底排查、以后别再出现。
- **根因（不是某个输入框写错，是全局焦点环跨界）**：`tokens.css` 的 `:where(button, input, textarea, select, [role=button]):focus-visible` 本意是给**自有**原生控件的焦点环，但它按标签命中所有 input/textarea/select；Univer 弹窗/面板自己已经画了「1px 边框 + 聚焦 ring（box-shadow）」⇒ 再叠我们的 2px offset outline 就是两三层。**关键坑**：表格弹窗 portal 到 `[data-lake-univer-floating]`（260922 补丁改回 body、带 `data-lake-owner`），所以只按 `.usheet-editor` 写作用域会漏——这正是「修过又出现」的原因。
- **实测（隔离实例 CDP，插入链接弹窗输入框）**：修复前 = border `1px #33497f` + 厂商 ring `2px #eef2fa` + 全局 outline `2px #3f5fa0 offset 2`；修复后 = border `1px #3f5fa0` / outline `0px` / `box-shadow 0 0 0 2px rgba(28,31,36,.2)`（= 自有 `.ln-text-field` 的聚焦口径，单条边）。
- **修法（单一来源，新文件）**：`src/styles/vendor-focus.css`（unlayered，压过 vendor 层；`main.tsx` 引入）——
  - **归属**：第三方宿主（`.usheet-editor` / `[data-lake-univer-floating]` / `.lake-editor-mount` / `.ne-overlay-container` / `.board-editor`）里的 `input/textarea/select` 不再吃全局焦点环（交给厂商自己的焦点视觉）；
  - **表格字段皮肤**：`[data-lake-univer-floating]` / `.usheet-editor` 里输入框聚焦 = 主色边 + 2px 柔光环 + `outline: 0`（并入原语口径）。
  - `styles/cssLayers.test.ts` 登记该文件基线（4 声明）。
- **防复发（三件套，不打补丁）**：
  1. **dev 运行时探针** `src/lib/vendorFocusProbe.ts`：第三方宿主里聚焦控件时若仍带可见 outline ⇒ `console.warn` 并记入 `window.__vendorFocusProbe()`（空数组 = 干净）；`main.tsx` DEV 安装。
  2. **静态护栏** `src/lib/vendorFocusProbe.test.ts`：宿主识别（内联 / 弹窗 portal / 内核浮层）、只对「第三方 + outline」判叠层、样式与入口都真的接上（含 `[data-lake-univer-floating]`）。
  3. **后续新增第三方编辑器**：宿主加进 `vendor-focus.css` 的 `:is()` 列表 + `VENDOR_HOST_SELECTORS`；漏了 dev 控制台会报。
- **门禁**：tsc 0 · 全库 vitest **363 文件 / 2528 例**（本批 +3 = 探针宿主识别 / 叠层判据 / 样式与入口接线）· ui-metrics 0 · check:bundle ✓ · `git diff --check` ✓。
- **边界（未做）**：第三方**按钮**仍用我们的焦点环（与自有 `.ln-btn` 单环一致，不算「两层边框」）；若要让厂商按钮自己负责，把 `button/[role=button]` 加进归属规则即可，但会丢厂商 UI 的键盘焦点指示，需评估。

### 261023 · macOS 原生全屏：顶栏去掉红绿灯让位（仿思源，用户点单）· **已提交 `d9c341ad`，待验收**

- **用户定稿**：选 C —— **保留** macOS 原生全屏（绿色按钮进独立 Space），不改窗口模式；但全屏时系统把红绿灯一起隐藏，顶栏仍留 82px 让位 ⇒ 左侧空一块「比较丑」，要求仿思源：全屏时整条顶栏左移到最左。
- **判据单一来源（三处接线）**：主进程 `enter-full-screen` / `leave-full-screen` 广播 `window-fullscreen`（并在 `renderer-ready` 补发一次初始态，覆盖「启动即全屏」的 window-state 恢复路径）→ `preload.cjs` + `src/lib/native.ts` 的 `onWindowFullscreen(cb)` → `App.tsx` 切 **`:root.window-fullscreen`** 类 → CSS 一处收口。
- **实现落点**：`electron/main.ts`（`sendWindowFullscreen()`）· `electron/preload.cjs` · `src/lib/native.ts` · `src/App.tsx`（挂载订阅 + 卸载清理）· `src/styles/app/tabs.css` —— 把 `.platform-native-titlebar .tab-bar` 与非 mac 顶栏同组，追加 `:root.window-fullscreen .platform-mac .tab-bar`（`padding-left: 10px` + `no-drag`）。**声明数与既有规则相同**（cssLayers 基线不变、无新增 CSS 文件）。
- **端到端实测**（隔离实例 + 临时调试钩子，已回退、未入库）：窗口态 `82px / drag` → 进入全屏 `10px / no-drag`（`:root` 类为 true）→ 退出恢复 `82px / drag`；CDP 每 300ms 采样，走的是真实 `enter/leave-full-screen` 事件。
- **门禁**：tsc 0 · 全库 vitest **362 文件 / 2525 例**（新增 `layoutMetrics.test` 全屏让位端到端断言）· ui-metrics 0 · check:bundle ✓ · `git diff --check` ✓。
- **已知剩余（未做，等点单）**：附件预览浮层的工具栏 `.attachment-preview.is-mac .attachment-preview__toolbar` 也有 82px 让位 ⇒ 全屏下标题仍偏右；要收左需在该文件 +1 条声明（会顶 cssLayers 基线，需新文件或减量），本次未做。

### 261023 · 移动端表格交互改版：钉钉实测 + 可交互 HTML 原型（**未改产品代码**）

- **用户口径（261023）**：不再自己探索移动端表格交互；以钉钉（Android）为参考——「感觉还是工具栏靠谱一点，且也是通过公式栏来编辑的」；**先出 HTML 原型定稿，不反复折腾代码**。
- **钉钉实测（emulator-5554 实机 + WebView CDP 只读）**：选择态 = 网格 + 底部浮动胶囊「格式/插入/数据/视图」→ 底部全宽面板（4 页签常驻、右侧键盘图标进编辑）；编辑态 = 公式栏（地址 + 输入 + ↵ + 展开）+ 快捷条（表格工具/A/插入 | 选区 | 语音/图片/@/日期 | ✓）；格式面板 = 字号 ± 步进、B/I/S/U、水平/垂直对齐各 3、字色 8、填充 8（首格无填充）；插入 = 插行列 4 大按钮 + 单元格图片/手写签名/链接/日期…；数据 = 升/降序 + 筛选开关 + 查找替换；视图 = 视图比例（默认/全景/聚焦）+ 表单视图 + 图表视图 + 冻结行列 + **高亮当前行列开关**；顶栏「更多」= 文档级操作（不放表格格式）。
- **用户二次澄清（同日）**：**不要**底部悬浮胶囊/四页签面板；要的是**双击编辑后、键盘上方那条工具条**（形态对齐我们文档编辑器的底部 dock），公式栏保留。
- **原型（可交互，单文件、离线可用）**：`docs/preview/mobile-sheet-prototype.html` —— 选择态只有网格；**双击进编辑** → 公式栏 + **编辑 dock**（`＋ | T | B I S U | ⋯ | ✓`，撤销/重做留顶栏）+ 键盘示意；点 T/插入/⋯ 在 dock **上方**展开内联面板（T = 字号±/对齐/字色/填充；插入 = 插行列 + 图片/签名/链接/日期/附件/公式；⋯ = 排序/筛选/冻结/高亮当前行列/查找/格式刷/清除格式/视图比例）。右侧附「钉钉实测清单 + 待拍板问题」。
- **状态**：仅调研 + 原型，**产品代码零改动**；待用户按原型逐项定稿（胶囊 vs 两行工具条、公式栏常驻与否、字号步进 vs 下拉、插入项取舍、冻结二级、⋯ 文档级菜单范围）。
### 261022(晚⑤) · AI 面板：「附加当前文档全文」只给无选区入口（用户点单）· **已提交 `2ded222b`，待验收**

- **用户定稿**：区域选择用 AI（选区浮栏 / 块菜单 / 图片卡 AI）**不需要**「附加当前文档全文」；只有**无选区**入口（顶栏「更多 → AI 助手对话」）才需要这一行。
- **判据（面板内单一来源）**：`const selectionContext = selectionText.trim().length > 0 || hasImages;` —— 文字选区 / 图片选区 / 块菜单（vendor 会把整块还原成选区，`blockHandleMount` 传的就是块文本）都算「有选区」⇒ 整行 `.ai-dialog__doc` 不渲染；`noteId && !selectionContext` 才出开关。开聊锁定、全文结果不自动回写等既有语义不变。
- **不改三个入口组件**（`App.tsx` 顶栏 / `SelectionToolbar` / `blockHandleMount` 传参保持不变）：判据只在面板里，避免同一条件散到三处。
- **验证**：jsdom 行为 1 例（文字选区 / 图片选区 ⇒ 无开关且面板不含该文案）+ 静态断言锁 `noteId && !selectionContext`；隔离实例（scheme 构建 + CDP 9230）实测：顶栏入口有开关（`aria-checked=false`），⌘A 选中后点浮栏「AI 助手」⇒ **无开关**、预设行仍在。证据 `.css-audit/bitable-rename-261022/ai-topbar.png` / `ai-selection.png`。
- **不涉及**：样式（`.ai-dialog__doc` 规则与 `aiDialogParts.css` 基线不变）、数据/IPC/同步。

### 261022(晚④) · 移动端表格工具条：两行 + T 一级标签 + 十字高亮挪底栏（用户点单）· **已提交 `41f84901`，待验收**

- **用户点单（261022 晚，五条）**：① 工具条做成 **2 行**，常用放外边、不常用收起；② **增/减小数位都收起**；③ B/I/S/U/字色合成一个 **T 一级标签**，点开二级展开 5 项，T 放常用；④ **十字高亮放右下角缩放左侧**，阅读态也能用（不影响数据）；⑤ 删掉底栏那个**空图标**。
- **实施（单一来源 usheetChromeModel.ts）**：SHEET_TOOLBAR_ROWS = 两行分组（第一行「+ / 撤销 重做 / T / 常规▾ / ⋯」；第二行「格式刷 清除格式 / 筛选 排序 冻结 查找 / 链接 公式」），第二行可横滑；T 的二级卡 = 新组件 SheetFormatCard（B/I/S/U 四开关 + 8 色字色圆点，按钮按当前选区亮起）；排序/冻结/公式改为第二行小卡（SHEET_SORT_MENU / SHEET_FREEZE_MENU / SHEET_FORMULA_MENU）；⋯ 只剩低频（填充/边框/对齐/合并、小数位增+减、行高/列宽、删除行列）+ 未接占位（7 个仍置灰，等用户逐项裁决）。
- **⑤ 的真身 = 内核自带的「打开表格工具」浮动钮**（无图标、点了没可见效果）⇒ mobile.css 隐藏 + 删掉 ⋯ 里对应的「更多表格工具」（连带删掉 useSheetCommandActions 的 more-tools 分派与 getHost 入参）。
- **十字高亮**：从 ⋯ 移到 MobileSheetFooter（缩放左侧，32×32，aria-pressed 反映开/关），**阅读态/编辑态都常驻**；仍默认关、不持久化、不进正文。
- **门禁（本会话实测）**：tsc 0 · 本会话改动的 usheet 相关用例全绿（全库同树另有并行会话在途改动，故数字以最新 HANDOFF 基线为准）· ui-metrics ✓ · check:mobileui ✓（mobileLayers 基线：usheet-chrome.css 250→302、mobile.css 1459→1460，属新增交互形态）· diff-check ✓；APK --sync 重打并装 emulator-5554，两行工具条 / T 卡 / 十字高亮开关设备截图实测通过。
- **未做/待裁**：⋯ 里 7 个置灰占位（字号/垂直对齐/换行/选择/图表/条件格式/保护）仍等用户逐项决定「留下做功能还是删除」；第二行目前只有图标（移动端无 hover，可加文字标签，待用户看效果定）。
### 261022(晚③) · 默认标题「无标题多维表」+ 筛选输入单边框 + 云同步默认开关（用户点单）· **已提交 `d6482021`（多维表部分）+ `5c424799`（云同步默认值），待验收**

- **用户定稿（逐条回应上轮三问）**：① 新建多维表的默认标题要叫「无标题多维表」；② 筛选条件输入统一成单边框；③ **表内仍叫「数据表」**（多维表 ⊃ 数据表，面板标题与「新建数据表」不动）；④ 全新安装、S3 一项都没配时，「启用云同步」应默认**关闭**（而不是现在默认开）。
- **① 默认标题**：桌面 `useNoteLifecycle.createBitableIn` 与移动 `NotebookWorkspace.createChildDocument` 的默认名改为「无标题多维表」（`workspaceMenu.test` 断言同步）。实测：新建成目录行 / 标签都是「无标题多维表」。
- **② 筛选输入（先纠错再修）**：`.bt-rule-row input/select` 是**死选择器**（排序/分组行用 `SelectMenu` 按钮，多维表里已无原生 input/select）⇒ 上一批补的规则已删；**真正的双边框**在 `bitableFilterEditor.css` 的 `.bt-filter-input:focus / .bt-filter-value-trigger:focus`（1px 边 + 2px 内描边）⇒ 改为 `border-color: accent; outline: 0`（只留一条边；与本批行内重命名同一判据）。护栏断言改成锁真实落点 + 禁止 `outline: 2px` 回流。**本文件按声明数只许降，故未加柔光环**。
- **④ 云同步默认开关 = 是否已配置 S3**：桌面 `settingsRepository.getSyncSettings()` 的默认值改用 `hasS3Settings()`（只判 `settings` 里有 `s3_settings` 行、不解密）；移动 `bridge/context.readSyncSettings()` 的 fallback 同样按「本地是否存过 S3 配置」（`S3_STORAGE_KEY`）取 `enabled`。**已配置的旧库不回归（仍默认开）**；显式存过的值优先。语义依据：`cloudStateOf` 里「没配置」与「关掉」等价（一律不出网），只有连通测试通过才允许 `enabled=true`（`SettingsPanel.saveSyncCfg` 已内建测试）。
- **设备实测（隔离实例 CDP 9230 / 全新 `LAKE_USER_DATA`）**：`[data-set-id=sync-enabled]` → `aria-checked=false`、`disabled=true`、说明为「先在上方「S3 对象存储」完成配置并点「测试连接」通过，才能开启云同步。」；筛选输入 focus = `1px rgb(63,95,160)` + `outline 0` + 无第二圈；新建多维表默认名见上。
- **不涉及**：同步语义/schema/数据（只改默认值与文案）；AGENTS §3#20 补了这条默认值口径。
- **门禁**：tsc 0 · 全库 vitest **362 文件 / 2522 例**（本批新增 settingsRepository 4 例 + 移动 1 例 + 筛选/重命名护栏；同一工作树另有并行会话的移动端在途用例）· ui-metrics 0 · check:core ✓ · check:mobileui ✓ · check:bundle ✓ · `git diff --check` ✓。

### 261022(晚②) · 多维表：数据表行内重命名「两个边框」+ 创建项改名「新建多维表」（用户点单）· **已提交 `d6482021`，待验收**

- **用户口径（附截图）**：① 多数据表左侧列表里重命名，输入框「怎么还是 2 个边框」；② 「新建」里的「数据表」改叫「多维表」。
- **① 两个边框 = 两层来源，根因修在「复用原语 + 只留一条边」**：
  - 旧实现 `.bt-inline-input` 自带 `border: 1px solid var(--lake-accent)`，而全局 `:where(button,input,…):focus-visible`（`src/styles/tokens.css`）给所有输入框再加 `outline: 2px + offset 2px` ⇒ 截图逐像素 = 「2px 主色描边 + 2px 背景缝 + 1px 主色边」两条。
  - 改为**复用多维表字段原语 `.bt-input`**（静息 `--lake-ctl-border`；`:focus` = 主色边 + `outline: 0`），`.bt-inline-input` 只留行内布局（`flex/min-width/height:auto/padding`）。
  - **只换原语还不够**：`.bt-input:focus` 的 2px 柔光环在选中行（accent-tint 底）上又围一圈浅色（实测 196,199,207）⇒ 再加 `.bt-inline-input:focus { box-shadow: none }`，**只留 1px 主色边**。判据同 260929 链接格「格内输入框不再叠焦点环」：**已有边框/选中环处不再叠第二次焦点信号**。
  - 实测（隔离实例 CDP 9230，dev 源 + 独立 `LAKE_USER_DATA`）：`border 1px rgb(63,95,160)` / `outline 0px` / `box-shadow none`；截图像素扫描主色边紧贴白底、无第二圈（`/tmp/lln-verify/rename-final.png`）。
- **② 创建项文案**：桌面 `Sidebar.CREATE_CHILD_ITEMS` 与移动端目录抽屉「新建」清单同步 →「**新建多维表**」（文档类型名 = 多维表，**表内层级才叫「数据表」**：多维表面板标题「数据表」与面板内「新建数据表」按钮保持不变）；`docs/MOBILE-TECH-STACK.md` 引用同步。
- **护栏**：`bitableEditorMount.test.ts` 新增「行内重命名复用 .bt-input + 不再自带主色边 + :focus 去柔光环」；`sidebarContextMenu.test.ts` 锁 `label: "新建多维表"`；`workspaceMenu.test.ts` 清单断言同步。
- **门禁**：tsc 0 · 全库 vitest **361 文件 / 2512 例**（+1 例）· ui-metrics 0 · check:core ✓ · check:mobileui ✓ · check:bundle ✓（产物 CSS 未分层 0）· `git diff --check` ✓。
- **不涉及**数据/同步（纯本机视图与文案）；stylesnap 42 态不含「行内重命名 / 创建菜单」⇒ 基线不变。
- **同类观察（已在 261022(晚③) 收口）**：筛选条件输入 `.bt-filter-input` 的「1px 边 + 2px 内描边」已改成单边框；**注意 `.bt-rule-row input/select` 是多维表里的死选择器**（排序/分组行用的是 `SelectMenu` 按钮，没有原生 input/select），不要再拿它当落点。

### 261022(晚) · 表格「十字高亮」改为默认关闭 + 开关可见（用户点单）· **已提交 `41f84901`，待验收**

- **用户定稿**：默认关，且要保留开关（原 261022 白天按点单默认开启；实测默认亮的紫色行列带太抢眼）。
- **实施（两端一致，纯本机视图）**：内核初始就是关（`_enabled$ = new BehaviorSubject(false)`）⇒ **打开表格不再自动开启**；
  `features/usheet/usheetCrosshair.ts` 由 `enableUsheetCrosshair` 改为显式 `setUsheetCrosshair(api, on)`；
  桌面 `UniverSheetEditor` 删自动开启（「视图」页签仍有内核开关）；移动端 `MobileUsheetViewer` 去掉自动开启，
  改由 ⋯ 卡「十字高亮」按钮 toggle，按钮 `active` = 已开启（`usheetChromeModel.buildMoreRows(fmt, { crosshair })`）；
  `useSheetCommandActions` 里原有的 crosshair 分派已删（状态归组件，避免两套）。
- **不持久化**：operation 不写正文、不进 S3；重开表格回到「关」（用户只要求开关，未要求记忆）。
- **门禁**：tsc 0 · vitest **361 文件 / 2511 例**（新增「十字高亮默认不亮 + 开启时 active」1 例）· ui-metrics ✓ · check:mobileui ✓ · diff-check ✓；APK `--sync` 重打并装 emulator-5554 冒烟通过。

### 261022 · 最终定稿：三个仓库同内容（vendored 公开）+ GitHub Actions 打包发布

- **用户定稿（261022 晚）**：不再区分“公开镜像不含内核”。**Gitee private / Gitee public / GitHub public 三个仓库内容完全一致**，内核以 vendored 形式随仓库与构建产物公开分发（未取得语雀授权，风险自担，声明见 `NOTICE`；权利人要求即移除）。
- **仓库管理**：一个本地仓 + `publish` remote（private + Gitee public + GitHub public 三个 pushurl），`git push publish master --tags` 一次推三处；不再使用 export 脚本（已删）。
- **打包**：`.github/workflows/release.yml` —— tag `v*` 触发；macOS（`macos-15`，未签名 dmg/zip）+ Android（`ubuntu-24.04`，debug apk）构建，产物发 GitHub Release；若配置 `GITEE_TOKEN` secret 则同时通过 Gitee API 上传到 Gitee 发行版。
- **前提**：GitHub 仓库待建；建好后加 remote 推同一提交再打 tag 验证 CI；Gitee 公开仓已改为同内容（含内核）。
- **风险**：公开仓/Release 含内核源文件与二进制 = 最高暴露形态；`NOTICE` 仅声明态度，不改变法律风险。

### 261022 · 双仓落地：私有开发仓（vendored）+ 公开镜像（导出）· **已提交**（hash 以 `git log` 为准）

- **用户定稿**：Gitee 两个仓 —— `local-lakex-notes-private`（private，唯一真源，内核 vendored 入库）→ 导出 → `local-lakex-notes`（public，不含内核）；后续再加 GitHub 公开远程（同一镜像）。无私有 npm registry，故**公开仓继续用 `setup:lakex` 私有归档恢复**（变体 1），不做 npm 依赖。
- **导出机制**：`scripts/export-public.mjs`（`npm run export:public [-- --push]`）复制私有仓全部跟踪文件，排除 `vendor/lakex-doc-react/`、`public/vendor/lakex*/`、`docs/PRIVATE-REPO.md`、本脚本自身；公开仓 `.gitignore` 自动追加内核忽略块、`package.json` 去掉 `export:public`；自检公开仓无内核路径；提交信息 `chore(public): sync from private@<hash>`。
- **私有仓**：`vendor/lakex-doc-react/`、`public/vendor/lakex-doc/`、`public/vendor/lakex/` 已 `git add` 入库（私有历史）；公开仓保持零内核。
- **约定**：公开仓只读镜像，改动回流私有仓；内核永不推公开 remote；私有仓继续保留仓库外 `../private/lakex-private-*.tar.gz` 备份。
- **命令**：`npm run export:public -- --push`（公开仓 clone 在 `../lake-notes-electron-public`，可用 `LAKE_PUBLIC_REPO` 覆盖）。
- **门禁**：导出后公开仓 `git ls-files` 无内核路径；私有仓 tsc 0 · vitest 全量 · `git diff --check`。

### 261022 · 闭源内核移出公开仓库（为 public 仓库准备）· **已提交**（hash 以 `git log` 为准）

- **用户定稿**：仓库要 public，但闭源 lakex 内核不公开；**本地留一份私有备份**（"万一语雀要求下架/追责，确保自己还能用"）。README / NOTICE / AGENTS 已按此改口径。
- **移出内容（源码树 + git 历史都移除）**：`vendor/lakex-doc-react/`、`public/vendor/lakex-doc/`、`public/vendor/lakex/`（含历史旧路径 `vendor/npm/lakex-editor-react-component`、旧 `public/vendor/lakex-doc`）。已写入 `.gitignore`；`git filter-repo --invert-paths` 重写全部历史（旧 hash 再次失效）。
- **恢复/备份脚本**：`scripts/setup-lakex-private.mjs`（`npm run setup:lakex` / `backup:lakex`）；`preinstall` 已接入 —— 缺内核时直接报错给指引，**不静默降级**。
- **私有备份（仓库外，不入库）**：`/Users/admin/file/local-lake/private/lakex-private-261022.tar.gz`（12MB，附 sha256/元数据 json）、`lake-notes-electron-pre-kernel-purge-261022.bundle`（56MB，重写前全历史）。
- **口径**：本地留存 ≠ 获得授权，只是"被要求下架后自己还能构建/自用"的技术保障；不得再把内核提交/上传/打进公开 release。
- **门禁**：删掉三处 → 从归档恢复 → 逐文件对比一致；tsc 0 · vitest 全量 · `git diff --check`。
- **未做/注意**：GitHub 仓库仍待用户创建；Gitee 若为 public，历史已 force-push 覆盖，但平台缓存/旧对象可能滞后。

### 261022 · 收尾：AGENTS 回根 / AGPL-3.0 / HANDOFF 大精简

- `AGENTS.md` 已移回**根目录**（长期记忆自动加载）；`docs/AGENTS.md` 移除，全仓 `docs/AGENTS.md` 引用改回根路径。
- 新增 `LICENSE` = **AGPL-3.0-only**；新增 `NOTICE`：闭源 Lakex 内核（经 `@dlient/lakex-doc-react` 引入并 vendored）**不属于 AGPL 授权范围**，公开再分发前需移除 vendor 或取得权利人许可。
- **HANDOFF 精简**：从 547KB / 3231 行压到当前规模——删除 261020 及更早的 §0 批次、261020 及更早的 §8 移动端批次（历史在 git）；保留 261022 / 261021 批次与 §1/§3/§4/§5/§6/§7/§8 常用部分。
- **风险结论（供决策）**：`@dlient/lakex-doc-react` 是 MIT 包装层，但内核本身闭源；该包的存在/被使用不代表授权链条完整。**本仓库若公开并包含 `vendor/lakex-doc-react`，风险由本仓库承担**；更稳的做法是 public 仓库移除 vendor、改为构建时从外部获取，或仓库保持 private。

### 261022 · 文档清理（删除已完成 / 过期审计与设计文档）

- **删除**：`docs/CODE-REVIEW-261015.md`、`docs/KERNEL-REUSE-AUDIT.md`、`docs/MOBILE-CODE-REVIEW-261020.md`、`docs/MOBILE-DESKTOP-DECOUPLING.md`、`docs/MOBILE-UI-REDESIGN.md`、`docs/UI-PRIMITIVES-PHASE1-260926.md` 及 `docs/preview/ui-primitives-260926.html`（均已完成/已被现行规格取代；git 历史可查）。
- **引用收口**：15 处指向这些文档的引用改指现行单一来源（`../AGENTS.md` / `docs/LAKEX-CONTRACT.md` / `docs/MOBILE-TECH-STACK.md` / `docs/MOBILE-DESIGN.md` / `docs/DESIGN.md`）；`docs/` 现只保留**现行规格/契约/指南/交接**。
- **保留**：ARCHITECTURE · BITABLE-VIEWPORT · CODEX-GUIDE · DEVELOPMENT · DESIGN · HISTORY-DESIGN · INK-PAD · LAKE-CONTENT-WRITING · LAKEX-CONTRACT · MOBILE-DESIGN · MOBILE-TECH-STACK · MOBILE-USHEET-YUQUE-PARITY · PANEL-CONTRACT · PRODUCT · QUICK-NOTES-SPEC · RELEASE · S3-GC-DESIGN · STORAGE-LAYERS · SYNC-PROTOCOL · SYNC-RELIABILITY-VERIFY · TRASH-NOTEBOOK-DESIGN · TROUBLESHOOTING · USHEET-UPGRADE · AGENTS · HANDOFF。
- **门禁**：tsc 0 · vitest 361 文件 / 2509 例 · `git diff --check` ✓。

### 261022 · 仓库清理 + 交接文档迁入 docs/ + GitHub README 重写

- **清理**：删除合并后的 worktree（`deps-261022` / `ink-pad-poc`，合计约 3.2GB）与对应本地/远程分支；删除旧 `release/`（904MB，且是改名前的旧包）；`git gc` 后 `.git` 约 57MB。
- **文档迁移**：`HANDOFF.md` / `PRODUCT.md` / `DESIGN.md` / `AGENTS.md` 全部移入 `docs/`；根目录保留 `AGENTS.md` 入口 stub（自动加载后指向 `../AGENTS.md`）。全仓引用（README、docs 互相引用、scripts、src 注释、`.impeccable` 相对路径）已同步。
- **README 重写**：按 GitHub 项目首页结构组织 —— 项目简介 / 当前能力 / 技术栈 / 目录结构 / 数据与存储 / 环境要求 / 安装与本地开发 / 测试与门禁 / 构建 / 打包与发布 / 文档索引 / 数据与隐私 / 许可与致谢 / 免责声明。
- **验证**：tsc 0 · vitest **361 文件 / 2509 通过（17 skip）** · `git diff --check` ✓。
- **未做/注意**：GitHub 仓库仍需用户创建（`local-lakex-notes`）后加 remote 推送；旧 `release/` 已删，需要时重新打包；邮箱重写备份 `/tmp/lln-pre-email-rewrite.bundle` 仍保留，确认后可删。

### 261022 · Git 身份与历史邮箱标准化（个人项目）

- **当前身份（仅本仓库 `.git/config`）**：`gtycoder <46844878+gtycoder@users.noreply.github.com>`（GitHub noreply；id 46844878 取自 `api.github.com/users/gtycoder`）。**全局 `~/.gitconfig` 仍是公司身份** `gaotianyu01 <gaotianyu01@kanzhun.com>`，公司项目不受影响。
- **历史重写**：用 `git filter-repo --mailmap` 把全部 `gaotianyu01@kanzhun.com` 的 author/committer 改为 `gtycoder <1162895623@qq.com>`（1768 条）；agent 身份（`codex@local` / `agent@local` / `dsh@local`）保持不变。**所有旧 commit hash 失效**（同 261017 那次重写），文档里旧 hash 只作历史记录、`git show` 已不可达。
- **已强推 Gitee**：`master 806d9311`、`chore/deps-261022 47c62a43`、`feat/ink-pad-poc 33376f7f`（`main` 旧 Tauri 分支未动）；两个 worktree 已随重写更新到新 commit。
- **回滚包**：`/tmp/lln-pre-email-rewrite.bundle`（重写前 `--all` 备份，58MB）；确认无误后可删。
- **后果/注意**：其它克隆/会话必须 `git fetch --force` 后 reset 或重新 clone；GitHub 仓库尚未创建，之后直接推新历史即可（若之前推过旧历史则需 force-push）。
- **其它项目如何分开**（本次未改全局）：单仓库可 `git config user.email ...`；按目录用 `~/.gitconfig` 的 `includeIf "gitdir:~/file/local-lake/"` → 个人配置、`includeIf "gitdir:~/公司目录/"` → 公司配置。

### 261022 · 品牌/身份标准化：local-lakex-notes（全量改名，无存量）· **已提交**

- **用户定稿**：项目名 `local-lakex-notes`（GitHub 空间同名，用户自行创建）；本地无存量数据 ⇒ **连同包名 / appId / 数据库与存储键全部标准化**，不做旧值兼容。
- **映射（执行结果）**：
  - npm `name`：`lake-notes-electron` → **`local-lakex-notes`**；`build.productName`：`LocalLakeNotes` → **`LocalLakexNotes`**。
  - appId：`com.lakenotes.electron` → **`com.locallakexnotes.desktop`**；Android `com.lakenotes.mobile` → **`com.locallakexnotes.mobile`**（namespace/applicationId/`strings.xml`/Kotlin 包目录一并迁移）。
  - 数据目录：`lake-notes-dev` → **`local-lakex-notes-dev`**；`lake-notes-electron` → **`local-lakex-notes`**（旧目录不再读取）；日志 `local-lakex-notes.log`。
  - 存储键：`lake-notes-v3.*` → **`local-lakex-notes-v3.*`**；`lake-notes-mobile.*` → **`local-lakex-notes-mobile.*`**；移动端 SQLite `lake-notes-mobile` → **`local-lakex-notes-mobile`**。
  - S3：迁移码前缀 `LNS3.1.` → **`LLN1.`**（载荷 app/seed/key 同步改名）；默认对象前缀 `lake-notes` → **`local-lakex-notes`**。
  - 深链：`lakenotes://quick-note` → **`locallakexnotes://quick-note`**；私有协议：`lake://app` → **`locallakexnotes://app`**（`APP_SCHEME` + 协议注册 + 测试/脚本同步）。
  - 共 172 个跟踪文件、约 500 处替换；Android Kotlin 包目录 `com/lakenotes/mobile` → `com/locallakexnotes/mobile`（main + test）。
- **有意保留（不是漏改）**：物理仓库目录 `lake-notes-electron` 与 `lake-notes-electron-worktrees/*`（改名会断 worktree/其它会话，另行处理）；`LAKE_*` 开发环境变量；`--lake-*` 设计令牌；`lakex` 内核名与 `.lake` 格式；S3 桶名 `local-lake-hebei`。
- **验证**：tsc 0 · 全库 vitest **361 文件 / 2509 通过（17 skip）** · 桌面构建 ✓（隔离实例实测页面 `locallakexnotes://app/index.html`、标题 `LocalLakexNotes`、日志 `local-lakex-notes.log`）· Android `assembleDebug` ✓、新包 `com.locallakexnotes.mobile` 已装 emulator-5562 并启动（旧包 `com.lakenotes.mobile` 仍在设备上，可自行卸载）。
- **注意**：桌面 dmg/app 仍是旧名旧包（需重打）；本机旧开发数据（`lake-notes-dev`）不再被读取；GitHub 仓库需用户在 GitHub 建 `local-lakex-notes` 后加 remote。

### 261022 · 本会话改动 review（查漏补缺）· **已修复，全量门禁转绿**

- **修复 1（数据安全，真问题）**：`@univerjs/sheets-note` 会把备注写进 **plugin resource**；移动端只装了 UI 无关的数据插件之前**没装** ⇒ 移动端保存会静默丢掉桌面写的备注。现在移动端也注册 `UniverSheetsNotePlugin`（只数据、无 UI），并把两端插件顺序统一为 **hyperlink → note → crosshair**（resources 顺序一致，避免假冲突）。`·`
- **修复 2（护栏与移动端重构同步）**：`quickNoteSort.test` 的「移动端用共享本机读写」断言仍指向 `HomePage`，而 261022 重构把偏好读写移到 `src/mobile/home/useQuickNoteListModel.ts` ⇒ 断言改到新落点（仍是同一份 `lib/quickNoteSortPref`）。
- **修复 3（红线计数）**：移动端新增只读接口 `getHomeSnapshot` 已登记进 `NONE_OPS` ⇒ `maintenancePolicy.test` 基线 42→43（ALL 76→77），注释写明来源。
- **清理**：去掉未使用的直接依赖 `@univerjs/sheets-hyper-link`（只经 preset/-ui 使用）；去掉多余的 crosshair zh 词条覆盖（内核 1.0.3 自带 zh-CN）。
- **复核结论（本会话各批）**：① 思源类名清零后，产品代码无 `.b3-*`/`fn__*`，改名均为同层同声明（42 态计算值多重集对照见前条）；② 分屏分隔线只在右栏 border 上、像素扫描 0 缺口；③ 目录栏渐隐仅目录树摘除、另两个接入点保留；④ 表格 P1 桌面右键「添加链接/添加批注」与十字高亮实测通过；⑤ 新增包全部 1.0.3 精确锁、`univerContract` 护栏通过。
- **全量门禁（本次修复后）**：tsc 0 · vitest **359 文件 / 2502 通过（16 skip）** · ui-metrics 0 · check:core ✓ · check:mobileui ✓ · 双端构建 ✓ · check:bundle ✓ · `git diff --check` ✓。
- **未做（已知）**：`scripts/usheet-kernel-probes.mjs` 还没为 hyperlink/note/crosshair 增运行时探针（静态护栏已覆盖）；桌面 dmg 仍是旧包（需重打）。

### 261022 · 移动端代码审计结项 + query API 彻底迁移 · **已完成，待推送**

- `MOBILE-TECH-STACK.md` 范围内 P0–P3 已结项；P2-6 完成 13 个状态切片，`MobileUsheetViewer` 834 → 544 行。
- 删除旧移动 bridge/lakeNative API：`listNotes` / `listQuickNotes` / `listTreeNodes` / `listNotebookTree`；统一迁移为 `getHomeSnapshot` / `getQuickNotePage` / `getWorkspaceSnapshot`。
- 生产、单测、夹具、同步探针、性能脚本和验收脚本已全部迁到新 query API；仓库内不再有旧接口调用。
- `getHomeSnapshot` 返回树/文档 metadata 与 `QuickNotePage`；`getQuickNotePage` 直接支持 keyset 分页；`getWorkspaceSnapshot` 一次返回当前笔记本元数据与递归 CTE 子树。
- CI 性能基准：5k 首页 metadata 8.6ms / 树 24.4ms / 小记首屏 0.37ms；100k 树 470ms。
- 门禁：tsc ✓ · 全库 vitest **361 文件 / 2508 通过（17 skip）** · quickNotes 60 例 ✓ · 双端构建 ✓ · check:core/mobileui/bundle ✓ · diff-check ✓；APK 在 `emulator-5562` 安装/启动/首屏截图/无 FATAL 日志烟测通过。

### 261022 · 表格 P1（超链接 / 单元格备注）+ 十字高亮（用户点单）· **已提交 `212aa4f5`**

- **依赖**：新增 3 个 Univer 1.0.3 精确锁包（`preset-sheets-hyper-link`、`preset-sheets-note`、`sheets-crosshair-highlight`）+ 2 个直接依赖（`sheets-hyper-link` / `-ui`，移动端要直接引移动 UI 插件）⇒ 全部 1.0.3，`univerContract` 护栏同步扩包列表。
- **桌面**（`usheetUniverFactory` 单一入口）：超链接 preset（`urlHandler.navigateToOtherWebsite → window.open`，主进程 `setWindowOpenHandler` 已转系统浏览器）+ 备注 preset + 十字高亮插件；locale/CSS 一并引入。实测「插入」页签出现 **插入链接**；**单元格右键菜单出现「添加链接 / 添加批注」**；十字高亮打开表格默认开启（行列底色截图），「视图」页签出现内核开关（图标型，hover 提示「十字高亮」）。
- **移动端**：超链接用**移动 UI 变体**（`UniverSheetsHyperLinkMobileUIPlugin`，弹层是移动版），入口 = ⋯ 卡「链接」；十字高亮用移动插件 + ⋯「十字高亮」toggle（默认开启）；备注在内核 1.0.3 无移动 UI 变体 ⇒ 移动端暂不接（已记录）。
- **一处内核缺词条**：`sheets-crosshair-highlight` 1.0.3 没有 zh-CN 词条 ⇒ 菜单按钮无文字/tooltip。已在两端 `mergeLocales` 补 `sheets-crosshair-highlight.button.tooltip=十字高亮`。
- **契约/护栏**：`usheetKernelContract.ts` 增超链接/十字高亮/备注命令 + crosshair 配置键 + 移动菜单 id；`univerContract.test.ts` 扩包；`usheetChromeModel.test` / `mobileUniverPreset.test` 增断言（链接可用、十字高亮存在、移动 UI 替换生效）。
- **未做（明确）**：备注移动端、`sheets-thread-comment`（评论）、选择性粘贴/保护行列的移动端入口（命令已有，需产品语义/后续批次）。
- **验证**：隔离 scheme 实例（合成夹具）实测插入链接 / 十字高亮视觉；单测 12 例通过。⚠️ 全库 `tsc` 暂被并行移动端会话的在途 WIP（`src/mobile/settings/SettingsDrawer.tsx` 未用 import）挡住，与本批无关。
- **状态**：已提交 `212aa4f5`（代码 + 依赖）；APK 已重打并装到 emulator-5562（44,298,474 B，App 启动正常）；**表格内新增入口的设备级点按验收待做**（需要一台带表格数据的 AVD）。

### 261022 · 表格能力差距盘点（对比 Excel / 未被接的 Univer 1.0.3 包）· **仅文档**

- **方法**：核对 npm 上 `@univerjs/*@1.0.3` 的可用包 + 隔离实例实测桌面 ribbon / 右键菜单 + 移动端自绘 chrome 的置灰项。详见 `docs/USHEET-UPGRADE.md §8`。
- **Univer 1.0.3 有包、我们没接（可直接补）**：`sheets-hyper-link`（超链接）、`sheets-note`（单元格备注/批注）、`sheets-thread-comment`（评论）、`sheets-table`（结构化表格）、`sheets-conditional-formatting`（条件格式）、`sheets-data-validation`（数据验证）、`sheets-crosshair-highlight`（行列十字高亮）。以上都有对应 `preset-sheets-*` 组合包。
- **已内置、只是没入口（尤其移动端）**：右键菜单已有 **选择性复制/选择性粘贴** 与 **保护行列**；「视图」页签已有 **冻结 / 背景图片 / 全屏 / 网格线 / 缩放 100% 下拉**。移动端 ⋯ 卡把 保护/垂直对齐/换行/字号 等标成「暂不支持」，实际命令在 Univer 里是有的（接线即可）。
- **Univer 1.0.3 本身没有对应包（补不了，需等升级或自研）**：图表（无 `sheets-chart`）、数据透视表、分组/分级显示（无 `sheets-outline`）、打印/页面设置（无 `sheets-print`）、形状/文本框（无 `sheets-shape`）。
- **产品层缺口（不依赖上游）**：表格**导入** CSV/XLSX（目前只有导出：`usheetCsv` / `usheetExcel` write-only）；移动端没有表格导出入口；打印/PDF 页面未做。
- **建议优先级**：P1 = 超链接 + 单元格备注 + 移动端补（选择性粘贴 / 保护行列 / 导出）；P2 = 结构表、条件格式、数据验证（用户明确不急）、评论；P3/不做 = 图表/透视表/分组/打印（等 Univer 升级）、十字高亮（可选）。

### 261022 · 表格 P1 状态核对（文档纠偏，无代码变更）

- **用户判断**：「表格 P1 应该已经做完了，只是文档没更新」。核对结果：**一半对**。
- **✅ 桌面公式库已具备**（文档 §3#15 P1⑦ 过时）：隔离实例（合成夹具 + scheme/CDP 9234）打开 usheet 后，ribbon 页签 = 开始 / 插入 / **公式** / 数据 / 视图；「公式」页签实测 8 类：**常用函数 / 财务 / 逻辑 / 文本 / 日期与时间 / 查找与引用 / 数学与三角函数 / 统计**（Univer `preset-sheets-core` 自带的 `sheets-formula-ui`，我们只做了配置式接入）。原文「现只有 5 个快捷函数」描述的是**移动端**的 `USHEET_QUICK_FORMULAS`。
- **❌ 条件格式 / 数据验证确实未做**：`node_modules/@univerjs` 里**零** `*conditional*` / `*data-validation*` 包，`package.json` 未声明，源码/产物 0 引用；桌面「数据」页签实测只有查找替换 + 排序；移动端 ⋯ 卡显式写「条件格式（暂不支持）」；`docs/USHEET-UPGRADE.md §7` 也把它们列在「中期」。
- **另**：HANDOFF §0 里的「261020(三) 表格 P1（布局动作 + 数字格式 + 常用公式）」是**移动端**的 P1 批次，已合并且有记录 —— 如果指的是它，则「已做完且文档有记」。
- **本批只改文档**：§3#15 P1 状态 + `docs/USHEET-UPGRADE.md §7` 路线图同步为「桌面公式库已完成；条件格式/数据验证仍待 Univer 升级批次」。

### 261022 · 桌面端彻底摆脱思源类名契约（§3#20 结案）· **已提交 `e4aa2b38`（代码）+ `b5bbd89a`（基线）**

- **范围**：桌面 16 文件 / 27 个类名（TSX 227 处）+ compat/kit/components/feature/quick-notes/dialog/kernel-theme 里的对应规则；移动端零改动。
- **改名映射（一次性、保持层序与声明原样）**：
  - 列表族：`.b3-list` → `.ln-list-panel`、`--background` → `ln-list-panel--background`；`.b3-list-item*` → `.ln-list-item*`（text/graphic/meta/action/action--warning/--focus/--hide-action/__toggle）。
  - 版式/工具：`.b3-label*` → `.ln-label*`；`fn__space/size200/flex-center/kbd/ellipsis` → `.ln-spacer/.ln-w-200/.ln-flex-center/.ln-kbd/.ln-ellipsis-block`；`fn__none`（零使用）删除。
  - 控件：`.b3-button` → `ln-btn ln-btn--primary`、`--outline` → `ln-btn--secondary`、`--cancel` → `ln-btn--ghost`（原 `:not(.quick-note-*)` 链已过期，整段删除；小记按钮早已迁到 ln-btn）；`.ft__error` 组合 → 新增 `.ln-btn--danger-text`（只染文字 + 保留二次描边 hover 的浅红底）；`.b3-text-field` → `.ln-text-field`；`.b3-select`/`.b3-switch` 规则**整段删除**（TSX 已零使用；开关早已是 `.ln-switch`）。
  - 级联修复：kernel-theme（未分层）的 4 条 `button.b3-button…` 改为 ln-btn 变体；quick-notes/components 里按旧类名的组合选择器同步改名。
- **验证**：
  - 门禁：tsc 0 · 全库 vitest **348 文件 / 2462 例**（含并行移动端新增用例）· ui-metrics 0 · core/mobileui/bundle ✓ · `git diff --check` ✓（kit/compat 声明数下降，未抬基线）。
  - **42 态整页计算值对照**（rename 前 `prerename-261022.json` vs 后 `postA.json`）：**元素数逐态相同**；差异只有迁移按钮的 2 类计算值 —— `justify-content`（b3 基座显式 center → ln-btn 默认 normal；按钮都是内容自适应宽度，无布局差异）与 `transition`（ln-btn 多按压/不透明度两项，属有意统一）。每个态固定 12 个常驻按钮 + 面板内按钮数，与差异条数吻合。
  - `stylesnap` 基线已按改名后重烤（42 态两轮一致）。
- **合规**：AGPL-3.0 署名保留 —— 设置页「关于 → 思源笔记 SiYuan」文案已从「见 src/b3/siyuan/」更正为「规则已收编到 compat.css/kit.css」，compat.css 文件头补署名说明。
- **判据达成**：全仓产品代码 `grep -rn "b3-\|fn__"` 仅剩历史注释/许可说明（字体的 `U+95b3-95b4` unicode-range 属误报）。

### 261022 · 桌面 stylesnap 基线重烤（§3#24 结案）· **已提交 `ba6d5a8d`**

- **背景**：基线是 261018 烤的，261019–261021 批次后每态 +19 元素 ⇒ 定点/全量 stylesnap 一直假红（§3#24）。
- **做法（按 README 口径）**：冻结合成夹具 `$HOME/Library/Caches/local-lakex-notes-css-audit/fixture`（8 notes / 11 tree_nodes）→ 隔离 scheme 实例（独立 `LAKE_USER_DATA` + `LAKE_ASSET_PORT=19811` + CDP **9231** + `--disable-gpu --no-sandbox`）→ 两轮完整 42 态采集（snapA / snapB）→ 逐态逐行完全相同 → `check-stylesnap.mjs --from snapA.json --write-baseline` → 用 snapB 复验 0 差异。
- **结果**：相对旧基线**每态 +21 元素**（plain 2351 → **2372**、settings 2480 → **2501**、resources 2389 → **2410**），与 §3#24 的「恒定增量 = 全局外壳」判断一致；34 态严格比对 0 差异，8 个窄窗态按脚本 `UNSTABLE` 名单跳过（照常入库）。
- **一次假基线的教训（已排除，未入库）**：第一次拷贝夹具时用了 `process.env.HOME`（**本机 DSH 的 `run_code` 里 `process.env` 为空**）⇒ `cp` 失败、实例新建了空工作区，烤出「每态 2194 元素」的假基线。判据：**元素数比旧基线少 157** ⇒ 立刻停手、查夹具是否真加载（`.tree-row` 只有 2 行 = 空工作区）。以后在 DSH 里复制路径一律用 **shell 的 `$HOME`**，不要用 Node 的 `process.env.HOME`。
- **状态**：已提交 `ba6d5a8d`。`§3#24` 结案。

### 261022 · 分屏两栏之间加常驻分隔线（用户点单）· **已提交 `f34607d5` + `98f33dd5`（已推送）**

- **用户口径**：分屏左右两篇文档背景一样、贴在一起「融合到一起」；要求中间有一条竖线做分隔。
- **最终改法（分屏专属，最小）**：`src/features/editor/splitView.css` 给 `.tab-panels.is-split > [data-pane="right"]` 加 `border-left: 1px solid var(--lake-border-1)`。**线画在右栏的盒子上，不画在分隔手柄上**。
- **为什么不在手柄上（用户 261022 第二轮报「工具栏这一块缺了一块」，已实测定位）**：内核工具条 `.ne-ui` 是 `position:sticky` + `z-index: var(--lake-z-editor-sticky)=150` + 白底，正好在工具条那一行把 1px 手柄边框盖住 ⇒ 缺口高度 = 工具条高。画在栏的 border 上时，栏内所有子元素都排在 border 右侧 ⇒ 面包屑 / 工具条 / 表格 / 画板各类型都不断线（不必抬 z-index 去和内核叠层打架）。
- **护栏**：`splitPane.test.ts` 断言分隔线在右栏规则里、且禁止画回手柄（kit 原语也不得出现 border-left）；`cssLayers` 基线 `splitView.css` 9 → **10**（+1 即该声明）。
- **门禁**：tsc 0 · 全库 vitest **345 文件 / 2470 例** · ui-metrics 0 · `git diff --check` ✓。
- **实测（隔离实例 CDP 9232/9233 + dev 数据副本，用完已销毁）**：
  - 布局：右栏 `x=752 / w=528`、`border-left = 1px solid rgb(230,232,236)`，与左栏 224+528=752 完全对齐；
  - 像素级：截图逐像素扫分隔线列，**工具条区 0 行缺口、整个栏高 0 行缺口**；
  - 截图 `.css-audit/rebuild-261022/split-divider.png`（全窗）、`split-divider-continuous.png`（分隔线放大，贯穿面包屑/工具条）。
- **状态**：已提交 `f34607d5`（首版手柄线）+ `98f33dd5`（改右栏 border，修工具条缺口）（仅本地 master，未推送）。

### 261022 · 思源残留清理第一批（桌面 §3#20 的第一刀）· **已提交 `0d90b845`（已推送）**

- **目标（§3#20）**：桌面 JSX 仍把 `.b3-*` / `fn__*` 当类名契约在用；终态 = 全仓 `grep b3-\|fn__` 只剩「许可署名 + 历史说明」两类注释。
- **只读盘点（261022，桌面，排除 src/mobile）**：TS/TSX **21 文件 / 25 个类名 / 227 处**；CSS 侧 `compat.css` 39 条规则、`kit.css` 30 条规则行（.b3-button/-text-field/-select/-switch/-list-item 族）、`components.css` 3 条。**`var(--b3-*)` 全仓引用 = 0** ⇒ themes 里 22×3 条 `--b3-*` 过渡令牌是死值。死规则（TSX 零使用、动态拼接已排查）：`.b3-menu*` 8 / `.b3-snackbar*` 4 / `.b3-dialog` / `.b3-list-item--selected` / `.fn__flex-1`。
- **本批（零视觉变化）**：删 66 条 `--b3-*` 令牌 + 15 条死规则（compat.css −62 行；仍保留 b3-list/label/switch 与 fn__* 工具类），compat.css 头注释同步。
- **门禁**：tsc 0 · vitest **345 文件 / 2465 例**（含并行移动端会话新增用例）· ui-metrics 0 · cssLayers / uiPrimitives ✓ · `git diff --check` ✓。
- **未做（下一批，等依赖升级合入）**：① JSX 重命名（16 文件 / 27 类名）→ kit 原语；② compat 剩 25 条、kit 30 条规则行、components 3 条随类名一起迁；③ **stylesnap 的 key 含 class 列表** ⇒ 改名会让 42 态基线整份失效，改名后必须整份重烤，不能拿「0 diff」证视觉中性（改用截图 + 计算值抽查）；④ 许可：README 要求移植样式留 NOTICE / 关于页署名，本仓当前**没有 NOTICE 文件**，改名后要确认署名仍在（或补 NOTICE）。
- **状态**：已提交 `0d90b845`（仅本地 master，未推送）。

### 261022 · 桌面目录树去掉上下边缘渐隐（用户点单）· **已提交 `2a298e48`（已推送）**

- **用户口径（截图）**：目录栏顶部（F16 探针 44）与底部（移动表格）两处「模糊」去掉。实为 261017 B 的「滚动边缘渐隐」：`.note-list.tree-list` 是 7 档 alpha 遮罩（28px）的三个接入点之一，目录滚到中间时上下两侧被柔化。
- **改法（根位置，最小）**：① `Sidebar.tsx` 摘掉 `useScrollFade(treeRef)` 与 import（目录树不再打 `data-fade-top/bottom`）；② `kit.css` 的 14b 选择器组只剩 `.ln-select__list` / `.quick-notes-index`（**下拉弹层、小记列表的渐隐保留**）；③ 注释与 `useScrollFade.test.ts` 反转断言（目录树不得再出现 hook/选择器）；④ `DESIGN.md`「Scroll Edges」记录「目录树不渐隐，别加回」。
- **门禁**：tsc 0 · 全库 vitest **337 文件 / 2448 通过（16 skip）** · `ui-metrics` 0（跨文件重复 12 ≤ 基线 13）· `git diff --check` ✓。mask 不进快照 PROPS ⇒ 不涉及 stylesnap 基线（基线本身仍陈旧，见 §3#24）。
- **dev 实测（用户正在运行的 1421/9222 实例，HMR 已生效）**：`getComputedStyle(nav.note-list.tree-list).maskImage === "none"`、`data-fade-*` 已无；目录滚到中段（scrollTop 2039 / scrollHeight 3138）时首末行**不再变淡**，截图 `.css-audit/rebuild-261022/sidebar-no-fade.png`。
- **状态**：已提交 `2a298e48`（**仅本地 master，未推送**；等用户验收）；桌面 dmg/zip/app 已按本改动重新打包。

### 261021(六) · CSS 层收尾：A/B 核验 + C/D（依赖准入 / 三处漂移收口）· **已合并 master `98e9278e`（工作于 261022 凌晨）**

- **承接**：上一会话留下分支 `feat/desktop-vendor-css-layer`（worktree `.../vendor-css-layer`）与两笔 A/B 提交 `a804df67` / `f4e981fa`；本会话先 `git merge master`（master `7f378130` → 合并提交 `0d0d8e5a`；唯一冲突 = HANDOFF，两边条目都保留），再在合并后基线上做 C/D。
- **A/B 核验（两笔提交完整）**：4 个护栏测试 20 例通过（cssLayers / quickNoteKernelFallback / cssLayerScan / vendorCssLayer）；旧产物自证仍在 —— **master `7f378130` 构建**仍产 `QuickNoteKernelPreview-*.css`（1,280,726B、0 个 @layer、antd banner），**本分支构建**该 chunk CSS 消失、内核 CSS 只在 `index-*.css` 的层内；`audit-vendor-css.mjs` 对分支 5 个产物 CSS 全 OK。
- **C（依赖准入）**：AGENTS §3 新增 `22. 依赖准入（261021 调研定稿）`：新依赖四问（已验证痛点 / 第二套样式·令牌·preflight / 体积·离线·许可·打包 / 退出成本与护栏）+ 禁 Tailwind/preflight + headless（Radix）只作未来新复杂控件的实现细节且包一层自有 API + 六候选裁决（Lucide 维持；shadcn/ui、Motion、dnd-kit、react-resizable-panels、Zustand 不引，逐条一句理由；Zustand 标未取证）+ 未取证项翻案先补证据。AGENTS 38,985B（<64KB）。
- **D1（分栏分隔条唯一实现）**：Sidebar / OutlineSidebar 手写 pointer resize 全部删除，统一渲染 `SplitHandle`；原语新增可选 props `className / invert / softClamp / keyStep / keyStepLarge / stopPropagation / onDragEnd`，`containerRef`/`measureLeft` 改可选，`rubberBandWidth` 成为 0.16 橡皮筋唯一实现。护栏：扩 `splitPane.test.ts`（两站点 `<SplitHandle`、无 `handleResize*`/`resizeRef`/`setPointerCapture`）+ `splitHandle.test.ts`（invert / 死区 / 橡皮筋）。
  - **有意行为变化**：侧栏/大纲统一获得 4px 死区（只点击不拖动不再落盘）；大纲键盘不再先调一次 `onWidthChange`（终态相同）；大纲把手 `tabIndex` 固定 0（collapsed 时 content `visibility:hidden`，实际不可聚焦）。
- **D2（手势/动效单一来源）**：新增 `src/lib/longPressTimer.ts` 作为长按计时唯一实现（参数 ms/moveCancelPx/feedback/target，含 click 吞消费）；`features/editor/longPress.ts` 只做原生 touch 接线（450ms/10px、不震动、保留吞 click 与解绑），`mobile/ui/useLongPress.ts` 只做 React 接线（350ms/10px + 震动，**新增卸载 dispose** —— 旧实现卸载后仍会到点回调一次，属清理修复）；`settings.css` 浮窗入场 `180ms` → `var(--lake-motion-panel)`（190ms）。护栏：`src/lib/longPressTimer.test.ts`（13 例 + 静态断言两消费者同源、不再各自 `setTimeout`）与 `motionContract.test.ts`（禁裸时长）。
- **门禁（合并 master 后、C/D 落地后的最终一次）**：tsc 0 · 全库 vitest **337 文件 / 2448 通过（16 skip）** · 双端构建 ✓ · ui-metrics 0/基线内 · check:core ✓ · check:mobileui ✓ · check:bundle（含新审计）✓ · `git diff --check` ✓。
- **视觉对拍**：
  - 桌面（合成夹具 + 隔离实例 scheme/CDP 9231/独立 userData，**master `7f378130` 构建 vs 本分支构建**）：`plain:1315:light` 2370 els、`settings:1315:light` 2499 els、`outline-open:1315:light` 2377 els，**逐态 0 差异**（snapdiff：0 态 / 0 条指纹差异）。
  - 移动端 `home-quicknotes`：本分支 APK 与 master APK（同一 AVD `lake_gate`、同一数据）快照 **1768 els、逐字节相同** ⇒ D1/D2 对移动端零影响。`check:mobilesnap` 报的 1816→1768 是**基线陈旧**（master 同样 1768，见待办 23）。
  - 交互抽查（CDP）：侧栏拖拽 300→372 预览并提交落盘、键盘 ArrowRight +8 / Shift+ArrowRight +24、双击复位 224；大纲（临时 `outlineEnhance=true`）左缘拖动 300→372、键盘 ArrowLeft +8（invert 方向正确）。
- **待办（顺带发现，未处理）**：① 桌面 `stylesnap` 基线陈旧（见 261021(五) 条目）；② **移动端 `mobile-snap` 基线同样陈旧**：master 构建即 1816→1768（−48），与本批无关；合并后用整份 6 态重烤（**别用 `--states` 覆盖基线**）。
- **合并**：`feat/desktop-vendor-css-layer` 以 **FF** 合入 `master`（`master` = `98e9278e`，含 `0d0d8e5a` 的 master 合并 + A/B + C/D）；合并后在主树重跑门禁全绿（tsc 0 · 337 文件 / 2448 例 · 双端构建 · ui-metrics / check:core / check:mobileui / check:bundle / `git diff --check` ✓）。**已推送 `origin/master`（`2845c8bf`）**。
- **状态**：已合并 master；worktree `.../vendor-css-layer` 已删除、`feat/desktop-vendor-css-layer` 已删（合入即删，符合 AGENTS §1）；对拍快照保留在 `.css-audit/snap/vendor-css-layer-261021/`。主树 `local-lakex-notes` 只多出本批改动。

### 261022(二) · 长按小记入口零等待启动（capture 无 logo / 普通启动保留 logo）· **已提交 `c21d3adc`、已推送 master**

- **用户口径**：视觉连续后仍觉得慢；**不加遮罩、不延长任何等待**；capture 不展示 logo、普通启动保留 logo；参考思源「双入口」。
- **入口分离**：新增 `activity-alias .QuickNoteAlias`（target = MainActivity，theme = `AppTheme.NoActionBarLaunchNoLogo`）：Android 12+ 用 `windowSplashScreenBackground` + 透明图标（无 logo/动画），旧版本用纯色 `windowBackground`；普通启动主题保留 `@drawable/splash` / `@mipmap/ic_launcher`。快捷方式 `targetClass` 改为 alias；`locallakexnotes://quick-note` 的 VIEW filter 只留在 alias，MainActivity 保留 launcher / 分享入口。两者是**同一个 MainActivity/WebView/数据**，不复制第二套 App。
- **零等待首帧路由**：MainActivity 注入 `lakeLaunchUrl` JS 接口；`main.tsx` 在 `createRoot` 前同步读，`MobileApp initialCapture` ⇒ React 首帧直接进 capture，不再先画首页骨架再整树切换。`subscribeQuickNoteShortcut` 支持 `skipColdRead`（冷启动不重复轮询 `getLaunchUrl`），并用触发时刻去重，避免 appUrlOpen 二次触发 `setCaptureNonce` 重挂写作卡。
- **纯色底（不盖图）**：Capacitor `backgroundColor`、`mobile.html` 内联 `html,body{background:#ededf1}`、Android `launch_background` 纯色；splash 退场到 WebView 首帧不露白。
- **骨架/过渡**：`QuickNoteComposerSkeleton` 独立成文件，与真实写作卡同构（正文/标签/底部动作行）；模块已到、内核未就绪的窗口期用同一份骨架盖住白卡（就绪即揭，不是启动遮罩）；capture 卡片 120ms 淡入（`prefers-reduced-motion` 关闭）。
- **设备实测（emulator-5554）**：普通启动截帧 s01–s04 有 logo；alias 启动 s02–s03 纯色无 logo → s04–s07 骨架 → s08+ 写作卡+键盘；热启动 alias 复用现有 MainActivity 并打开 capture；`cmd shortcut get-shortcuts` 实测 intent `cmp=com.locallakexnotes.mobile/.QuickNoteAlias`；首帧采样 `home:false / overlay:false / composer:true / skel:true`。
- **门禁**：tsc 0 · vitest **334 文件 / 2415 通过（16 skip）** · ui-metrics 0 · check:mobileui ✓ · 双端构建 ✓ · diff-check ✓。
- **文件**：Manifest / values(-v31)/styles / shortcuts / MainActivity / capacitor.config / mobile.html / MobileApp / main.tsx / quickNoteShortcut / QuickNoteComposer / QuickNoteComposerSkeleton / quickNoteComposerLazy / mobile.css + capture/prewarm/mobile-layers 测试。

### 261021(四) · 移动端表格 P4/P5 第一批：一级工具条补三项 + 排序/筛选**双端**接入 · **待用户验收**

> 用户定稿：① **保存不在工具条重复**（顶栏 ✓ = 手动保存并退出编辑）；② 小数位一级按钮**点一下 = +1 位**，减少放 ⋯ 卡；③ **A/B 都做**，且排序/筛选**桌面端也要**（"这个很常用"）。

- **P4/P5 一级工具条（移动端）**：`＋ ｜ 撤销 重做 格式刷 清除格式 ｜ 常规▾ ｜ .00 ｜ ⋯`（语雀 §2.1 组序，去掉保存位；≈370/412px）。
  - 清除格式 = `fRange.clearFormat()`；小数位 = 新纯函数 `mobile/usheet/usheetDecimals.ts`（±1 位，文本/日期明确提示、到边界提示）；格式刷 = `sheet.command.set-once-format-painter`，激活态由 `sheet.operation.set-format-painter` 回填（不自建状态）。
  - ⋯ 卡瘦身：小数位「增」移出，「减」留第一行（对齐语雀 §2.3）；筛选/排序**点亮**。
- **排序/筛选（双端）**：新增 4 个依赖（**全 1.0.3 精确锁**）`@univerjs/sheets-{sort,sort-ui,filter,filter-ui}`。
  - 桌面：`features/usheet/univerSortFilter.ts` 接桌面 UI 变体 ⇒ ribbon **自动出现「数据」页签**（筛选 order2 / 排序 order3，另右键「数据」组），无需自建菜单。
  - 移动端：`mobile/usheet/mobileSortFilter.ts` 接**移动 UI 变体**（`UniverSheetsSortMobileUIPlugin` / `UniverSheetsFilterMobileUIPlugin`，依赖的正是 `UniverSheetsMobileUIPlugin`）；入口是我们自绘的 ⋯ 卡。
  - **排序不用无参的 `sort-range-asc/desc`**（sort-ui 的 UI 包装会弹"是否扩展选区/仅有一行"的**桌面对话框**，设备实测踩到）⇒ 新增 `mobile/usheet/usheetSortPlan.ts` 自己算数据区（单格/单列 ⇒ 锚列连续块 + 列方向扩到已用列；表头只认「首行文本 + 下面全数值」一个信号），再派发数据层 `sheet.command.sort-range`（`range/orderRules/hasTitle` 显式给全）。
  - **筛选**：先 `set-filter-range`（已存在时返回 false 属正常）再 `sheet.operation.open-filter-panel`（否则只建范围、面板不弹——设备实测踩到）。
- **设备验收（emulator-5554，新 APK 40,486,186 B）**：工具条 8 颗/5 组；小数位真落盘（B3 新增 `{n:{pattern:"#,##0.0"}}`）；清除格式移除样式；格式刷 `is-active`；**降序排序整行换位**（A4/A5 交换、B5 的 `Tttttt` 跟着走到 B4）；**筛选抽屉弹出**（`data-u-comp="mobile-sheets-filter-drawer"`：筛选/按值/按颜色/按条件/清除筛选），正文 `resources` 出现 `SHEET_FILTER_PLUGIN`（`ref:{startRow:2,startColumn:0,endRow:4,endColumn:1}`）。
- **桌面验收（隔离实例 `$TMPDIR/lake-accept-p5` / CDP 9237）**：新建表格 → ribbon 出现「数据」页签；工具栏实测 `data-u-command="sheet.command.smart-toggle-filter"` + `aria-label="排序"`。
- **门禁**：tsc 0 · 全库 vitest **328 文件 / 2366 例（16 skip）** · 双端构建 ✓ · ui-metrics / check:core / check:mobileui / check:bundle ✓ · diff-check ✓ · **内核探针 9/12 通过、3 条 advisory、exit 0**（新增第 6 条「排序/筛选入口出现在数据页签」PASS）。`mobile/usheet/usheet-chrome.css` 基线 216 → **221**（+5 = 小数位按钮）。
- **两条必须记住的后果**（详见 `docs/USHEET-UPGRADE.md` §4.4）：① 筛选是 plugin resource，**首次保存会多一条空壳**（一次 hash 变化/一次上传）；② `resources` 是覆盖写 ⇒ **两端都得装 filter 数据插件**、且注册顺序一致，否则一端保存会静默抹掉筛选/造成假冲突。
- **打开表格「先白再灰再出现，感觉卡」（用户 261022）· 已优化（待复验）**：
  - 实测：表格编辑器是**单个 6.85MB 懒加载 chunk**（`UniverSheetEditor-*.js`，Univer 全量 preset），首开才拉 ⇒ 点击后空白/灰底 → 板面；隔离实例（`--disable-gpu`）里从点击到第二块画布 = 769ms。
  - 修法：`src/App.tsx` 在 workspace 就绪后**空闲预取**该 chunk（`requestIdleCallback(timeout: 8000)`，失败静默）⇒ 网络确认首开前已拉 `UniverSheetEditor-*.js` + `*.css`；复测点击到画布 **769ms → 585ms**（软件渲染；真机 GPU 更快）。
  - 补丁 2（261022，灰遮罩）：用户又说"主要就是灰色遮罩感觉慢"。查清灰遮罩 = **Univer 自带的 WorkbenchSkeleton**
    （`[data-u-comp="workbench-skeleton-content"]`，灰底 `gray-50` + shimmer），生命周期 `Ready` 前**盖在内容上**。
    我们实例创建只要 44ms，这层骨架纯属多余 ⇒ `features/usheet/usheetEditor.css` 用
    `.usheet-editor div:has(> [data-u-comp="workbench-skeleton-content"]) { display: none; }` 隐藏（只作用 usheet 宿主）；
    层围栏基线 `usheetEditor.css` 37 → 38。实例复测：点击后 ~374ms 直接看到**完整表格**（此前该时刻是灰遮罩骨架）。
  - 剩余：实例 `createUniver`（全量 preset）初始化本身仍是几百 ms，属内核启动成本；若还要再快，只能做「隐藏预热实例」或裁 preset（需单独立项）。
- **冷启动落点改为「Lake 文档优先、其次多维表」（用户 261022 定）**：`useBootstrap` 不再直接打开 `lastOpenedNoteId`，
  改由 `src/core/coldStartNote.ts` 的 `chooseColdStartNoteId()` 决定：上次是 Lake 文档 → 直接落它；否则落最近更新的 Lake 文档；
  再否则最近更新的多维表；都没有才退回上次打开/最近更新（宁可慢也不让用户找不到文档）。**不把首开成本高的表格/画板钉在启动交互上**。
  单测 `coldStartNote.test.ts` 5 例。
- **表格「隐藏预热画布」尝试（261022 #1）· 结论：不可行，已回退**：
  - 思路：空闲时先建好 Univer 实例（隐藏容器）→ 首次打开把容器搬进真实宿主 + resize。
  - 实测：① 不挂 workbook 时 Univer **不创建 render unit/canvas**（搬过去也永远空白）；② 挂占位 workbook 让 canvas 先建出来，
    采用时 `disposeUnit` 占位再建真实 workbook ⇒ 出现「先显示真实表、~1s 后又被空表盖掉」的错乱，且点击→画布反而从 ~374ms 变成 ~1035ms（更慢）。
  - 原因：render unit / canvas 与 workbook 生命周期绑定，跨实例搬 DOM 在当前 Univer 1.0.3 架构里没有稳定支撑点。**不要重复这条路**；
    要再压首开只能走"关标签后 LRU 保留实例"或上游能力。
  - 保留：把 createUniver 配置抽成 `features/usheet/usheetUniverFactory.ts`（编辑器单一入口）、`lakeFontFamily` 抽到 `usheetFont.ts`（无行为变化）。
- **表格打开 CPU profile（261022 #2）**：`Profiler` 采样 2747 帧（250µs）—— idle 1821、program 158、`getBoundingClientRect` 66，
  其余为 canvas `drawImage/setTransform` 与 Univer 内部（`_positionInput`/`_buildMenuSchema`）。**没有应用侧热点**，React 挂载不是瓶颈 ⇒ #2 不做改动。
- **桌面表格排序弹窗卡死（用户 261022 报「排序弹窗无法点击、会导致整个 app 卡死」）· 已修（待复验）**：
  - 复现：隔离实例（`$TMPDIR/lake-sortfix` / CDP 9237）建表贴数据 → 数据页签 → 排序 → 「自定义排序」→ 对话框出现后**整窗点不动**；`sample` 实测渲染进程 **120% CPU**、CDP 也不响应（真死循环，不是遮罩挡点击）。
  - 根因：261009 的 Univer 补丁把 floating 层 portal 容器挂进**实例宿主**（当初为防黄叹号逃出标签宿主）⇒ 设计系统 **Dialog（含遮罩）也被 portal 进宿主**，与宿主 `overflow:hidden` + fixed 遮罩组合触发 measure/reflow 死循环。把容器放回 `document.body`（内核原行为）后同一对话框可正常点击、停留 6s+ 无卡死。
  - 修法：`patches/@univerjs+ui+1.0.3.patch` 改为**容器仍挂 `document.body`** + 打 `data-lake-univer-floating` / `data-lake-owner="univer-sheet-<noteId>"` 两个标记；应用侧 `src/features/editor/MultiTabEditor.tsx` 按**当前可见标签**把其它实例的容器 `display:none`（MutationObserver 兜底新容器）⇒ 261009 的黄叹号仍然不会逃逸。
  - 同批更新：`usheetKernelContract.ts` 的 `UNIVER_PATCH_HOOKS`（契约改成 body + owner）、`univerContract.test.ts` 护栏③（禁 `mountContainer.appendChild(portalContainer)`、要求 owner + 应用侧按 owner 收起）、`scripts/usheet-kernel-probes.mjs` 两条探针（容器在 body 且带 owner；切走后 `display:none`）、`docs/USHEET-UPGRADE.md` §4.7。
  - 设备/实例验证：自定义排序 → 提醒对话框 → 确认 → 「所选区域仅有一行，无法排序」提示全程可点、无卡死；切到其他标签后 `[data-lake-univer-floating]` 实测 `display:none`（宽度 0）。
- **冷启动慢（用户 261021 报「感觉加了启动比以前慢」）· 已定位并修（待复验）**：**不是动画强制播放**（代码无最短展示，overlay 只等 `phase=ready`）。加了临时埋点后实测冷启动（页面时钟）：
  - 首次安装后：effect-start 2.34s → migrate +0.57s → SQLite open +1.12s → **schema +2.60s** → reconcile +0.09s → refreshAll +0.07s ≈ **6.8s** 才真首页；
  - 根因：`applyMobileSchema` 是 **30+ 条独立 SQL**，每条走一次 Capacitor 桥往返（设备实测单次约 68ms）⇒ **每次冷启动都重放建表/索引**，固定多花 ~2.4s。
  - 修法（`data/schema.ts` + `bridge/context.ts`）：新增 **`MOBILE_SCHEMA_VERSION` + `PRAGMA user_version` 快路径** —— 版本已到就整段跳过；顺带修了 sql.js 测试端 `pragma()` 返回 undefined 的问题（旧实现让版本恒为 0，且 prepare 不释放会锁库）。**改表/索引时记得 +1 版本号**。
  - **批量下发（用户 261021 点单「批量 SQL 才是正解」）**：`applyMobileSchema` 拆两阶段 —— ① 不依赖读状态的底表建表（含旧库 DROP）→ ② 需要 `PRAGMA table_info`/`sqlite_master`/种子的条件语句 + 小记 schema 增量；每阶段一次 `executeSet`（单事务、一次桥往返），写侧从 **28 次往返降到 2 次**。`applyQuickNotesSyncSchema` 拆出 `buildQuickNotesSyncSchemaStatements()` 供批量复用；无 `executeSet` 的测试端（sql.js）与"批内有可选语句失败"（如无 FTS5）自动退逐条兜底。单测 `schema.test.ts` 卡住"2 次 executeSet + exec 只剩版本号"。
  - 复测：第二次冷启动 `schema` **2436ms → 131ms**，整机 ready **≈6.6s → ≈2.6s**；升级后**首次**全量 DDL（v3 点位实测）**2436ms → 185ms**（两批 executeSet + 版本号）。
  - 剩余成本（稳态）：WebView 冷加载到 effect ~1.2s（debug 包/系统 WebView 启动，非我们的 JS）、`NativeSqliteDb.open` ~0.74s、`migrateSnapshot` ~0.23s、reconcile 0.15s、refreshAll 0.12s。**下一步若要再快，只能动这几个**（open 属 Capacitor 插件首次初始化，migrate 可加存储标记跳过）。
- **回归修复（用户 261021 报「打字不能看」）· 已修，待复验**：**内核的移动公式栏 = 编辑态输入面，挂在 `footer.univer-shrink-0` 里**；P3 起我们把 footer 整条 `display:none`（自绘底栏），P5 查找的 footer 例外又把其余子项显式 `display:none` ⇒ 打字进了**隐藏编辑器**，屏幕上没有任何回显，只有提交后才出现在格子里。
  - 修法（`src/mobile/mobile.css`）：footer 只在「**编辑态且有公式栏**」或「**有查找条**」时 `display:block`；footer 内**只放行** `[data-u-comp="mobile-formula-bar"]` / `[data-u-comp="mobile-find-replace-bar"]`，工作表页签条等继续隐藏。
  - **设备实测**：编辑单元格时键盘上方出现内核底部公式栏（`× ✓ ƒx <内容>`），打字**实时可见**；点「取消」后 A15 仍是 `Eeeeee`（正文未变）。
  - **顶部只读公式栏已删（用户 261021 定稿：与底部输入栏重复）**：`MobileUsheetViewer` 去掉 `.mobile-usheet-formula` 渲染与 `cellInfo` 状态，`mobile.css` 删对应 3 组规则；编辑态输入面**只保留内核移动公式栏**（阅读态不再显示地址/显示值）。
  - 排查提醒（我这次自己踩了）：**CDP `Page.captureScreenshot` 抓不到 GPU canvas**，用它截图会得到"画布整片空白"的假象；移动端截图一律 `adb exec-out screencap -p`（AGENTS §7#13/TECH-STACK §五#2）。
- **P4-1 网格视觉（移动端专用主题）· 已完成**：新增 `mobile/usheet/mobileUniverTheme.ts`（在共用 `buildUniverTheme()` 上做**最小覆盖**，桌面那份不动），`MobileUsheetViewer` 两处 theme 改用它。
  - **键位来自设备 A/B 染色实测**（把 `--lake-bg-subtle`/`--lake-border-1`/`--lake-accent` 临时染成纯红/纯蓝/纯黄逐像素采样，已还原）：表头底 = `gray.50`；当前行列头 = `mix(gray.50, primary.500, 7%)`；网格线 = `mix(gray.200, gray.900, 7%)`（engine-render）；选区边框 = `primary.600`。
  - 覆盖值：`gray.50 = #f4f5f5`、`gray.200 = #f4f4f3`（解 7% 混色方程得 243.9 ⇒ 网格线正好 #e5e5e5）、`primary.500/600 = #2f8ef4`。
  - **设备实测（emulator-5554 逐像素）**：表头 `#f4f5f5` ✓、网格线 `#e5e5e5` ✓、选区边框 `#2f8ef4` ✓（3 设备像素 = 2px 环）。
  - **已知结构性偏差**：当前行列头实测 `#e6eef5`（语雀目标 `#e7e9e8`）—— 内核这档是 7% 主色混色，主色是选区蓝就必然带蓝调；要中性灰只能把主色改成灰（会牺牲选区蓝）。**待用户拍板**，默认保持选区蓝。
  - **未验证**：多格选区的填充色（单格选区不填充；触摸拖选在本机 CDP 上没生效）。
  - 测试：`mobileUniverTheme.test.ts` 4 例（覆盖表 / 7% 混色对拍 #e5e5e5 / 不突变入参 / 单一来源）。
- **P4-2 二级选择器视觉 · 已完成**：新增 `mobile/usheet/SheetMenuBody.tsx`（**单一来源**：列表 / 圆点色板 / 图标行三种形态），`SheetPopCard` 与 `SheetMoreCard` 都改成用它 + 同一套下钻路径栈。
  - 字色 / 填充色 → **4×2 圆点色板**（色值来自 `buildColorMenu()` 的 `swatch` 字段，属数据驱动颜色，不写死视觉）；水平对齐 → **图标行**（左/中/右，lucide）；冻结 / 公式仍走列表行；字号 / 边框继续置灰。
  - **设备实测（emulator-5554）**：字体颜色弹出 8 个圆点（`getComputedStyle` 取到真实色 `rgb(229,72,77)` 等）；水平对齐弹出 3 个图标按钮（左对齐/居中对齐/右对齐）。
  - 门禁：`mobile-layers` 基线 `usheet-chrome.css` 221 → **250**（+29 = 色板 12 / 图标行 17，理由已写在基线行）；`usheetChromeModel.test.ts` 增 6 条断言（childLayout / swatch 合法性 / 图标存在）。
- **P5 边框 · 已完成**：新增 `mobile/usheet/usheetBorders.ts`（选项表 + 注入式 `applyUsheetBorder`），⋯ 卡「边框」从置灰占位变成**可用子菜单 8 项**（全部框线 / 外边框 / 内部框线 / 上 / 下 / 左 / 右 / 无框线）。
  - 内核能力 = `FRange.setBorder(type, style, color)`；`type` 是 `BorderType` 字符串值，`style` 从 `univerAPI.Enum.BorderStyleTypes.THIN` 取（**不写死数字**），颜色 `#c8ccd2` 属**文档内容色**（与 COLOR_NAMES 同口径，不写在 CSS 里）。
  - **设备实测（emulator-5554）**：⋯ → 边框 → 8 项齐全；点「全部框线」⇒ 正文新增样式 `{bd:{t,r,b,l:{s:1,cl:{rgb:"#c8ccd2"}}}}` 且落在活动格（R0C0）。
  - 测试：`usheetBorders.test.ts` 3 例（枚举合法性 / 注入式调用 / 缺 facade 明确 false）+ `usheetChromeModel` / viewer 行为用例已同步（边框不再置灰、下钻 8 项）。
- **P4-4 读态筛选 = 本机视图 · 已实现（用户 261021 定稿：只对当前设备生效、绝不写正文）**：`MobileSheetReadingBar` 只点亮「筛选」（其余四项置灰并带原因），新增 `mobile/usheet/usheetReadFilter.ts`（判据单一来源）。
  - **实现口径**：读态筛选只活在 Univer 运行时（`SHEET_FILTER_PLUGIN` plugin resource）；**所有落盘路径之前**（`capture()` 第一行 / 切回编辑态 / 卸载）用 `syncExecuteCommand("sheet.command.remove-sheet-filter")` 同步摘除 ⇒ `book.save()` 与打开时逐字节一致，不标脏、不进 S3。
  - **安全边界**：文档**本身已带筛选**时读态入口置灰并给理由（"这篇表格已有保存的筛选，回编辑态调整"）——否则"还原"会删掉文档数据。
  - **验证**：单测 `usheetReadFilter.test.ts`（无/空壳/真实筛选、坏正文）；`mobileSheetReadingBar.test.ts` 3 例（只点亮筛选、置灰理由、点击回调）；**设备实测**：该测试表带已存筛选 ⇒ 读态筛选按钮 `disabled=true` 且 title 正确（护栏路径生效）。**启用路径的端到端（新表 → 读态筛选 → 正文不变）还没跑**：现有测试表本身带筛选，需要新建一张干净表再验。
  - **两个坑（都实测踩过，写死在这里）**：① **只装 `@univerjs/find-replace` 是不够的** —— 它只是跨产品基础层（服务 + 桌面 dialog / 移动 bar），**表格还需要 `@univerjs/sheets-find-replace` 适配器**，否则插件能启动、菜单也能出现，但**搜不到任何单元格**（第一次尝试就栽在这，表现为"UI 都不出来"）；② **移动查找条挂在 Univer 自己的 `<footer>` 里**，而 P3 起我们把整条 footer 隐藏了 ⇒ 条子存在于 DOM 但宽高为 0（看起来没打开）。修复 = `src/mobile/mobile.css` 里 `.mobile-usheet footer.univer-shrink-0:has([data-u-comp="mobile-find-replace-bar"]) { display: block; }` + footer 内其余子项继续 `display:none`（当时基线 1457 → 1459；261021 删顶部只读公式栏后为 **1435**）。桌面快捷键 **Ctrl/Cmd+F 实测可用**：Univer 的快捷键带 precondition（`FIND_REPLACE_AVAILABLE` + `!EDITOR_ACTIVATED`，即**焦点必须在表格网格**），点中网格后 Cmd+F / Ctrl+F 都能打开 `find-replace-dialog`；之前判成"未绑定"是测试点错了 canvas（命中公式栏 27px 高的那个，不是 1054×645 的网格）。
- **保护 / 查找替换 的现状（下一步）**：
  - **P4-4 阅读态 5 项**：仍置灰。原因不是"没接线"——筛选/排序/冻结都要**写文档数据**（筛选条件进 `SHEET_FILTER_PLUGIN`、冻结进 `freeze`），读态不该写；要看读态筛选得先定"只读视图"的产品语义。
  - **保护**：`@univerjs/sheets` / `sheets-ui` 里**已有**保护命令（`sheet.command.add-range-protection*` 等，无需新依赖），但 261008 已把它登记为「需先立产品语义」（本地单用户场景下"保护"意味着什么没定）⇒ 本轮不动。
  - **查找替换 · 已完成（261021 P5，双端）**：`@univerjs/preset-sheets-find-replace@1.0.3`（内含基础层 `@univerjs/find-replace` + **表格适配器** `@univerjs/sheets-find-replace`）。桌面 = `UniverSheetsFindReplacePreset()`（ribbon「数据」页签出现「查找替换」，对话框 `find-replace-dialog`）；移动 = **Mobile 变体** `UniverFindReplaceMobileUIPlugin` + `UniverSheetsFindReplaceMobileUIPlugin`，入口 = ⋯ 卡「查找替换」与读态「查找」（只读浏览，不写正文）。**设备实测**：读态查找打开 `mobile-find-replace-bar`（412×52），输入「测试」→ 命中 1/1、下一个匹配可用；编辑态 ⋯ → 查找替换同样打开（412×52）。**桌面实测**：数据页签「查找替换」→ `find-replace-dialog` 打开（含 查找/替换/高级查找）。
- **未做（下一刀）**：P4-4 阅读态语义 · 保护（等产品语义）· 查找替换（自研 vs 装包待拍板）· 多格选区填充色取证。
- **状态**：**未提交 / 未推送，待用户验收**（工作树仅本批改动）。
- **证据**：`.css-audit/p5-261021/`（移动工具条 / 小数位 / 筛选 / 排序菜单 / 桌面数据页签；gitignore）。
### 261021(四) · 未分层内核 CSS 压过整个设计系统（设置面板 × 错位 + 全站字体漂移）· **已修，待用户验收**

- **用户报**：设置页「偏好设置」的关闭 × 跑到标题右边（截图），问"是不是原语改了"。
- **结论：原语没改**（`.settings-panel-large .ln-close{margin-left:auto}` 自 260904 起未动、规则仍匹配）。真因是**级联层失效**：
  `QuickNoteKernelPreview`（小记内核兜底懒 chunk，261014 起）JS `import "@dlient/lakex-doc-react/style.css"`；
  JS import 的 CSS **无法分层**，构建成独立 chunk CSS（原 `dist/assets/QuickNoteKernelPreview-*.css`，以 antd v4.24.13 开头、0 个 @layer）。
  **未分层普通声明压过所有 @layer 规则**（与特异性无关）⇒ antd base 的 `body{font-family}` 把全站字体从 MiSans 换成系统栈、
  `input,button,…{margin:0}` 把 × 的 `margin-left:auto` 归零 ⇒ × 停在标题后。生产包同病（chunk CSS 同样未分层）。
- **现场实测（dev CDP 9222）**：面板 998px、× x=159；临时 `disabled` 那条未分层表 ⇒ x=999、`margin-left` 840px、body 字体回 MiSans；恢复即复原。
  排除内核/Univer 子树后 **159 个按钮/输入框全部被它改写**（字体族、输入框字号 14→12、字色 text-3→text-1 等）。
- **触发条件**：小记卡片走过内核兜底（含表格/代码块/公式等）后 chunk 才加载 ⇒ **本次会话剩余时间**全站被压；重启且不打开这类小记时正常。
- **修法（用户 261021 点单方案 A，最小根修）**：删掉懒入口那行 JS import（桌面入口 `src/styles/index.css` 已 `@import … layer(legacy)`，dev 实测该表在 legacy 层内）；旧护栏「懒入口必须自带内核样式」**反转**为「桌面不许 JS import 内核 CSS」（`quickNoteKernelFallback.test.ts`）；`cssLayers.test.ts` 新增「vendor 内核 CSS 只能经入口分层引入」；
  新增产物护栏 `scripts/css-audit/audit-vendor-css.mjs` 并串进 `npm run check:bundle`（扫 dist：未分层裸标签 reset / 整份未分层 antd banner ⇒ exit 1；对旧产物自证过会红）。AGENTS §7#15 改为"移动端规则，桌面禁止照抄" + §7 壳层新增级联条目。
- **验证**：HMR 后 dev 页面已无未分层内核表、body 字体回 MiSans；同结构合成节点实测 × 回到右上（header 1–999、× 955–979、`margin-left:864px`）；
  产物只剩 `index-*.css` 内含内核 CSS（在 @layer 内），`QuickNoteKernelPreview-*.css` 已消失。
- **门禁**：tsc 0 · 全库 vitest **326 文件 / 2355 通过（16 skip）** · 双端构建 ✓ · ui-metrics / check:core / check:mobileui / check:bundle（含新审计）✓ · `git diff --check` ✓。
- **状态**：已提交 `a804df67`，随后经 `feat/desktop-vendor-css-layer` 合入 master（`98e9278e`）；主树已还原（并行安卓会话在途，别在主树里验这批）。

### 261021(五) · 结构护栏：第三方 CSS 自动入 @layer vendor + dev 运行时探针 · **已合并 master `98e9278e`**

> 承接 261021(四)：用户点单"1（结构性根治）+ 2（运行时探针）"，并明确**开分支做**（主树还有安卓编辑会话在途）。
> 工作树 = `/Users/admin/file/local-lake/lake-notes-electron-worktrees/vendor-css-layer`，分支基于 master + (四) 的提交。

- **① 第三方 CSS 自动入层（构建兜底）**：新增 `scripts/vendorCssLayer.ts`（Vite 插件，`enforce:"pre"`）——凡 **JS import 的第三方 CSS**（`node_modules/`、`vendor/`）自动包 `@layer vendor { … }`；`src/styles/index.css` 层序改为 **`@layer vendor, legacy, tokens, kit, shell, feature, overlay, a11y`**（vendor 最底）。两个刻意例外：内核 CSS 保持 `layer(legacy)`（视觉基线在该层、由入口 CSS `@import` 引入；插件按路径跳过）；`src/**` 自有 CSS 不动（作用域类名 + 层围栏管）。
  - 实测（构建产物）：`UniverSheetEditor-*.css` 现在以 `@layer vendor{` 开头；内核 CSS 仍只在 `index-*.css` 的 `legacy` 层内（无嵌套重复层，脚本核对）。
- **② dev 运行时探针**：`src/lib/cssLayerProbe.ts`（仅 `import.meta.env.DEV`，见 `src/main.tsx`）——启动后 + 懒 chunk 注入后扫 `document.styleSheets` 里的 `<style>` 文本，命中「未分层 + 裸标签 + reset」即 `console.warn` 并给修法；`window.__cssLayerProbe()` 返回命中列表（空 = 干净），供 e2e/手工断言。
- **③ 判据单一来源**：`src/lib/cssLayerScan.ts`；产物审计脚本由 Node 24 直接 import 该 `.ts`（类型擦除运行），dev 探针同一实现。
- **护栏**：`src/lib/cssLayerScan.test.ts`（7 例：分层忽略 / antd 现场形态 / 有 class 的 button 不算 / 声明型 @layer / keyframes / @media）× `src/lib/vendorCssLayer.test.ts`（4 例：node_modules 包层、内核跳过、src 不动、已分层不重复包）。
- **门禁**：tsc 0 · 全库 vitest **328 文件 / 2366 通过（16 skip）** · 双端构建 ✓ · ui-metrics / check:core / check:mobileui / check:bundle（含审计）✓ · `git diff --check` ✓。
- **视觉对拍（A/B，非全量）**：合成夹具 + 隔离实例（scheme / CDP 9231 / 独立 userData），`plain:1315:light` + `settings:1315:light` 两态：**HEAD 构建 vs 本分支构建逐态 0 差异**（snapdiff 0 态有差）。Univer 编辑面不在现成态集里；静态核对：分层 CSS **无任何 `.univer-*` 选择器**与 vendor 层竞争（只有我们 unlayered 的 `usheetEditor.css` 覆盖它，语义不变）⇒ 预期中性；验收时开一张表格看一眼即可。
- **顺带发现（与本批无关，登记为待办）**：`scripts/css-audit/baseline/stylesnap.json`（261018 烤）在 261019–261021 批次后**每态 +19 元素**（HEAD 构建同样 2370 vs 基线 2351）⇒ 基线陈旧；合并后应在 master 用**整份 42 态**重烤（按 README「陈旧基线」判据，别用 `--states` 覆盖）。
- **状态**：已合并 master（`98e9278e`）；主树（`local-lakex-notes`）本批未触碰，合并由该分支 FF 完成。

### 261021(三) · Android 小记搜索（全局搜索合并小记）· **待用户验收**

- **用户口径**：承接桌面的「小记搜索」，安卓端也能搜到小记。
- **数据层**：移动端 schema 新增 `quick_notes_fts(body, tags)` + `quick_notes_search_index`（与文档 `notes_fts` 分开）；`quickNotesSearch.ts` 每次搜索先按 `content_hash` 对账（只对新增/变更/删除行读 `.qnote`），再走 FTS；FTS5 不可用时降级内存过滤。
- **全局搜索**：`noteRepository.searchNotes` = 文档 + 小记（文档在前、小记≤20）；SearchSheet 增加小记徽标、占位符「搜索文档和小记」。
- **跳转**：点小记结果 → 回首页小记 tab、清标签筛选、滚到卡片并短暂高亮 **1.6s**；**不自动打开编辑器**（与桌面 261021 口径一致）。
- **未做**：Android 首页没有单独的「只搜小记」内联搜索条（移动端只有底部全局搜索入口）；如需要页面内筛选再单独立项。
- **文件**：`src/mobile/data/quickNotesSearch.ts`(+test) · `src/mobile/data/schema.ts` · `src/mobile/data/noteRepository.ts` · `src/mobile/settings/SearchSheet.tsx` · `src/mobile/MobileApp.tsx` · `src/mobile/home/HomePage.tsx` · `src/mobile/mobile.css` · `src/mobile/mobileLayers.test.ts` · `src/mobile/quickNotesSearchWiring.test.ts`。
- **门禁**：tsc 0 · 全库 vitest **325 文件 / 2354 通过（16 skip）** · 移动端 vite build ✓ · check:mobileui / check:core / `git diff --check` ✓ · mobileLayers mobile.css 1412→1414。
- **状态**：已提交 `303c53c0`（2026-10-21 02:45）并已推送 master，待用户验收。

### 261021(二) · 小记搜索：页面内只搜小记 + 全局搜索合并小记 · **待用户验收**

- **用户口径**：小记页面只搜小记；全局搜索（⌘K）连带小记一起搜。
- **数据层（小记独立 FTS）**：`QuickNotesStore` 在 `quick-notes/metadata.sqlite3` 新增 `quick_notes_fts(body, tags)` + `quick_notes_search_index`（hash 短路、text_cache/tags 供摘要），复用 `src/core/search/` 的分词 / `buildMatchExpression` / `buildSnippet`。写路径 `promoteStagedSave` / `importRemoteQuickNote` / recovery / `restoreQuickNote` 自动 reindex；delete/purge/conversion 自动 remove；启动 `ensureSearchIndex()` 按条数对账，设置页「重建索引」同时重建文档 + 小记。
- **全局合并**：IPC `search_notes` = 文档结果 + 小记结果（文档在前、小记在后，小记 ≤20 条）；`SearchResult.kind?: "note" | "quick-note"`。`SearchPanel` 增加「小记」分组标题、StickyNote 图标、小记徽标；小记结果走 `onOpenQuickNote` → App 切到小记工作区 → `QuickNotesWorkspace.revealNote(id)`（清筛选/搜索、滚动到目标并**短暂高亮**，**不自动进编辑态**——用户 261021 点单修正）。
- **小记页搜索**：列表视图保留内联搜索；卡片视图页头新增放大镜，输入条在右栏顶部；两处共用 `filterQuickNotesByQuery`，只查已加载小记的正文/预览/标签，**不会**搜文档。
- **顺带修复**：全局搜索跳转后，卡片视图 inline 编辑卡在 grid 里因 `overflow:hidden` 塌成 2px、正文被裁 ⇒ 改 `overflow: clip`（裁圆角但不把 grid item 高度压成 min-size 0）。
- **未做（明确）**：Android `SearchSheet` 仍只搜文档（下一批，数据层可复用）；全局索引只含小记正文+标签，不含图片/附件内容。
- **文件**：`electron/quickNotes.ts`(+test) · `electron/ipc/registerNotes.ts` · `electron/main.ts` · `src/core/searchTypes.ts` · `src/components/app/SearchPanel.tsx`(+test) · `src/desktop/DesktopOverlays.tsx` · `src/App.tsx` · `src/components/app/QuickNotesWorkspace.tsx` · `src/lib/native.ts` · `src/styles/components.css` · `src/styles/app/quick-notes.css` · `src/styles/cssLayers.test.ts` · `docs/QUICK-NOTES-SPEC.md`。
- **门禁**：tsc 0 · 全库 vitest **323 文件 / 2349 通过（16 skip）** · ui-metrics / check:core / check:bundle / `git diff --check` ✓ · CSS 基线 quick-notes 726 / components 367。**未跑桌面 stylesnap 全量**（有意改 UI）。
- **取证**：`.css-audit/quicknotes-search-261021/{global-search,card-search,revealed-no-edit,opened-from-search}.png`（opened-from-search 是「旧行为」截图，保留作对照；现行为见 revealed-no-edit：只高亮不编辑）。
- **状态**：已提交 `303c53c0`（2026-10-21 02:45）并已推送 master，待用户验收。

### 261021(一) · 桌面小记页对齐语雀（类型筛选 / 标签条右移 / 写作卡缩高）· **待用户验收**

- **用户点单**（附四张截图）：① 写作卡（图1红框）整体缩小、下边留白；② 标签筛选条从左侧移到右侧，不占写作区；③ 整体复刻 https://www.yuque.com/dashboard/notes；④ 加类型筛选（图片等）。
- **布局**：写作卡高度改为 `clamp(300px, calc(100% - 180px), 560px)`（不再 `flex:1` 拉满左列），长内容卡内滚动，下方留白；其余版式/列表视图不变。
- **标签条**：从页头通栏移到右侧列表列（卡片视图=右栏列表上方；列表视图=索引列顶部）。对齐语雀：**去掉「全部」chip**（再点已选 chip 取消）、计数改 `测试111 (1)` 括号格式、chip 30px/14px（只作用于筛选条；卡片内 chip 仍紧凑）；类型筛选生效时整条隐藏。
- **类型筛选（新）**：右侧头部漏斗按钮 + 菜单，菜单项 **小记 / 图片 / 附件** + 分隔线 + **批量操作**（复用既有多选态）；默认勾「小记」。判据在 core `quickNoteTypeFilter.ts`：只认 `content.images` 的 MIME（图片白名单 vs 非图片附件），不解析正文；图片/附件可重叠。
- **互斥语义（对齐语雀实测）**：类型筛选与标签筛选不叠加 —— 任何类型切换都清空标签筛选并隐藏标签条；切回「小记」回到全量。
- **空态**：筛选无结果 = `未能找到相关小记 / 切换筛选条件后再试。`（对齐语雀文案）。
- **发布行精简（261021 用户点单）**：去掉「按 ⌘ Enter 发布」「可拖入或粘贴图片」两条说明，写作卡动作行只留「小记一下 / 保存并同步 / 取消」；对应两条 CSS（fullscreen 隐藏提示 / 提示分隔线）一并删除。
- **列表视图对齐语雀（261021 追加）**：列表视图不再有整行页头 —— **左栏顶部 = 标题 / 版式切换 / 新建小记**（新建从页头右侧移到左栏，紧跟版式切换），**右栏编辑区从内容顶部开始**（编辑工具栏与左栏头同高对齐）。左栏下方才是**三件套 [标签 ▾] [搜索] [⋯]**，不再平铺标签 chip、不再显示「N 条/排序」。`标签 ▾` = 垂直菜单（全部 / 各标签带 `(n)` / 无标签；选中后 trigger 显示标签名；类型筛选生效时隐藏）。搜索 = 点击放大镜替换标签位为输入框（Enter 过滤、× 清空、Esc 收起；core `quickNoteSearch.ts` 只查纯文本/预览/标签）。`⋯` = 类型（小记/图片/附件）+ 排序（现有四档）+ 批量操作。卡片视图仍是页头条数/筛选/排序 + 右侧平铺标签（语雀卡片视图同款）。切换版式会收起所有浮层。
- **回归修复（用户验收发现）**：timeline 改成滚动容器后，卡片左侧 `left:-30px` 的批量勾选框被 `overflow:auto` 裁掉 ⇒「批量态没了」。修法 = 槽位宽度单一来源 `--quick-notes-gutter`，timeline 用负 margin + 同值 padding 把槽位包进滚动容器；勾选框 left 同步用该变量（窄窗 22px 也不裁）。护栏 `quickNotesView.test.ts` 新增「批量勾选框槽位」。
- **未做（明确）**：书签 / 来自微信 / 来自插件 / 分享中 / 已归档（本产品无对应数据源，不放入死选项）；标签下拉未做「标签管理」；写作卡内标签/按钮位置未改（按图1红框只缩卡）；移动端未动。
- **文件**：`src/components/app/QuickNotesWorkspace.tsx` · `src/core/quickNoteTypeFilter.ts`(+test) · `src/core/quickNoteSearch.ts`(+test) · `src/styles/app/quick-notes.css` · `src/styles/cssLayers.test.ts`（当前基线 676→726，含 261021(二) 搜索定位高亮新增；本批 UI 部分 +48）· `src/features/quickNotes/quickNotesView.test.ts` · `docs/QUICK-NOTES-SPEC.md`。
- **门禁（当前工作树）**：tsc 0 · 全库 vitest **323 文件 / 2349 通过（16 skip）** · ui-metrics / check:core / check:bundle / `git diff --check` ✓。**未跑桌面 stylesnap 全量/重烤**（本轮是有意改视觉）；验收后再按受影响态重烤基线。
- **状态**：已提交 `303c53c0`（2026-10-21 02:45）并已推送 master，待用户验收。
- **取证**：`.css-audit/yuque-quicknotes-262021/SPEC.md` + 41 张截图；列表视图 `list-view/SPEC.md` + 30 张截图（EDGE 只读，session 已 stop）。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 44 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `local-lakex-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交；**260928 多维表批次已由用户明确授权「提交代码」（仅提交、未推送）**）。移动端另有铁律见 **§8.0**。

## 3. 待办与已知问题（上线后 backlog）

> **261016 代码 review 的待办**见 `AGENTS.md` **§11 交接清单**：**全部结案（261017）**——C3-2 / C3-5 / C1-6 / C4-1 / C5-4 / Q3 / C1-5 均完成；D2 定稿不做（移动端只支持虚拟托管）、D5 真云验证后已修；无待决策项（D3/D7 仅记录）。
> **261017 复核补充的 3 项低优先遗留**（详见 review §11.7）：① **C4-1** 两处 `!important`「验证后删」已被 Q2 允许清单收编 ⇒ 是否还要验证删除待裁；② **C5-4** 同名令牌取值差异表未建（自动生成即可）；③ **桌面 `stylesnap` 基线**已按 261017 全量重烤（旧基线在 261014 后未更新且实测不可复现，见 §0）。

> 多维表专项已收口；以下是专项之外真正保留的低优先项。

1. ~~**同步 warning 结构化**~~ **已完成（261007）**：core 直接产出 `SyncWarning`（`{kind, noteId?, title?, filename?, message}`，单一来源 `src/lib/types.ts`），控制器不再正则反解；同步浮窗展示「被跳过」列表 + 点击打开文档；`AssetMissingError` 结构化携带 `filename`。**同步语义未变**（仅报告契约）。
2. ~~**画板 AI 助手**~~ **已完成（261003）**：接的就是内核 `ai.generate` 钩子，转主进程既有 AI 通道（Key 不出主进程、不新增 IPC），只读不给入口。见 git 历史。仍不做的是**文内文本绘图卡片**（`TextToDiagram`，内核那支绿色徽标无注入点）。
3. ~~**UI 低优先：设计词表继续裁剪**~~ **已完成（261007）**：全仓零引用令牌 17 → 裁掉 **5 个被取代的 `--lake-media-*`**（`surface`/`btn`/`btn-hover`/`on-faint`/`on-dim`，消费者实际用 `scrim`/`toolbar`/`on`/`on-soft`/`-hover-2`）；其余 12 个按口径保留（尺度 ramp：`space-giant`/`motion-instant`/`motion-slow`/`ease-emphasized`/`ease-exit`/`font-weight-bold`；层序阶梯：`z-base`/`z-sticky` + 被护栏/文档引用的 `z-block-handle`/`z-overlay-lightbox`/`z-scrim`/`z-toast`）。口径见 AGENTS §3#14 与 `themes/base.css`。画板 `Wt` 已修复（`6b901bb`）；目录树窗口化不做。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. ~~**搜索整体重构**~~ **已完成**（`984ccbc` 统一 FTS5+unicode61+CJK 单字预分词+增量账本、`d5ed6c0` 移动端纯文本源+拉丁前缀+多命中定位、`4fea72b` 设置页重建索引、`820305b` 标题-only upsert 保正文索引）：桌面/移动共享 `src/core/search/`。**剩余为可选增强（非缺陷）**：移动端索引源改 `getDocument("text/plain")`；拉丁子串检索（加 3-gram 列）；~~小记搜索（二期）~~ **已接入（261021）**：桌面小记页本地筛选 + 桌面全局独立 FTS；**Android 全局 SearchSheet 也已合并小记**（独立 FTS + 按需对账，点击只定位高亮）；移动端首页暂无单独内联小记搜索条；命中定位仍是 DOM 启发式（lakex 无公开查找 API）。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7c. ~~移动端 SecretStore 不跨重启 ⇒ S3 密钥丢失~~ **已修（261009）**：
   - **根因（实测澄清过一版）**：不是"整个 WebView 存储都不持久"——同批实验里 **localStorage 跨重启仍在**，而 **IndexedDB 被重建为空**
     （重启后探针库的 `onupgradeneeded` 再次触发；磁盘上 `app_webview/Default/IndexedDB/http_localhost_0.indexeddb.leveldb` 还在）。
     旧实现（`src/mobile/native/secretStore.ts`）把密文放 IndexedDB ⇒ 重启后 `getS3Settings().secretAccessKey` 长度 0，
     所有 S3 操作报 `The request signature we calculated does not match the signature you provided`。
   - **修法（保留原设计的降级语义，只换持久层）**：密文改存 **localStorage**（键 `local-lakex-notes-mobile.secret.*`，仍是 WebCrypto AES-GCM 密文、**不是明文**）；
     并在 `read` 时**一次性兼容迁移**旧 IDB 值（读到就搬进 localStorage 并清旧条目）。
   - **顺带治理报错**：`bridge.ts` 在建 S3 客户端处加 `assertS3Credentials()`（单一来源，同步/测连通/上传三条路径共用）：
     密钥缺失时给「请到「设置 → 同步设置」重新填写 Access Key / Secret Key」，不再让请求去报签名错。
   - **护栏**：新增 `src/mobile/native/secretStore.test.ts`（4 例：往返、**落盘是密文**、**模拟重启仍可读**、缺失/删除返回 null）；
     `bridgeCloudState.test.ts` 增 1 例（密钥缺失 ⇒ 提示 + 不发请求）。两个既有测试的 `secretStore` mock 改成"已配置 S3"的真值语义。
   - **设备验收（AVD，决定性场景）**：保存 → 当场 `skLen 40` / 连通 OK → `am force-stop` 重启 → **`skLen 40` / 连通 OK / 同步成功**（原来必报签名错的场景）；
     空密钥档实测两条路径都回「S3 密钥缺失…请到「设置 → 同步设置」重新填写」且**不发请求**；落盘的 localStorage 值不含明文。
   - **遗留**：仍是"非硬件级安全"的降级实现（密钥材料固定派生、WebView 内存可读）——`secretStore.ts` 头注释与 §17.5 的"正式版换 Android Keystore-backed"未变，属后续项。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。
9. **多标签切换时内核工具条 1~4 帧绘制空帧（261008 记录，未修）**：非活动宿主用 `visibility: hidden` 隐藏 ⇒ 浏览器**丢弃其绘制图层**，切回来整棵子树重新栅格化，内核工具条（子树最重）最后画完。**实测口径**：`.ne-ui` 切换瞬间已是 `opacity:1 / visibility:visible / transition-duration:0s`（不是 CSS 淡入）；标签高亮与可见宿主同帧、`--lake-editor-top`/`.tab-panels` 顶边不跳（rAF 逐帧 0 错位）。**方案 2（宿主 `will-change: opacity`）实测无效、已撤**。可行方向 = 方案 1：非活动宿主改 `opacity: 0` + `inert` + `pointer-events: none`（不再丢层），代价是非活动编辑器保持绘制，需按 10 万文档量级评估。**别再无证据试提层类改动**。 **261012 复测（用户定：暂不做，记录备查）**：用 CDP `Page.startScreencast` 抓**真实帧流**逐帧量工具条区域亮度标准差（15.55=富文本工具条 / 11.07=多维表工具条 / **2.29≈纯背景=空帧**）：切到「富文本」类重工具条 ⇒ **2 帧空窗（@262ms，本机 `--disable-gpu` ~7fps；60fps 真机即 §3#9 的 1~4 帧）**；切到多维表（工具条较轻）⇒ 0 帧。**根因坐实**：`tabs.css` 非活动宿主的 `visibility:hidden` 丢绘制图层 ⇒ 切回重栅格化。**修法实测**：① **F1 = 非活动宿主改 `visibility:visible` + `opacity:0`（保留层）⇒ 空帧 2 → 0**，6 标签实测空闲帧间隔 p50 17ms / p90 17–18ms、JS 堆 +1MB（**无可测代价**）；但 `visibility:hidden` 现在免费承担「退出 a11y 树 + 退出 Tab 序」，改 F1 必须补 **`inert`**（实测非活动宿主会多出 **161 个可聚焦元素**），落点 = `tabs.css` 1 行 + 4 个宿主各 1 行（`EditorTab`/`UniverSheetEditor`/`BitableEditor`/`BoardEditor` 的 `data-active`/`data-pane-visible` 旁）。② F2（工具条 `will-change:transform` 层提升）**实测仍 2 帧、无效**（与 261008 的 `will-change:opacity` 同结论）。③ **决定：暂不做**（用户 261012：闪烁可接受；F1 虽仅 5 行，但动的是 261005 统一过的隐藏机制，需逐项回归 fit-width 表格 / 画板滚动 / 工具条残留 + 焦点序 + 多标签性能）。

10. **样式大统一（260930 审计，三批已完成；③⑤ 已记录、暂缓不做的理由见下）**：用户要求「找出散落各处的相同操作模式，做成正式原语统一起来」。
    **已完成**（详见 AGENTS §3#14 的单一来源清单与 git 历史）：
    ① **菜单项** `.ln-menu__item`（顶栏下拉 / 右键菜单 / ＋菜单 / 多维表列菜单，legacy 选择器一并收编，overlay −29 条）；
    ② **图标按钮** `.ln-iconbtn`（新增 `--compact` 22×22 / `--accent` 主色 hover 两个正式变体；目录栏 12 处 + 目录行动作 + 多维表 6 处，chrome −39 / bitableEditor −63 条）；
    ③ **单行省略** `.ln-ellipsis`（新工具类，27 个调用点；**flex/宽度属于布局、仍留业务规则**）；
    ④ **选中行** 三元组收编进 `.ln-row.is-selected`（页签溢出菜单行 / 设置左导航，overlay 菜单 hover 随①）；
    ⑤ **图片填满裁切** `.ln-imgfill`（4 处；顺带删掉死代码 `.mobile-qn-img` 3 条）；
    ⑥ **输入框** 关联选择器搜索框 → `.ln-input__field`；面板头（回收站/历史）合并；卡片标题随③收编。
    **明确暂缓（已记录，不做）**：
    - **顶栏 `.toolbar__item` 并进 `.ln-btn`**：两者只差 1px 高与 padding（26/8 vs 27/11），但顶栏几何曾被 `--shell-*`/面包屑/窄窗 media 引用 ⇒ 原判「不抵回归风险」。
      **261012 实测（运行时候选实验，未改仓库）**：把 `.ln-btn` 的盒子（27px / `0 11px` / 1px 透明边 / 字重 500）注入 `.toolbar__item` 后，**1315 / 1060 / 760 三宽结果一致，且只动顶栏按钮自身**：
      首按钮 95×26 → **106×27**、右侧两枚图标钮 31×26 → **39×27**（整组左移 16px）、顶栏按钮高 26 → 27；**顶栏之外 0 位移**（`.top-menu` / 面包屑 / `.tab-bar` / `.tab-panels` / 状态栏几何全未变）。
      ⇒ 风险面比原记录小得多（只在顶栏内），但代价是**顶栏观感变化**（用户 260914 定的构图），收益仍是"少 ~10 条声明 + 顶栏按钮归一到 kit"。
      **261012 决定：维持不做**（构图冻结优先；若哪天要动顶栏，按上面三个宽度的数字直接做即可，无需再测）。
    - **toast 合一**（原记录写"三套 = `.ln-toast`/`.b3-snackbar`/`.mobile-toast`"，**261012 核实后已过期**）：`.ln-toast` **261006 就作为死原语删掉了**（`kit.css:236-238` 有留痕、需要时从 git 取回）；
      `.b3-snackbar`（`compat.css:163-177`）**全仓无 tsx 施加**，是思源契约的失效残留。
      **真正"各写一套"的是 4 处瞬时提示**：桌面 `.sync-toast`（chrome.css 20 条 / `SyncToast.tsx`，绑同步进度条+四态）、`.quick-notes-toast`（4 条 / 撤销按钮）、
      `.document-notice-toast`（8 条 / 嵌在**状态栏布局**里）、移动端 `.mobile-toast`+`-host`（8 条 / `mobile/ui/Toasts.tsx`+`toastBus`）。
      合一的真正含义 = 建一个 kit 层 toast 原语（表面/圆角/阴影/进出动效/错误态/关闭/可带动作），四处只留业务绑定。
      **仍暂缓**：验收难（瞬时浮层现有装置拍不到 ⇒ 要固定 `timeout=0` 造常驻态 + 计算值对拍 + 设备截图）、跨端（移动端那份属移动端写域）。
    - ~~**`.protyle-breadcrumb__item` / `.quick-note-index-main`**：审计把它们和输入框归为相似，收编前先定性~~ **261012 已定性（结案）**：
      两者都挂在 `<button>` 上、都是**行内可点击文本条目**，**既不是「行」也不是「输入框」** ——
      `.protyle-breadcrumb__item`（`EditorTab.tsx:1048/1057`）= 面包屑链接（`inline-flex / padding 0 / 无 hover 底 / text-overflow:clip`，产品既有决策）；
      `.quick-note-index-main`（`QuickNotesWorkspace.tsx:738`）= **列表行内的主区按钮**（行外壳是 `.quick-note-index-row`，它才是潜在的 `.ln-row` 候选）。
      ⇒ **不并入** `.ln-row` / `.ln-input`（审计的"像输入框"是误判）；今后审计再报到这两条，按此结案，别再立项。
    **工具（已入库）**：`scripts/css-audit/audit-lookalike.mjs`（找「像原语却没复用」，260930 命中 29 → 16）、`scripts/css-audit/audit-primitives.mjs`（跨文件规则体重复族，46 → 39）。改完样式重跑对比即可；判定只认这两份数据 + 实机几何，不认「看着像」。

11. ~~**多维表Grid行窗口接入（5000×20）**~~ **已完成主树整合（261014用户确认亚秒即可接受）**：主Grid/关联选择器共用窗口，首开0.31–0.38s/重开0.17–0.22s；全库1945例与23包检查通过、正常关表回收。契约`docs/BITABLE-VIEWPORT.md`，最新§0与`.css-audit/bitable-integration-261014/RESULTS.md`为当前状态。**发布前待补**：低内存/长时/真实大图高扇出关联/完整发布矩阵；精细毫秒级尾延迟继续观察，不为33/50ms参考目标重新阻止接入。旧AR04的12.4–24.8s/百万格全量DOM数据只是历史，不再描述当前实现。

12. **非多维表审计遗留（260930 会话决定）**：
    - **F16 安卓整轮网络同步持本地写队列 —— 已实测（261009，用户授权用 dev 前缀 `local-lakex-notes-dev1` 直连 S3）**：结论 **立项** ⇒ **已修复（261010，见 §0 本批）**：写域/维护域分离 + 判据单一来源 + I2 守卫；**弱网实测已收尾（261010）：同步 59.3s 期间写等待 32ms（旧 152.0s），见 §0**。
  - **量法**：移动端调试契约 `window.lakeNative`（`saveNote` / `syncNow`）+ 页内 `performance.now()` —— 先起 `syncNow()`，等 150–300ms 让同步进入队列，再发一次本地写，量这次写完成耗时；同法先量"无同步时"的基线写。
  - **数据**（AVD lake_mobile；弱网档 = 模拟器 `-netdelay gprs -netspeed gprs`，≈80kbps / 500ms RTT）：

    | 库 | 网络 | 同步整轮 | **同步中写等待** | 基线写 |
    | --- | --- | --- | --- | --- |
    | 7 篇 / 全量 8 对象 | 正常 | 701ms | 551ms | 32ms |
    | 7 篇 / 增量 1 对象 | 正常 | 434–488ms | 283–332ms | 32ms |
    | 68 篇 / 全量 61 对象 | 正常 | 1828ms | 1628ms | 32ms |
    | **68 篇 / 全量 40 对象** | **弱网** | **152.3s** | **152.0s** | — |

  - **判定**（按之前定的口径：P95 数百毫秒 ⇒ 不做；上千毫秒或分钟级窗口 ⇒ 立项）：弱网下本地写要等 **~2.5 分钟**，且同一条队列上还有建/改/移/删笔记本、回收站/恢复/彻底删除、历史、GC ⇒ **立项**。
  - **方案（下一批）**：网络阶段不占主队列 + DB 片段内短锁；先跑跨端 sync 对拍（桌面/移动同序列改动结果一致）；并补「排队中的写尚未落盘 → App 被杀就丢」的兜底（移动端普通文档没有草稿位，小记有草稿位）。
  - **测过的现状（261009）**：移动端 `src/mobile/bridge.ts` 用一条 `KeyedAsyncQueue`（key 固定 `main`）把**整轮同步（含全部网络往返）**与本地写**完全互斥**；桌面**没有**该问题（维护锁只包 整轮同步 / 数据库备份 / 定期 GC 对账）。
  - **为什么思源没有（读 `siyuan-master`）**：① 文件是真相、DB 只是索引（`IndexNodeQueue` 入队 + 后台 `DatabaseIndexCommit` 攒批 + `index.queue` 落盘可恢复）⇒ 保存不等数据库；② 同步是 `dejavu` 文件/快照级，流程里是 `FlushTxQueue()` 排空而非持有本地写队列，`syncLock` 只防并发同步；③ 桌面与安卓共用同一个 Go 内核（APK 里跑内核 HTTP 服务，`KernelService` 保活）⇒ 一套并发模型两端通用。
  - **我们的差异（结论）**：仿的是前端壳 + 数据逻辑，没复制也无法复制「单一内核服务两端」的运行形态；移动端并发边界是自建的，桌面补过、移动端漏了 F16 —— 不是路线错，是两套持久化模型的一处已知欠账。
  - **测量留痕**：dev 前缀下多上传了约 70 个探针对象（`F16 探针 N`，可随时删）；一次性驱动脚本未入库，量法与数字已回填本条。

13. **AI 多轮对话记忆只保留最近 40 条（用户 261005 决定：先文档化、不做长期记忆）**：主进程 `electron/ai/aiChatMessages.ts` 的 `assertMessages` 只把**最近 40 条消息**发给供应商（更早的上下文丢弃；另有 `AI_MAX_TOTAL_CHARS=200000` 上限），面板关闭即清空、**无长期 / 跨会话记忆**，设置页「AI → 说明」已如实标注。若要长期记忆 / 摘要压缩 / 跨会话共享，需单独立项（涉及存储与成本，超出笔记软件当前范围）。
15. **表格（sheet）vs 云端 lake 语雀表格：体验对齐调研（261008，实机体验 Edge + 云端原文；按收益/代价排序）**
    > 体验地址：`https://todoo.yuque.com/ex813k/stock/kif3cv50apeg52za`（云端 edit 态 + 阅读态都走过一遍）。
    > 已在云端核实到的能力清单：工具栏 = 保存态/卡片 | 撤销重做 | 格式刷·清除格式 | **常规▾** | **小数位 ±** | 字号▾ | B I S U |
    > **字色▾ / 背景色▾（分体：点图标=上次颜色、点三角=选色盘）** | 边框▾ | 水平对齐▾ | 垂直对齐▾ | 换行 | 合并 | 筛选▾ | 排序▾ | 视图▾ | 更多（第二行平铺：链接 / 垂直对齐 / 换行 / 小数位 / 图片 / 保护 / 查找）；
    > **公式栏常驻（名称框 `C11` + 公式输入）**；单元格右键 = 剪切⌘X / 复制⌘C / 粘贴⌘V / **选择性粘贴** / 插入内容（子菜单：上下插行、左右插列）/ **删除第 N 行** / **删除第 E 列** / 清除 / **添加备注**；
    > 其余入口（更多/条件格式/公式库）：复选框、下拉列表、图片、链接⌘K、附件、备注、**图表**、公式（SUM/AVERAGE/COUNT/MAX/MIN + 数学·统计·财务·工程·逻辑·日期与时间·查找和引用·数据库·其他·全部）、
    > 数字格式（常规/文本/数字/百分比/货币/日期/时间/日期时间）、字号 12~48、对齐/溢出·切断·换行、升/降序、**条件格式（突出显示单元格/数据条/新建·管理·清除规则）**、
    > **冻结（至 N 行 / C 列 / 行列）**、**保护（所选行/列/单元格 + 管理保护范围）**。阅读态工具条 = 撤销重做·刷新 | 筛选▾ | 排序▾ | 视图 | 定位。
    - **P0（261008 已逐条处理完）**：① 公式栏 —— **用户决定保持隐藏、不做**（当初是他主动关的，`showFormulaBar={false}`）；
      ② **小数位 ± 已完成**（内核这版是死键 ⇒ 自建两个 custom item + `adjustDecimals`；`常规▾` 我们本来就有 = 工具栏「自动」下拉）；
      ③ 单元格右键三项**核查结论（都不做）**：剪切 —— ⌘X 内核**已支持**、但没有 `handleCut`（加条目得自实现「复制+清空」）；
      选择性粘贴 —— ~~内核完全没有 `pasteSpecial`~~ **261022 复核：本构建右键菜单已自带「选择性复制 / 选择性粘贴」子菜单（旧记录过期）**；添加备注 —— 右键菜单未见批注入口（需装 `sheets-note` / `sheets-thread-comment` 才有）；
      ④ 删除项文案带目标 —— **已做后撤销（用户 261008）**，内核恢复原样。
    - **P1（中等代价，价值明确）**：
      ⑤ **条件格式**（突出显示单元格 / 数据条 / 规则管理）—— **未做**：没装 `@univerjs/sheets-conditional-formatting`（Univer 独立可选包），桌面/移动端都无入口；
      ⑥ **数据验证**（下拉列表 / 复选框）—— **未做**：没装 `sheets-data-validation`；
      ⑦ ~~公式库完整版（Σ 按类别，现只有 5 个快捷函数）~~ ✅ **桌面已具备（261022 实测）**：Univer preset 自带「公式」页签，8 类函数（常用/财务/逻辑/文本/日期与时间/查找与引用/数学与三角函数/统计）；**移动端仍只有 5 个快捷函数**（`USHEET_QUICK_FORMULAS`）。⑤⑥ 的接线要等 Univer 升级单独立项（同批装包 + playbook）。
    - **P2（暂不做，需先立产品语义）**：⑧ **图表**（内核这版 react 单元格右键不认 `chart` key，要另做入口）；⑨ **表格内保护**（我们只有文档级锁定 `EditorTab.locked`，云端是行/列/单元格级保护，语义不同，要先定稿）；⑩ 分列 / 截图（低频）。
    - 对齐良好、无需改的：B/I/S/U、字号、字色/背景色（含**分体交互 + 记忆上次颜色**，刚对齐）、对齐/换行、边框、合并、筛选/排序（工具栏）、冻结、查找、格式刷/清除格式、自动行高、单元格图片、链接、批注、缩放、工作表标签菜单。
    - ⚠️ 改动口径不变：上述都要**先证真实价值**（AGENTS §3#17）；涉及内核能力的一律按 §2 三级检索（官方文档 → LAKEX-CONTRACT → vendor/补丁），别凭云端 UI 猜 API。

16. **大表格粘进「文档」会卡死（内核级，261008 用户实测；A+B 兜底，C 调研中）**：
    - **现象**：从本应用的「表格」文档复制 ~5500 行数据，粘进**文档** ⇒ 整个窗口卡死；用户实测**同一份内容在思源约 3s 完成**，
      而**云端语雀 Lake 同样卡死** ⇒ 判定为**闭源 lakex 内核的表格卡片问题**（不是我们这层能根治的）。
    - **本机实测**（[scripts/table-paste-stress.mjs](scripts/table-paste-stress.mjs)，合成 paste + 真实 text/html，等价真实粘贴）：

      | 粘贴内容（6 列） | 主线程**同步**阻塞 | DOM 节点 | 产物 |
      | --- | --- | --- | --- |
      | 1000 行 | 最大长任务 1,405ms | 43,400 | `ne-table-hole`（1001 行 / 6006 格） |
      | **5500 行** | **30.7s** | **269,108**（单个 render unit **225,612**） | `ne-table-hole`（5501 行 / 33,006 格） |

      5.5× 行数 → ~22× 时间（≈n^1.9，超线性）；CPU profile 34.6s 里 `value` 16.7s / `get` 5.9s / `e` 3.8s / **GC 2.8s**。
      我们的粘贴预处理（`clipboardHtml.ts` 的 `upgradePastedHtml`）只花 **146ms** ⇒ 不背锅。
      根因：**Lake 表格卡片整表全量渲染 DOM、没有虚拟化**，且粘贴在**一个同步任务**里建模型 + 渲染。
    - ✅ **A+B 已交付（261008）**：见 §0「大表格粘贴 A+B 兜底」——实测同步阻塞 **30,743ms → 2ms**，提示明确、剪贴板保留、一键存为表格文档并插入「文档引用」卡。以下为原始方案记录（保留作背景）。
    - **A（护栏，兜底方案）**：在 `clipboardHtml.ts`（本来就在处理每次 HTML 粘贴）量行列数/字节数，超阈值时不按表格卡片粘贴，
      并**明确提示**（"表格过大 N 行 × M 列，为避免卡死未直接粘贴；请改用表格文档或分批粘贴"）——**剪贴板内容保留、绝不静默丢弃**。
      阈值**已定稿为 ≤1000 行 / ≤5000 格**（用户 261008 上调；旧值 500/3000）。**边界实测**（隔离实例 + 合成 HTML，
      量的是 `dispatchEvent` 的同步耗时 = 主线程阻塞）：**1000 行 × 5 列 = 5000 格 → 1.93s / DOM +2.65 万**；
      100 行 × 50 列 = 5000 格 → 1.41s；旧上限 500 行 × 6 列（3000 格）→ 0.79s；**超限被护栏拦下时同步耗时 ≤1ms**（内核完全不接）。
    - **B（体验更好）**：超阈值时**自动落成「表格」文档**（表格侧性能已修好：共享 canvas + 400ms 静默窗口），
      文档里留引用/链接。需先定交互语义（落哪个笔记本、命名、是否跳转）。
    - **C（内核侧分批/异步粘贴）—— 261008 调研结论：本项目不做**（三条实证）：
      ① **既有的虚拟渲染帮不上**：文档级 `virtualRendering` 是**按 render unit（`ne-role="render-unit"`）**做虚拟化的
         （见 `src/components/BlockHoverHandle/BlockHoverHandle.tsx` 的判定），而一张粘贴进来的表格**整体就是单个 render unit**
         （实测一个 `ne-table-hole` = 225,612 个后代节点）⇒ 单测期内无法只渲染视口片段。
      ② **没有可用的增量插入口**：表格卡片的模型/渲染实现只在**闭源预构建 bundle** 里（`vendor/lakex-doc-react/src` 只有
         bookmark / imageToolbar 等少数插件源码），且 `.d.ts` 里没有 `insertTableRow`/`appendRow` 一类 API ⇒ 宿主侧
         「分 N 批往同一张卡里追加行、批间让出主线程」这条路**没有稳定接口**，只能反编译卡内部模型（高风险、随内核升级即失效）。
      ③ **上游同样卡**：用户实测同一内容在思源 ~3s、而**云端语雀 Lake 也卡死** ⇒ 是内核层面的已知限制，不是我们这层的实现问题。
      ⇒ 结论：**按 A+B 兜底**（护栏 + 大表自动落成「表格」文档），不改 vendor 的表格渲染。
    - **复现**：起隔离实例后 `SIZES=1000,5500 LAKE_CDP_PORT=9222 node scripts/table-paste-stress.mjs`（脚本头注释有完整启动命令）。

17. **表格（usheet / Univer）的取舍与已定「不做」（261010，别再提）**：① **「开始」工具收窄**——隐藏旧工具（字体/粘贴/百分比/货币/快捷键面板）**就是为了让原先挤在「更多」里的工具自动补位出来**，宽度变短不是目标 ⇒ **不给白名单**；② **canonical 快照挪到空闲时段**——只对大表有意义（40 万格约 130ms），50×16 规模无感，暂不做；③ **移动端与桌面抽公共 runtime**——差异是实质性的（只读闸门 / 焦点 / 资源 URL 带 token / 无工具条），抽出来只会变参数化分支；④ **单实例多 workbook 共享**——先保证不串台；⑤ 依赖侧冗余清理、运行时正文兼容层——不做（AGENTS §3#18 / §3#7）。升级内核依赖一律走 **docs/USHEET-UPGRADE.md**（静态护栏 `univerContract.test.ts` + 运行时探针 `scripts/usheet-kernel-probes.mjs`），**不要 npm update**。

18. **移动端内嵌画板卡「能插能看、但编辑不了」（261012 设备实测定性；5 项画图插入项因此置灰占位）**：
    内核侧其实**是可编辑的**（编辑态走 `editorComponent` → `DrawingBoardEditor` + `DrawnixBoardCore` **不传 readOnly**，与桌面同一套、同一懒加载 chunk），问题在移动端布局与手势：
    - **工具条容器盖住画布**：`@media (width<=720px)` 的 `.lakex-drawnix-core .draw-toolbar{top:auto;bottom:14px}` 与 `.drawnix--mobile .draw-toolbar{top:20px}` 叠加 ⇒ `top:20 + bottom:14` 把容器**上下拉满**（实测 351×524、`pointer-events:auto`、`z-index:20`）；`elementFromPoint` 在卡内任意点都命中它 ⇒ 画布 `svg` 收不到指针事件（鼠标/触摸都一样）。桌面是左侧窄条（36×288）所以没暴露。把容器临时压到 44px + `pointer-events:none` 后命中即回到 `svg` ⇒ 覆盖层是直接原因。
    - **触摸手势**：画布 `touch-action:auto`（无 `none`）⇒ 手指拖拽被判成滚动、`pointercancel`；且壳层「左滑开大纲 / 右滑开目录」会抢横滑（实测触摸拖拽把左抽屉滑开）。
    - **解禁需要两处定点改动**（内核 CSS + 壳层手势，单独立项；按 AGENTS §3#17 先证价值）：① 移动端让 `.draw-toolbar` 容器不拉伸 + 容器放行指针；② 画布 `touch-action:none`（至少工具激活时）+ 卡片区域内拖拽豁免抽屉手势。
    - 详录见 `docs/LAKEX-CONTRACT.md` §5.31。
19. **移动端 UI 重设计（皮肤 + 页内交互形态；信息架构冻结）—— 261012 立项，用户已确认，可开工**：
    - **口径**：保留当前布局（= 信息架构 / 页面层级不动：小记·知识库 第一层 → 笔记 第二层…）；**页内交互形态与动效可以重做**（弹层居中 Dialog→底部 Sheet 这类**允许**）；移动端**自己一套设计与原语**，技术方案与桌面同构；**只共享必要逻辑**，不共享样式/UI。
    - **执行方案（唯一）**：`MOBILE-DESIGN.md` —— 三层范围 · **IA 冻结清单** · 归属基线 · `mb-*` 前缀 · **皮肤取值表**（39 个语雀语义槽映射 + 几何档位 + 偏离项 + 交互形态清单）· **P0–P7 任务书** · 护栏与验收。
    - **长期判据**：`docs/MOBILE-TECH-STACK.md` §九（三层拆解 + 不变量）；**逐项归属基线**：`MOBILE-TECH-STACK.md`（桌面产出，**已评审通过，含 4 处修改**）。
    - **关键决策已定**：类名前缀 **`mb-*`**（不用 `md-*`：与 `.md-preview` 撞族）· 令牌名沿用 `--lake-*` 但**取值由移动端 `src/mobile/theme/**` 定义** · **只有 `+` 号用绿 `#00B96B`**，其余强调色走主题色（**对语雀的显式偏离项**）· 深色做、暖色暂不做。
    - **起点 = P0 立护栏**（`mobileIndependence.test.ts` + `mobileLayers.test.ts`，**允许红、基线只许降**）。
    - **参考仓**：`/Users/admin/file/local-lake/yuque-re/`（语雀逆向证据仓，**取值与交互形态参考**，非布局基准；产物**不要**复制进本仓库）。
20. ~~**桌面端彻底摆脱思源类名契约（用户 261012 登记为待办；移动端已完成，桌面未做）**~~ ✅ **已完成（261022）**：桌面 16 文件 / 27 个类名全部改走自有 `ln-*`（按钮/输入/开关迁 kit 原语，列表/标签/工具类在 compat.css）；全仓产品代码 `.b3-*`/`fn__*` 只剩历史注释与许可说明；AGPL-3.0 署名保留（设置页「关于」+ compat 文件头）。`stylesnap` 基线已重烤、`ui-metrics`/`cssLayers` 门禁通过。以下为原始登记与判据（保留作背景）：
    - **背景**：用户核对「不是已经没有思源的事了吗」。核查结论（261012，已有实测）：**运行期零思源代码/资源**
      （`src/b3/**` 已整体删除、无任何 import 指向 `siyuan-master`）；移动端 P5 起连桌面的 `compat.css` 也不引，
      移动端里 `--b3-*` 定义与 `.b3-*`/`fn__*` 类名均为 **0**（P7b 顺带删掉了移动端 theme 里那 44 条已无人消费的
      `--b3-*` 过渡桥接，删后设备快照 6 态 0 差异 = 反证无人消费）。
    - **桌面还剩什么**：桌面 JSX 仍把 `.b3-*` / `fn__*` 当**类名契约**在用（历史快照行、设置页骨架、菜单/列表等），
      承重规则收编在 `src/styles/compat.css`（279 行，含从原 `b3/siyuan.scss` **复刻**的段落）；另有
      `features/outline/ExpandLevelIcon.tsx` 的图标路径取自 siyuan `icon.js`。
    - **要做的事（桌面批次，工作量不小）**：① 把桌面 JSX 的 `b3-*`/`fn__*` 换成自有命名（`ln-*` 或新前缀）；
      ② 把 `compat.css` 的承重规则迁进对应层/原语（单一来源）；③ 逐屏走查对拍（桌面 stylesnap 基线只许降）+
      `ui-metrics`/`cssLayers` 基线同步；④ **许可**：只要仍有从思源移植的规则/图标（AGPL-3.0），
      README 要求的 NOTICE / 「关于页」署名就**必须保留**——这与"改名"是两件事，不能顺手删（合规红线）。
    - **判据**：做完后全仓 `grep -rn "b3-\|fn__"` 只剩「许可署名 + 历史说明」两类注释，代码与选择器为 0。
    - **登记出处**：`AGENTS.md §3#14`「思源层已整体移除（`src/b3/**` 已删除；仅类名作为 JSX 契约保留）」——
      本条即是把"仅类名保留"这一步也做完。
21. **分屏（261012 三路调研后的候选清单；本轮只做了缺陷修复，下列等用户定）**：调研产物 `.css-audit/split-research/{edge-split,code-audit,peers-arch}.md`（gitignore，**不入库**；要复现就重跑探针脚本，脚本也在同目录）。逐条「不做会付什么代价」见 peers-arch §5。
    - **Edge 一手实测（261012，Edge 155.0.4283.45）**：Edge 的「拆分视图」**不是合并标签** —— 当前标签变左半（标题加「- 左视图」）、并**新增**一个右半标签（`edge://newtab`，后缀「- 右视图」，各占约半宽、**两者同时 selected**），原标签不被吞并；**同窗口可并存多组**拆分对（实测 2 组）；关闭任一侧 ⇒ 分屏**自动解散**、另一侧回落全宽；切到别的标签**不销毁**（重新选中即恢复）；分隔条可拖、最小 **~141px**、**双击复位 50/50**、Esc 无效；入口 = 菜单「标签页 → 将选项卡添加到新的拆分视图」= **⌥⌘N**（窗口 ≥2 标签才可用；工具栏按钮/右键链接/垂直分屏/持久化均**未验证**）。⇒ 我们的「一个合并标签」是**对 Edge 的简化**（261008 用户定稿），不是照抄；要不要改成「两个半宽标签」属产品决策。
    - **候选状态（261012 用户裁定 + 261014 修订，别再重提）**：① 分屏宽度持久化 ❌ 不做；② 分屏对跨重启恢复 ❌ 不做；③ **合并标签右键菜单 —— 261014 用户点单恢复**：只放**分屏专属两项**（取消分屏 / 左右互换），**不混入单页的关闭/钉住语义**（实现 = `TabContextMenu` 的 `split` 模式；当年是"整套单页菜单"被回滚，这次是分屏专属菜单）；④ 入口补齐（标签右键「在右侧分屏打开」/ 快捷键）❌ **不做**（同上，已回滚）；⑤ 同文档分屏 ❌ 不做（要动 tab 身份模型）；⑥ 多栏/上下/嵌套 ❌ 不做（无证据；第三方布局库亦已否决）。**其余理由（用户原话）：「Edge 都没有」**。
    - **分屏浮动工具条：261014 用户点单彻底删除**（组件 `SplitPaneControls` + `splitView.css` 5 条规则 + `PANEL-CONTRACT` 几何条目；
      分屏动作只剩「合并标签右键」与「标签上的 ×」）。**不要再加回浮动条。**
    - **分屏期间标签拖拽排序** ✅ **已修（261012，见 §0）**：旧实现分屏即禁用拖拽，且合并标签只占一个槽位会让「拿 DOM 顺序回写」丢页；现在走 `tabOrder.ts` 的「槽位 → 真实顺序」两步，组内两页整块移动。

22. ~~**正式包大目录切标签性能（261013）**~~ **最小优化已落地**（见最新§0）：App稳定保存失败回调 + Sidebar本行内容memo；真实默认GPU包同组209→74ms、跨笔记本231→75ms，结构/几何不变，17场景与6态样式门禁通过。递归仍遍历全树，进一步优化仅按新热点证据立项；**不做目录窗口化**，多维表5000×20按#11已正式接入主树。

23. **移动端 mobile-snap 基线陈旧（261022 发现）**：本分支 APK 与 master `7f378130` APK 在同一台 AVD `lake_gate` + 同一数据上采 `home-quicknotes` 均为 **1768 els 且逐字节相同**，而基线是 **1816 els / 5fq1ij**（−48 元素 ⇒ 设备夹具或 261020–261022 批次造成的基线陈旧，**与本批无关**）。门禁会一直假红。**处理**：在合并后的 master 上用整份 6 态重烤（`--from <warm>.json --write-baseline`，**别用 `--states` 覆盖**，会静默毁掉其余态；口径同 README「陈旧基线」）。
24. ~~**桌面 stylesnap 基线陈旧（261021 发现）**~~ ✅ **已结案（261022，`ba6d5a8d`）**：`scripts/css-audit/baseline/stylesnap.json` 是 261018 烤的，之后 261019–261021 批次让**每态 +19 元素**（HEAD 构建 2370 vs 基线 2351，恒定增量 ⇒ 全局外壳改动，不是夹具/数据）。**261022 已在 master 上整份重烤**（两轮 42 态逐行一致；新基线每态 +21，2351 → 2372），做法与坑见 §0「桌面 stylesnap 基线重烤」。**别用 `--states` 与 `--write-baseline` 连用**（会静默毁掉其余态）。
16. **移动端表格 chrome P4/P5（261021 路线切换后；细化见 §8 261021(三)）**：
    **P4（视觉/交互收口，纯 chrome）**：① 网格视觉对拍（移动端专用 Univer 主题覆盖：表头 #f4f5f5 / 当前行列头 #e7e9e8 / 网格线 #e5e5e5 / 选区填充 #eefbfb + 2px #2f8ef4；桌面不动）；
    ② 二级选择器视觉（颜色板、对齐图标行；冻结/公式行式；字号/边框继续置灰）；③ 保存态方案 A 自动保存「保存中/已保存」轻指示（方案 B 显式保存按钮待拍板）；
    ④ 阅读态 5 项动作（当前全置灰）与「目录/编辑」浮动胶囊（待拍板）；⑤ 暗色主题 + 设备全量对拍（编辑/阅读/键盘/多表/新表网格/工作表切换）。
    **P5（能力补齐，逐项确认 Univer facade/command）**：保存按钮 / 格式刷 / 清除格式 / 小数位 / 边框 / 筛选 / 排序 / 保护 / 查找替换；多工作表切换真实设备点测（当前只有单表）。

## 4. 关键坑（长期有效）

### 同步 / 数据
- **`purged_at` 不是永久墓碑**：前缀删除成功后会被 `markPurgeSynced()` 清空；永久判定看 `deleted_notes` 墓碑（folder 看 `node_type='folder'`）。
- **purge 必须无条件写墓碑**：`notes` 行缺失时从 `tree_nodes` 兜底；漏写会导致云端复活成不可见文档。
- **manifest.assets 永远全量声明**：上传差集只决定 PUT，不能裁剪声明；否则他端 GC 会误删在用资产。
- **资产存在性只看远端清单差集**，禁止逐对象 HEAD 和本机持久缓存；下载侧用实扫 size+sha256 判本地复用。
- **软删 = 移入回收站笔记本**；`deleted:true` 仅用于 purge 墓碑。混合两者会破坏恢复和删除传播。
- **任何打开文档入口先判 `isGoneNote()`**：回收站/已 purge 文档必须只读并显式提示，绝不允许静默丢保存。
- **静默丢弃用户输入是最坏失败**：拦截保存必须有可见原因和出口。
- **S3 并发峰值 ≤8**：正文 2×资源 4，不要为吞吐继续加。
- **Manifest V1 重置不是兼容模式**：只读写 `{1}`，所有端一起升级；旧 `sync.ts` 已删除。

### 渲染 / UI
- **JS import 的 CSS 一定未分层**（261021）：`@layer` 只对 CSS 内部的 `@import … layer(x)` / `@layer` 块生效；组件/懒 chunk 的 `import "x.css"` 产出的 chunk CSS 是**未分层**的，而未分层普通声明压过**所有**分层声明。⇒ 第三方/全局 CSS（内核、Univer）只能由 `styles/index.css` 以 `layer(...)` 引入；组件自己的 CSS 不得含裸标签选择器（`body`/`button`/`*`…）。261021 实测：小记兜底 chunk 自带内核 CSS ⇒ 设置面板 × 偏离右上、全站字体变系统栈（159 个控件被改写）。护栏：`src/styles/cssLayers.test.ts` + `scripts/css-audit/audit-vendor-css.mjs`（check:bundle）。
- 浮层列布局的固定区用 `flex: 0 0 auto`，否则内容会被列表盖住。
- **表格行里的长文本会撑开 `table-layout: auto` 的列宽**（260929 实测）：多维表分组头是 `<tr>`，长分组值把**表头首列撑到 482px**、记录行仍 80px ⇒ thead/tbody 列错位（用户报的「错位」）。表格里要放"不该影响列宽"的内容，把它**移出流**（`.bt-group-inner` 绝对定位 `inset: 0`），列宽只交给表头/记录行决定；别用 flex/nowrap 直接写在 `<td>` 里。
- **浮层定位禁止用估算高度**（260929）：统一走 `src/hooks/usePopoverPosition.ts`（量真实尺寸 → 下方优先、贴底翻上方 → 夹进视口），垂直口径是 `topMenuPosition.ts` 的 `placeVertical`。历史多处按猜测高度夹 `innerHeight - N`（48/90/300…），贴底就被裁且不翻转；`Overlay` 原语只吃调用方给的 `style`，定位责任在调用点，**新增浮层必须走该 hook**。
- **多维表底栏（`.bt-stat-row`）上沿不是常数**（260929-UI2）：它贴的是**表格视口**底部，横向滚动条会吃掉内容盒高度（实测差 10px，列多时恒有）⇒ 把状态栏钉在它上沿**必须实测**，由 BitableEditor 写 `--lake-bitable-status-bottom`、`chrome.css` 消费（同 sheet 的 `--lake-sheet-status-w` 姿势）。在 CSS 里猜高度必然要么压住底栏、要么离得老远。**在隐藏窗口（CDP 依附）里不能用 `requestAnimationFrame` 做这种实测**：`document.hidden === true` 时 rAF 不触发（本轮踩过，变量永远写不进去）。
- **量这类「贴底栏」位置要取 `position: sticky` 的那个元素（`.bt-stat-row td`），不是它的 `<tr>`**（260929 修「一个数据表有状态栏、另一个没有」）：sticky 挂在 td 上，`<tr>` 仍是 static；内容纵向溢出时 `<tr>` 停在**内容底部（视口外）**，拿它算 `innerHeight - tr.top` 得负值（实测 -231px）把状态栏顶出屏幕；不溢出的空表恰好也贴底所以看着正常。
- 预览切换先 `img.decode()` 再替换，别 `setState(null)` 造成塌陷闪动。
- 改 CSS 先找单一来源和层序；不要靠继续加覆盖层解决。改后跑 `cssLayers` + `ui-metrics`。
- **`src/styles/cssLayers.test.ts` 的基线是硬上限（只许变小）**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081**。新样式一律**新建文件**并登记 `FILES`+`BASELINE`，且**必须由使用它的组件 import**（漏 import 时元素在、样式空，很难发现）。
- `content-visibility`/`contain` 不要加到 Lake 引擎层。
- 内核/第三方 inline style 是唯一允许更高层覆盖或 `!important` 的例外，且要写理由。
- 多 tab keep-alive 下，CDP 查询必须过滤可见 tab（`.bitable-editor:not(.fn__none)`），否则会命中隐藏编辑器。
- **`HoverPopover` 的悬停监听只在「挂载时」读一次 `anchorRef.current`**（`Overlay.tsx` 的两个 effect 依赖里没有锚点元素）⇒ 锚点元素会在**不重挂**的情况下被换掉时（同一组件在"有链接 ↔ 纯文本"两种形态间切换），监听仍留在**已移除的旧节点**上，表现为"悬停再也不弹"。解法 = 让浮层在锚点变化时重挂（`key` 随形态/失效态变），**不要在组件外用 ref 硬改**。261008 引用卡踩到。
- **横向 tab 一律用 `kit.css` 的页签原语 `.ln-tabs`**（260929 用户在多方案对比里选定「B 墨线 + 计数徽标」：文字 + 选中项变强调色 + **与文字等宽**的 2px 下划线压住容器的 1px 分隔线；数量放 `.ln-tabs__count` 徽标；右侧动作放 `.ln-tabs__action`）。结构 = `.ln-tabs > .ln-tabs__track[role=tablist] > .ln-tabs__item[role=tab][aria-selected]`；**已全量落地**：关联选择器、回收站、历史面板、表单编辑·预览。`.seg` / `.seg__item` 只剩「取值选择 / 图标型开关」（设置页主题三选一、小记列表·卡片版式），**不要再拿它做横向 tab**。

### 多维表（自研）
- **图片预览范围 = 单个单元格**：两列图片就是两类，绝不跨列/跨行合并；表格/记录详情/表单/看板缩略图都只预览"本格"，画册只预览"封面字段该行那一格"。
- **磁盘名绝不外显、也绝不可编辑**：`uploadResource` 对图片只回**磁盘名**（main 侧忽略请求名）、对附件回**清洗后的原始文件名**；凡把响应 `filename` 当展示名的地方都会显示成 `17xxx_ab12cd34.png`。展示名必须用**用户原始文件名**，并有统一守卫（`bitableAttachments` / `buildAttachmentPreviewItem`：缺展示名或本身就是落盘名 → 中性文案）。
- **落盘名是随机唯一**（`buildAssetFilename` = 13 位毫秒 + 8 位随机 hex），全链路**无内容去重** ⇒ 同一张图上传两次必得两个文件，不会出现"多条引用共用一份文件、删一条把别人删没"。
- **系统时间字段（创建/修改时间）必须走记录级取值口径 `bitableFieldValue(record, field)`**：它们的值不在 `values` 里；筛选/排序/分组任何一处直接读 `record.values[field.id]` 都会得到 `undefined`（表现是"排序等于没排、筛选全空"）。展示走 `bitableFieldText`（到分钟）。
- **文档图片预览列表必须取正文**：编辑态开着虚拟渲染 + `cardLazyInit`，视口外卡片不在 DOM 里 ⇒ `querySelectorAll("img.ne-image")` 会少图、切不动；内核这个构建 `allowClickToMaximize`/`previewImgs` 不可用，列表用 `extractImagesFromContent`（正文解析）。
- **只读（锁定/回收站）必须封死所有写入口**：包括视图配置下拉、视图重命名、看板配置等"非单元格"的写入点（本轮修过泄漏）。
- **表格里的 `th` 默认是 `text-align: center`**（浏览器 UA 样式）：字段头靠 `.bt-th-inner { justify-content: flex-start }` 才左对齐；表尾「新增字段」那格 `.bt-th-add` 原先没有规则 ⇒ 加号被甩到**空白区正中央**（260930 用户报「不要总是居中」）。另外 `.bt-grid th { padding: 0 }` 是 (0,1,1)、裸类名 (0,1,0) **压不过** ⇒ 改这一格要写 `.bt-grid th.bt-th-add`。它同时是「吸收表格剩余宽度」的自动宽度格：**只对齐内容、别给固定宽度**（给了会把剩余宽度摊给数据列、把列宽撑开）。
- **不要用 `el.select()` 去「让用户直接覆盖输入」**（260930）：选项编辑给新行 `focus()+select()` 想省一次全选，结果屏幕上就是**一块系统蓝底**（用户：「为什么会有蓝色的底色」）。要「键入即新值」就让输入框**本身是空的**（默认名放 `placeholder`，保存时兜底），别用选区做交互暗示——选区是系统配色、不受我们的令牌控制，也没法只对它隐藏。`focusCell`（表格单元格键盘导航）仍保留 `select()`：那是网格里既有约定的「落到某格即覆盖」，与选项编辑不是同一个语义。
- **多维表列宽：`table-layout: auto` 下 `<col style="width">` 只是「至少这么宽」**（260930 用户：「所有的列都是根据内容长度算的左右宽度，我需要能自由设置」，附件 chip 实测把 180 撑到 413）。真正卡住列的是**每个格子的 `max-width`**（按列写行内 —— 宽度来自正文数据，CSS 无法按列取值；`<col>` 上的 max-width 被忽略，`contain: inline-size` 在 table cell 上同样无效）。改列宽相关的样式时**四处都要带**：表头 `th`、记录格 `td`、分组统计格、底栏统计格 —— 漏一处就被那处的长内容重新撑开。表尾「新增字段」那格是**吸收剩余宽度**的自动列，不要给它 max-width。
- **行高必须与内容无关**（260930 用户：「不能为了展示内容而自动扩大行高。例如日期缩短了就会导致换行，而行高变大」）：`td` 上的 `height` 只是最小值，**内容一折行行高就涨**（实测日期列 80px 时 36 → 48）。所以 `.bt-grid th/td` 统一 `white-space: nowrap`（永不折行），装不下由各自的 `text-overflow: ellipsis` / 裁切处理（日期/时间格在 `.bt-date-trigger > span` 上省略；文本格靠 `input` 的 `text-overflow: ellipsis`；chip/缩略图类没有省略号语义，就是裁切）。`overflow: hidden` 在 table cell 上**不裁剪**（Chrome），别指望它。
- **附件「文档类型图标」没有现成的内核图标可用**（260930 用户问「我们是否有对应的图标样式可以使用」——**没有**）：内核 sprite 实测 **325 个 symbol，无一个 file/pdf/doc/ppt 系**（只有 `icon-card-mention-doc`）；云端那套彩色「页」图标属于**语雀 App 自己的 sprite**，不在 kernel bundle 里（同 §2 的 `note-*` 图标问题）。⇒ 用**自己的图标库 lucide-react**（全站同一套线性图标）按类型分色，类型判定收敛到 `src/core/assetNaming.ts` 的 `fileKindOf()`（单一事实源，桌面/移动端共用），颜色新增 `--lake-file-*` 令牌（只在 `themes/base.css`，内容/品牌色不随主题分叉）。`hover 名称气泡 = kit 的 .ln-tip 表面 + usePopoverPosition 定位`（`position: fixed` ⇒ 不被 `.bt-grid-wrap` 的 overflow 裁掉）。**附件字段与图片字段就此分叉**：`attachment` = 类型图标（不显示名称/缩略图）、`image` = 缩略图（该字段的语义就是看图），分叉点是 `AttachmentCell` 的 `imageOnly`。

- **样式「收编到原语」时，必须把 feature 层里那份声明删掉**（260930 大统一踩到）：层序是 `@layer … kit, shell, feature, overlay …`，**kit 层低于 feature 层** —— 只在 JSX 挂上 `.ln-iconbtn`/`.ln-menu__item` 而不删掉 feature 文件里的同名视觉声明，旧的那份照样赢（同选择器比层序）。正确姿势 = 原语给「盒子/圆角/配色/状态」，feature 只留**本处特有**的布局（绝对定位、`visibility`、卡片上的白底药丸等）。
- **正文有 32 MiB 上限**（260930 压测实测）：saveNote 超过即 LAKE_IPC_CODE:INVALID_INPUT「正文不能超过 32 MiB」。因此 50000×50（250 万格）根本存不下去，不是渲染慢的问题。
- **主Grid与关联选择器已是行窗口（261014正式接入）**：完整模型不裁剪，挂载仅viewport+缓冲+1编辑pin；屏外复制/粘贴、统计、筛选/排序等按全投影处理，修改先读`docs/BITABLE-VIEWPORT.md`。旧260930 AR04全量DOM压测是历史性能对照，不再按“无虚拟化”定位当前瓶颈；非Grid视图不随本批重做。

### 工程 / 环境
- Node 必须 24；better-sqlite3 是 Electron ABI，系统 Node 不能替代运行时。
- 改 `electron/**` 或 `src/core/**` 会触发 Electron 重启；验证前确认 CDP 端口连的是新实例。
- Vite dev server 必须长驻；`nohup` 起的进程会随会话回收。
- 杀 Electron 只按唯一 CDP 端口精确定位 PID；禁 `pkill -f Electron`、`killall`。
- DSH 宿主里启动仓库 Electron 要 `env -u ELECTRON_RUN_AS_NODE`；**跑 CDP 验收还必须加 `--no-sandbox`**（否则 Chromium sandbox 初始化报 `Operation not permitted`，连锁 NetworkService/GPU crashed，实例整体退出；userData/端口本就隔离）。
- 打包版写正式数据目录；试跑必须覆盖 `LAKE_USER_DATA`，发布 smoke 用独立端口。
- **scheme 模式验收前必须 `npx vite build`**（它服务 `dist/`，否则验收的是旧 bundle）。
- **CDP 依附的窗口是隐藏的**（`document.hidden === true`）⇒ `loading="lazy"` 图片不加载；验收图片要临时去掉该属性，别误判成产品 bug。
- **隐藏/被遮挡窗口里不要用「合成鼠标拖拽」做性能验收**（261008 实测教训）：`document.hidden === true` 时 Chromium 对 `Input.dispatchMouseEvent` 的 **`mouseMoved`** 要等到出帧才回包 ⇒ 连**非边界**位置的一次移动都要 ~5s（`mousePressed`/`mouseReleased` 只要 14~18ms）。用它量「拖列宽」会把 1.4s 的真实卡顿量成 46s 的假象。**正确姿势**：改用**同步动作**计价（例如右键列头 →「自动行高」会同步跑完整表重算，`Runtime.evaluate` 的往返时间 ≈ 该同步耗时），或直接在页面里微基准化目标函数。
- **要「仿照云端」时，优先读云端前端资源而不是一个个点 UI**（260929 用户提示，已实践）：`bsk evaluate` 里 fetch `performance.getEntriesByType('resource')` 找到 `gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css|.async.js`（CORS 可读），配置表/样式规则直接 grep 就有（如统计项的 types 限制、占位 hover 规则）；点 UI 只用来交叉验证。
- **用户可能与测试实例共用同一个进程/窗口**（260929 用户明确交代）：我起的隔离实例（LAKE_USER_DATA=$TMPDIR/lake-accept + LAKE_RENDERER=scheme）用户会**直接在同一个窗口里看/操作** ⇒ **不要默认 kill 实例、不要 rm -rf 该 userData**（那是他正在看的数据）；只有用户明确说「清理/重建」时才收尾。同理，验证脚本不要顺手删掉自己建的测试笔记。
- **读落盘要轮询**：自动保存有防抖，改完立刻读会拿到旧值。
- **别用 `read` 的输出重写大文件（261008 连踩两次）**：`read` 对长行/大文件会**截断或省略**（实测 503 行的 HANDOFF 只读回 196 行）⇒ 拿它的输出 `write` 回去等于**静默删掉其余内容**。改大文件一律用 `edit` 定点替换；整份回滚用 `git show <commit>:<file> > <file>` 并**立刻 `wc -l` + `grep -c "^## "` 校验**。
- **新增 CSS 文件必须由使用它的组件 `import`（261008 踩过）**：只建文件 + 登记 `cssLayers` 的 `FILES/BASELINE` **不会**让规则进包 —— 漏 import 时"元素在、样式空"，而 `cssLayers`（只数声明）与 `ui-metrics`（只看令牌/颜色）**都照过**；判据只看**产物** `grep -o "\.某类[^}]*}" dist/assets/*.css`。
- **浮层选原语：`.ln-menu` 是"竖向菜单"，`.ln-popover` 才是中性表面（261008 踩过）**：横向动作条挂在 `Menu` 上会拿到 `flex-direction: column`；再写 `flex-direction: row` 压它是**加覆盖**（违背"改单一来源"）——正解是**换回 `Popover`**，本处只留自己的布局（间距）。
- **`Overlay` 的 `surfaceClassName` 是"覆盖"不是"追加"**（源码 `surfaceClassName ?? "ln-menu"`）：传它会把白底/边框/阴影一并替掉（浮层"透明、点不到"）；要加自己的类请用 `className`（源码是 `surfaceClass + " " + className`）。
- **AI 结果回写正文：绝不「纯文本重建原选区」，也不要用 `insertAtSelection` 折叠光标做块级插入**（261005）：只用 `insertAtPosition({id,offset}, "text/markdown", …)` 插新块，原块一个字节不动；`offset` 按模型 `_parent`/`_children` 算（DOM 的「某元素之后」映射少 1）。`applyModelRange` 一类模型选区命令必须走 `kernel.execCommand`（editor 层会抛且被 try/catch 静默吞掉）。详见 `docs/LAKEX-CONTRACT.md` §5.16。

### AI 多模态（261005-MM，长期有效）
- **附件内容跨 IPC 只传引用**（`{noteId, filename}`），字节读取 / 解析只在主进程（`electron/ai/aiContentResolver.ts`）：渲染层 CSP 读不了文件；base64 过 IPC 既翻倍内存又冲垮 20 万字符预算。附件**不落正文、不进 S3 / 同步**。
- **图片 / 文档块只能出现在 `user` 消息**（供应商对 system/assistant 带图直接 400），校验在 `electron/ai/aiChatMessages.ts`。
- **PDF 只能本地抽文本**（DeepSeek 的 file / Files API 只收图片）：`electron/ai/pdfText.ts`（unpdf）；扫描件无文字层 → 明确报错，不静默发空。**Office 与 AI 生图明确不做**。

## 5. 上线与后续建议
1. 多维表专项已收口；后续只从 §3 取项并单独立项，不要恢复已完成的研究/计划文档。
2. 改同步/GC 前先读 `AGENTS.md` 原则 11~13 + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`；写 Lake 正文前读 `docs/LAKE-CONTENT-WRITING.md`。
3. 编辑器/lakex 相关先按 AGENTS §2 的检索顺序查 vendor → 官方文档 → `LAKEX-CONTRACT.md` → 源码字典。
4. 上线收尾的真实环境验收仍待做：空库双端 V1 同步、Android 真机、发布说明（见 §8 与专项之外的 backlog）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）—— 261013 实测总共 ≈21s（tsc 5s / vitest 8s / 两条构建各 3s / 其余 ≤1s）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs && npm run check:core && npm run check:mobileui && npm run check:bundle && git diff --check
# 门禁分层（261013 定，避免"每次改动都跑很久"）：上面这 5 条 = 日常/每次改动，就是"门禁"的正式含义。
#   ② 动了 CSS/UI 要证"视觉中性"时：**只验改到的那 1~2 个态**（秒级，态自包含）——
#        node scripts/css-audit/drive.mjs 9231 scripts/css-audit/stylesnap.mjs after "resources:1315:light"
#        node scripts/css-audit/check-stylesnap.mjs --port 9231 --states "resources:1315:light"
#      完整 42 态（≈294s）只在换夹具 / 改装置 / 发版前跑；跑前先 npx vite build（scheme 模式服务 dist/）。
#   ③ 设备门禁（移动端 check:mobilesnap 6 态 / 走查 22 屏）只在改动涉及移动端时跑，且只跑专用 AVD lake_gate（5556 / CDP 9336）。
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# 多维表真实端压测（隔离 userData/CDP，跑完自清；见专项 §17.12）
STRESS_SIZES="5000x20,20000x50,50000x50" node scripts/bitable-stress.mjs
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
node scripts/lake-roundtrip-check.mjs --note <id>   # 对拍「这篇一打开会不会被内核改写」（只建临时文档，退出码 1=会被改写）
```
- **UI 实测姿势（本轮全程使用，推荐）**：
  ```bash
  # 1) 必须先构建（scheme 模式服务 dist/）
  npx vite build
  # 2) 隔离开一个实例（独立 userData / 资源端口 / CDP 端口）
  env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-x" \
    LAKE_ASSET_PORT=19890 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9230 .
  # 3) 取 page target，用 Node 24 内置 WebSocket 直驱 Runtime.evaluate / Page.captureScreenshot
  curl -s http://127.0.0.1:9230/json/list
  ```
  详见 `docs/CODEX-GUIDE.md`。注意 §4 的三条坑（重建、可见元素、lazy 图片）。
- 日志：A `~/Library/Application Support/local-lakex-notes-dev/logs/local-lakex-notes.log`；B `$TMPDIR/lake-device-b/logs/local-lakex-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 V1 重置）· `S3-GC-DESIGN.md`（存储/删除 GC）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）。
- **表格（usheet / Univer）**：`USHEET-UPGRADE.md`（内核触点清单 + 依赖升级 playbook + 路线图；配套 `src/features/usheet/usheetKernelContract.ts` · `univerContract.test.ts` · `scripts/usheet-kernel-probes.mjs`）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md`（当前唯一移动端架构规格；旧 `ANDROID-TECH-SCHEME`/`ASSET-URL-MOBILE-PLAN` 已删）。
- **UI/工程规范**：`scripts/css-audit/README.md`（样式层）· `PANEL-CONTRACT.md`（面板几何/层序契约）· `DESIGN.md`（浮层原语）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端速查（完整端）

> **「移动端架构重做」已结案（261010）**：核查确认本仓库**不存在重做**（无新分支/worktree/未提交改动）⇒ 不立项重设计。
> 原「重构输入」三问的答复：① F16 **已按当前架构修复**（写域/维护域分离，见 §0 本批）；② 走查装置**必须接进验收流程**（`check:mobilesnap` + 设备级截图）；
> ③ `window.lakeNative` **保留并改为从实现派生**（261020 起 52 = 50 bridge + 2 附带，护栏 `lakeNativeContract.test.ts`）。
> 移动端规格与硬约束现在只在 docs/MOBILE-TECH-STACK.md（含「每层用哪种复用方式」判据、互斥域、能力矩阵、未结项）。

### 261021(三) · 移动端表格 chrome 路线切换：Yuque 式顶栏 + 锚定卡片 + 自绘底栏（**P1-P3 已合入 master**）

- **用户 261021 定稿**：放弃 261020 的「底部 dock」路线，改成复刻语雀 App —— 顶部 **40px 工具栏**（插入 | 撤销 重做 | 常规▾ | ⋯）、**21px 公式栏**、自绘 **32px 底栏**；二级菜单全部用**锚定卡片**（不再底部 Sheet/面板）。
- **落地（单一来源）**：`usheetChromeModel.ts`（工具条分组 / ⋯ 七行图标 / 插入卡 / 数字格式分类）· `SheetPopCard.tsx` + `SheetMoreCard.tsx`（锚定卡：无遮罩、外点关闭、卡内下钻）· `SheetIcon.tsx` · `MobileSheetFooter.tsx`（工作表列表/页签/缩放）· `MobileSheetReadingBar.tsx`（阅读态 5 项，暂置灰）· `MobileUsheetViewer.tsx`（动作全走 Univer facade；公式栏 pointerup → `setCursorManually` 落光标）。
- **旧路线已删**：`UsheetChrome.tsx`（底部 dock）与 `docs/MOBILE-SHEET-PARITY.md`；`mobile.css` 恢复表格宿主几何并隐藏 Univer 自带 header/footer/浮动钮；移动端新建表网格仍 24/120/40/24（旧文档不迁移）。
- **设备实测**：工具条 40 / 按钮 34×32 / 公式栏 21 / 底栏 32；卡片锚在按钮下方、底栏工作表列表卡在上方；双击单元格进编辑（键盘 842→530）；缩放 100→110%；阅读态 5 项 + 底栏。
- **合并说明**：master 已有 261021 小记搜索/标签等更新，本次只覆盖移动端表格 chrome 路线，其余更新保留；`getUndoRedoStatus` 等旧触点保留（不影响新工具条）。

**P4 / P5 待办（下一步，按优先级）**

**P4（视觉/交互收口，纯 chrome）**
1. **网格视觉对拍**：移动端专用 Univer 主题覆盖（表头 `#f4f5f5` / 当前行列头 `#e7e9e8` / 网格线 `#e5e5e5` / 选区填充 `#eefbfb` + 2px `#2f8ef4`）；只改移动端，桌面不动。
2. **二级选择器视觉**：颜色板改色块/圆点、对齐改图标行；冻结/公式保持行式；字号/边框继续置灰。
3. **保存态**：方案 A（推荐）自动保存加「保存中/已保存」轻指示，不改同步语义；方案 B 显式保存按钮 —— **待用户拍板**。
4. **阅读态**：5 项目前全置灰（内核无读态动作，筛选/排序/冻结/查找待 P5）；「目录/编辑」浮动胶囊是否做 —— **待用户拍板**（当前编辑入口仍用工作区顶栏）。
5. **暗色主题 + 设备全量对拍**：编辑 / 阅读 / 键盘 / 多表 / 新表网格 / 工作表切换。

**P5（能力补齐，逐项确认 Univer facade/command 后接）**
- `保存按钮 / 格式刷 / 清除格式 / 小数位 / 边框 / 筛选 / 排序 / 保护 / 查找替换`。
- 多工作表切换真实设备点测（当前只有单表，页签切换/缩放已接线但未实际多表点过）。

- 正式端：Capacitor Android，包名 `com.locallakexnotes.mobile`；定位为完整端，桌面红线同样适用。
- 数据在模拟器 App 沙盒，不在 macOS 数据目录；开发可 `adb shell pm clear com.locallakexnotes.mobile` 重建。
- AVD：`lake_mobile`（Pixel 6 / API 36 / arm64）；SDK 在 `/opt/homebrew/share/android-commandlinetools`。
- Node 24；Android 脚本已内置 JAVA/SDK 环境。

### 常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
bash scripts/android-build.sh --sync --install
bash scripts/emu-cdp.sh
bash scripts/emu-up.sh
bash scripts/mobile-preview.sh
```

### CDP / 编辑器
- App 重启后 WebView socket 会变化；重新 `adb forward` 后再连 `/json/list`。
- **CDP `forward` 会指向旧 PID 的 socket（261010 本轮踩到）**：App 重启后 `/proc/net/unix` 里**新旧 webview socket 并存**，
  `forward` 若还指着旧名，表现为 **`/json/list` 空** 或 node 侧 **`fetch failed: other side closed`** —— **不是 App 崩**（进程 `pidof` 仍在）。
  修法（按**当前** PID 精确重转）：`PID=$(adb shell pidof com.locallakexnotes.mobile | tr -d "\r"); adb forward --remove tcp:9335; adb forward tcp:9335 localabstract:webview_devtools_remote_$PID`。
- 活跃 Lake 实例暴露为 `window.__mobileEditor`；命令用 `renderer.execCommand`。
- 有效命令：`bold`、`unorderedList`、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style("p"/"h1"/"h2")`、`undo/redo`。
- 无效/易错命令：`insertUnorderedList`、`formatBlock`、`heading`、`strike`、`justify*`、`clearFormat`、`fontsize`。
- 工具栏按钮必须 `onMouseDown preventDefault`，否则抢焦点导致命令 no-op。
- 面板与 IME 必须用 visualViewport 实测状态互斥；不要跟内核异步重聚焦赛跑。
- 真机可能是 edge-to-edge，模拟器是 adjustResize，二者都要覆盖。

### 多维表只读（260929 补齐 + Android 模拟器验收）
- 单元格按字段类型给**只读控件**（不再是裸文本）：布尔=禁用复选框、链接=`<a target="_blank">`（外部 origin 走系统浏览器）、评分=5 星、进度=条+百分比、关联=目标记录主字段 chip、附件/图片=缩略图、单选/多选=色块；其余走 `bitableFieldText`（系统时间到分钟）。
- 非 grid 视图（看板/画册/日历/未知类型）仍走「明确提示 + 表格只读」，不空白、不改数据。
- **验收姿势**：`android-build.sh --sync --install` → `emu-up.sh --no-window` → `emu-cdp.sh 9335` → 连 `http://127.0.0.1:9335/json/list`（Node 内置 WebSocket 直驱 `Runtime.evaluate`）。
- **造数据**（模拟器是全新安装、库里 0 条）：DB = `databases/local-lakex-notes-mobileSQLite.db`；`notes` 表写 `doc_kind='bitable'`、`content=<正文 JSON>`、`parent_id='notebook-personal'`（**必须挂到笔记本**，否则首页点开会提示「未找到该文档所属笔记本」）。改法：force-stop → `exec-out run-as … cat` 拉出 db/wal/shm → python sqlite3 写 + `PRAGMA wal_checkpoint(TRUNCATE)` → push 回 + 删 -wal/-shm → 重启 App。
- **点开笔记必须用真实点按**：首页最近文档是 `<button class="doc-card">`，CDP 里 `el.click()` **不触发**导航（页面不动），要用 `Input.dispatchMouseEvent` 在元素中心 mousePressed/Released。
- 已验收（模拟器 lake_mobile，Pixel 6 / API36）：`移动多维表`（全字段）断言 bool=[true,false] 且 disabled、链接 href/target 正确、评分星数=[4,2]、进度=60%/0%（条宽一致）、关联 chip=[目标A,目标B]/[目标B]、创建时间到分钟、只读徽标；`移动看板表` 显示「「看板视图」桌面已支持，移动端暂以表格只读展示。」

### 261008 续 · 本轮三修（移动端）

- **大纲手势按文档类型收敛**：表格 / 多维表 / 画板**没有大纲**，左滑不再拉出空面板 —— `usePanelDrag` 新增可选 `canOpen(side)`（只约束「打开」，已展开的仍可滑走关闭），判定走共享纯函数 `gestureCore.swipeTargetSide`；口径 = `(active.kind ?? "doc") === "doc"`（与顶栏「编辑」按钮同一条），切到无大纲类型时自动收起已展开的大纲抽屉，底栏「大纲」按钮同时置灰。**右滑开目录不受影响**。
- **「更多 → 新建文档」建好不跳转（真 bug）**：`NotebookWorkspace` 的组件 key 是 `notebookId`，同一笔记本内再指定文档**不会重挂载**，而「初次进入」那段 effect 有 `autoOpenedRef` 守卫 ⇒ 新的 `initialNoteId` 被忽略（现象：文档已进 DB、界面不动）。修法 = 加 `handledInitialRef`，在 `initialNoteId` 变化时显式 `openTab`（并按 `initialMode` 决定是否进编辑态）。
- **`emu-cdp.sh` 取错 WebView socket**：socket 名带的是**宿主进程 PID**，App 重启后旧 socket 仍挂在 `/proc/net/unix`，原来的 `tail -1` 会取到旧的 ⇒ `/json/list` 恒空、`check:mobilesnap` 直接报 `no page target`。改为优先按当前 App PID 精确取、取不到才回退，并在转发前 `forward --remove` 清旧映射。
- 门禁：`npm run check:mobilesnap` **6 态 0 差异**；桌面 tsc / vitest 全绿。

### 当前剩余验收
- V1 空库多端同步：创建/编辑/删除/恢复/GC。
- 真机：图片与附件、编辑保存、同步后图片加载、键盘安全区。
- 数据导出/导入、剪贴板粘贴、长文档大纲跳转。
- 缩略图目前仅 png/jpg/jpeg，失败会回退原图。
- ~~多维表只读控件（布尔/链接/评分/进度/关联/时间）~~ 260929 已在模拟器验收；真机复验仍可做。
