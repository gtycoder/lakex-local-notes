# 待办清单

> ⚠️ 已知 Bug（记录，待重做）：**移动端大纲在只读(viewer)模式下点击标题不能跳转**。`OutlineSheet` 用 `renderer.execCommand("headingUnfold")`+`renderer.scrollByNodeId()`，viewer 模式下两者不生效/静默跳过。用户将重做大纲，届时一并处理（2026-09-01 记录）。


## UI 重做：复刻思源前端（2026-08-16 立项；Electron 43 升级测试完成后启动）

> 目标：Lake Notes 界面「完全复刻」思源笔记（用户非常喜欢思源 UI/样式，且思源支持自定义 UI）。
> 参考代码（本机）：`/Users/admin/file/local-lake/siyuan-master`（v3.8.0，Electron 42.7.1）。
> **重要结论（已研究）**：思源前端是自研框架（`layout/Model` + WebSocket 连 Go kernel + protyle 块编辑器），
> 与 Lake Notes 的 React 18 + Lake 编辑器架构不兼容——**只移植「视觉层」（设计令牌 + 组件样式 + 布局结构），
> 不抄代码架构**；编辑器保留 Lake，只改外框样式。
> **License 注意**：思源为 **AGPL-3.0**。移植样式需在项目里保留署名/NOTICE（私有使用无碍，若分发需合规）。

- [x] **设计令牌移植**：把思源 `--b3-*` 变量体系（appearance/themes/daylight/theme.css：主色 #3575f0、
      表面色/文字色/圆角/滚动条/列表 hover/工具栏色等）移植到 `src/styles.css`，替换现有硬编码色值。
- [x] **组件样式移植**：按需移植思源 `app/src/assets/scss/component/`（button/dialog/menu/list/form/select/
      switch/slider/tooltips/typography/snackbar）到 Lake Notes 对应 React 组件（用类名映射，不抄 TS）。
- [x] **布局对齐思源**：dock 布局（左侧文件树/大纲/标签 dock、顶部工具栏、状态栏、标签页）——
      参考 `app/src/layout/dock/` 与 `app/src/layout/{topBar,status,Tab}.ts` 的结构，用 React 重排。
- [x] **双主题**：daylight + midnight 亮/暗主题切换（对应思源 appearance/themes）。
- [x] **自定义 UI**：CSS 变量 + 自定义 snippets 入口（对应思源「外观 → 代码片段」，支持用户改 UI；插件系统不做）。
- [x] **scroll-driven animations（思源风格动效，Electron 43/Chromium 150 Baseline）**：
      - 长文档阅读进度条（`animation-timeline: scroll(root)`）；
      - 树/大纲/列表条目滚入视口渐显（`animation-timeline: view()` + `animation-range: entry 0% entry 100%`）；
      - 大纲「跟随滚动」当前标题高亮/强调；
      - 面板/侧栏收起展开过渡。
- [x] **text-wrap: balance / pretty** 全面应用到短标题与段落排版（balance 已用于面板标题；pretty 微调时补）。

## 视觉/体验
- [x] **多标签（tab）宽度与间距**：关闭键固定在 tab 最右侧；短标签保持内容自适应，长标签继续封顶截断。
- [ ] Word / PDF 导出：收口导出已预留（`electron/export.ts` 的 `docx`/`pdf`），待实现（可走 HTML → docx/PDF 链路）。
- [ ] **附件功能（S3 存储一期之后）**：非图片附件（PDF/音视频等）完整支持——
  - 大文件分片上传 + 断点续传（≥8MB 走 Multipart，进度持久化，`asset_sync_state` 表）；
  - 按需懒下载（>5MB 先拉元数据，打开文档/渲染时再拉原文件）；
  - 缩略图/预览本地生成、可重建、不上传 S3；
  - 资产元数据（宽/高/时长/MIME）、EXIF 剥离可选；
  - 存储降级可走七牛 bucket 生命周期规则（不写代码）。
- [ ] 全文搜索 2 字以内查询回退：trigram 最小 3 字符，"回收/快照"等两字词需 LIKE 回退或提示（实现时处理）。

## 架构/技术债
- [x] **附件 → 音视频/图片卡自动分发（2026-08-27）**：附件路径插入的音频/视频/图片文件自动转为对应原生卡（内嵌播放/显示）。实现：`src/features/editor/mediaCardRouting.ts` 的 `installMediaCardCategoryRouter`（`beforeExecCommand` 拦截 `insertFiles`/`dropFile`，按 `mediaKindOfFilename` 改写 args 加 `category, from:"ui"`，混合批次异步分批保持顺序）+ `assetNaming.ts` 的 `mediaKindOfFilename`（audio/video/image 三态）+ EditorTab/LakeEditor 接入 + 移动端 DocumentPage 显式分发。格式常量 `AUDIO_EXTENSIONS`/`VIDEO_EXTENSIONS`/`ASSET_IMAGE_EXTS` 已导出（移动端复用）；**清单 = Lake fileReader 实测接受集**（CDP 逐格式验证）：audio=mp3/wav/m4a/flac，video=mp4/mov/mkv/avi/webm/m4v/wmv/flv/mpeg/mpg/3gp/ts，image=png/jpg/jpeg/gif/webp/bmp/svg/tiff/tif；aac/ogg/wma/avif/apng/jfif 等 Lake 任何路径都建不出卡，**不列入**（保持附件路径原生行为）。参考思源 SIYUAN_ASSETS_*（app/src/constants.ts）核对过。测试 731 passed。
- [x] **种子笔记本普通化：系统里没有"默认/不可删除"的笔记本（2026-08-27）**：所有笔记本（含首启种子"个人笔记"）都是普通笔记本——可删（移入回收站）、可改名、可 purge、删后不复活（`seed_initialized` 标记，桌面 store.ts + 移动端 bridge.ts）。唯一机制例外：回收站容器（`notebook-trash`，有笔记本行为的系统容器，非普通笔记本，保持不可删）。兜底父笔记本（`resolveParentNotebook`，用于无父新建/恢复/同步导入）：任意存在的笔记本（sortOrder 最小）→ 无则自动创建普通笔记本"未分类"（随机 ID + 图标 X，可随意删除）。修了根层笔记本 SQL 三值逻辑坑（`parent_id != ?` 对 NULL 恒不成立 + 回收站容器同属根层需显式排除）。删除入口 UI 无改动（原保护移除后右键删除即生效）。测试 735 passed。
- [ ] **Lake 内核策略：源码辅助 + 受控黑盒（2026-08-27 讨论，待执行）**：详见下文「Lake 内核本地化讨论」小节——不要把 lakex 当自家代码 fork（拿不到闭源源码），用 lakejs 开源源码当机制字典 + 版本锚点清单固化脆弱 hack + 按需最小 patch。
- [x] **锁定态（Viewer）文档的文本缓存**：已实现（`ensureNoteCaches` + lakeCaches 兜底 + 四处补缓存）。
- [x] **M4 数据安全**：回收站（软删除 + 本地回收站 + 同步墓碑）+ 文档历史/快照（15 分钟自动 + 手动 + 恢复/孤儿清理）已实现。
- [x] **P3：S3 对象垃圾回收（存储膨胀治理）**——已实现（`feat/s3-storage-rw-delete`，见 `docs/S3-GC-DESIGN.md` v4.1）：待回收清单 + 保留窗口（默认 7 天）+ 定期/手动对账（差集删除，默认 24h）+ 深度清理（Lake + 小记、孤儿兜底）+ purge 立即删 + 历史引用保护 + 审计日志；设置面板「云端回收（S3 GC）」三入口（立即对账 / 深度清理预览 / 执行深度清理）。设计经外部 AI 评审 + 用户确认（2026-08-13）。剩余“附件功能”另列于“视觉/体验”。
- [x] **Electron 升级 33 → 43.4.0（2026-08-16）**：直接升级、不做过度适配。better-sqlite3 升到 **13.x（N-API 单二进制，无需 rebuild）**，双 ABI 基建删除；依赖兼容（electron-log/vite-plugin-electron/sharp）通过；tsc + 217 测试 + build 全绿；**GPU 空转问题裸启动复验通过**（multidev.sh 改 `--use-angle=metal`）。分支 `feat/electron-43-upgrade`。
- [ ] **移动端复用专项（2026-08-18 分批执行）**：不再为了缩短 Store 行数继续拆普通笔记写事务；**Quick Notes M1 模型/校验/序列化层已完成（232 测试）**，下一步整理查询层，再根据移动端真实需求实现文件层和平台 adapter。评估见 `docs/MOBILE-REUSE-ARCHITECTURE-ASSESSMENT-2026-08-18.md`。
- [x] **思源机制借鉴优化（2026-08-18 第一轮已完成）**：已完成 SearchPanel 旧请求保护、per-note 保存队列、树索引/TreeRow memo、布局提交式持久化、History/Quick Notes/Trash/同步 tab reload 版本保护、Escape/reduced-motion 审计以及本地资源 CORS 预加载修复。树虚拟化、退出 flush/ack、通用 TaskManager 按停止条件暂缓。方案与实施记录见 `docs/SIYUAN-OPTIMIZATION-BACKLOG-2026-08-18.md`。

- [ ] **Store 分批重构（2026-08-17 立项）**：桌面端存储/同步/快照/回收站核心功能已基本稳定，Store 重构的长期收益较高；**Batch 3B 只读查询/纯函数抽取、Batch 4A SearchRepository、Batch 4B History/Trash 只读层、Batch 4C Asset 只读层、Batch 4D-1 NoteQueries、Batch 4D-2 NoteMetadataRepository、Batch 4D-3A 图片纯函数拆分、Batch 4D-3B-1 正文保存、Batch 4D-3B-2 资源协调器、Batch 4D-3B-3 远程导入已完成**，下一步按领域逐批迁移。严禁一次性改事务边界；每批都跑 227+ 测试及删除/恢复/同步回归。计划见 `docs/REFACTOR-PLAN-2026-08-17.md`。
- [ ] **依赖后续维护（暂缓）**：`@types/better-sqlite3` `7.6.13 → 9.6.0` 可单独升级验证；Electron、better-sqlite3、Lake 编辑器当前已是最新稳定版本，不重复升级。

## 已排入待办（暂不实施）
- [x] **隐藏回收站笔记本重构（删除=移动语义）**——**已完成并合并 master（2026-08-15）**。设计见 `docs/TRASH-NOTEBOOK-DESIGN.md`；含统一冲突语义（先同步者胜）、零变更早退、审计加固（资产 token/CSP/图片像素上限等），217 测试全绿。性能后续见 `docs/PERFORMANCE-NEXT.md`。

- [ ] **M5 借鉴与流畅性**：思源借鉴（模板片段 / 日记 / 命令面板 挑 1-2 项）；流畅性优化（按 M0 基线：TreeRow memo、树虚拟化、保存 debounce、图片懒加载等）。
- [ ] **优化项：本地历史分层保留（近密远疏）**：近期快照全留（如 24h），中期每日 1 份（如 7 天），远期每周/每月 1 份——替代当前"100 份/30 天"扁平策略（v3 设计 §13.1，本期不做）。

## 稳定性 / 崩溃
- [ ] **大纲「展开到 X 级」偶发崩溃（已记录，待观察）**：
  - 现象：点击大纲「展开到 X 级」时偶发 Chromium 子进程崩溃，日志为 `Network service crashed` + `GPU process exited unexpectedly (exit_code=15)` + `GPU state invalid`；重启后恢复。
  - 复现：dev 库「444」（49 个标题，H1–H3，`depth` 实测 ≤3，已排除 depth 异常）；`--disable-gpu` 下未再复现，疑似偶发 GPU/网络服务崩溃。
  - 已做防御：`OutlineController.updateToc` 对异常 `depth` 收敛到 1..6（防未来畸形数据把引导线/缩进渲染打爆）。
  - 后续（未定，待讨论）：**程序崩溃的补救 / 减少数据丢失方案**——渲染进程崩溃监听（`render-process-gone`）、GPU 禁用降级开关、写前日志/原子写、SQLite WAL checkpoint、未保存草稿兜底恢复等。

---

## Lake 内核本地化讨论（2026-08-27，待执行）

> 背景：为做「附件→音视频卡」反编译了 vendor 包 `lakex-editor-react-component`（语雀内部闭源版，0.1.2，无类型、压缩 bundle），
> 并发现已有多处 hack 依赖压缩符号/内部私有结构（`_neRef._virtualNode._instance.cardData.onTranscodeSuccess`、`$appear`、
> `uiViewProxy.rerender`、常量 `z_="ui"` 等）。用户提问「有没有必要做 lake 全量本地化」，结论见下。

### 事实核对（本地仓库身份）
| 目录 | 身份 | 关系 |
| --- | --- | --- |
| `/Users/admin/file/local-lake/lake-main` | lakejs/lake 开源版（MIT 0.4.6，github.com/lakejs/lake） | 语雀团队开源的**社区版内核**，有完整 src；**不是我们运行的** |
| `vendor/npm/lakex-editor-react-component` | lakex 语雀内部版 0.1.2 + React 封装，闭源压缩 bundle | **实际运行的内核**，含语雀定制（Drawnix 画板/mindmap/迁移/语雀 API） |
| `/Users/admin/file/local-lake/lake-editor-main` | 第三方 VSCode 插件 yuque-editor（ZhiGangCai/lake-editor） | 不是内核源码，参考价值低 |

### 结论：不建议「全量本地化」（fork lakex）
- **lakex 源码不可得**（语雀内部闭源）；lakejs 可替换但会丢功能（画板/mindmap/语雀卡片）→ 全量 fork 不现实。
- 反编译出的能力分两类：**官方扩展点**（命令/插件事件/reader 分发——本轮音视频分发走的就是官方架构，只是没文档）与
  **私有结构**（真正脆弱，集中在 `lakeRuntime.ts` 的音频卡兜底/水合/卡片工具栏几处）。
- 当前阶段（开发版、KISS）没有触发 fork 红线的条件。

### 待执行选项（A + B 一起做）
- [ ] **A. lakejs 源码当机制字典**：用 `lake-main/src` 核对/解释 Lake 内核机制（命令系统、fileReader reader 注册与分发、
      `beforeExecCommand`/插件事件、`readData` 的 `category/from/useMediaCard` 语义），把 lakeRuntime 相关注释升级为
      「源码出处」级；先验证「reader 分发」与「insertFiles 参数透传」在开源版是否同源（验证 lakejs 是否真能当字典用）。
- [ ] **B. 版本锚点 + hack 清单**：vendor 包已 pin（`file:` 引用 + lockfile，禁止随意升级）。写一份「Lake 版本锚点 + hack 清单」
      文档（或并入 HANDOFF）：逐条记录每个私有结构 hack 依赖的内部签名、对应 bundle 版本、失效后的 CDP 回归验证方法；
      升级流程 = 按清单逐项回归，而非全量重测。
- [ ] **按需最小 patch，不整体 fork**：已有先例（`patches/@xiangfa+mindmap`）。仅当功能在扩展点上完全无法实现时才 patch。

### 触发 fork 的红线（当前均未触发）
1. 出现必须 lakex 内核源码才能实现的功能（扩展点全堵死）；
2. 一次 Lake 升级碎 3+ 处 hack 且无法用扩展点修复；
3. 上游停止分发/闭源收紧。
