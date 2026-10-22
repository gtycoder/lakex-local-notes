# 移动端（Android）代码系统审查 · 261020

> 范围：`src/mobile/**`、`android/app/src/main/**`，以及 Android 端直接依赖的共享 `src/core/**`、`src/features/editor/**` 边界。
> 方式：只读静态审查。未运行测试、构建或设备验收，因此文中性能结论是代码级推断，不是设备实测。
> 结论：当前功能面已经相当完整，主要问题不是“功能没写”，而是**数据读取模型、保存生命周期、编辑面状态机**三处逐渐累积了互相补偿的防线。继续逐个补 guard 会越来越安全表象化；应删除重复防线，并重做一个核心板块。

> **261022 实施状态（持续更新）**
> - **P0 / P1 / P2-1～P2-4：已完成**。包括可等待保存、GC 维护锁、子树 CTE、小记轻量投影/虚拟列表、最小索引与批量写、标签页懒读、编辑面单一 owner、结构化命令结果、原生流式 fail-fast、路径围栏、分享限长、多维表 draft 等。
> - **P2-5：已完成**。编辑面关闭/焦点/隐藏实例改为 jsdom 行为测试；GC / syncNow / priority 改为真实操作时间线验证；契约面从实际 `bridge` 与 `nativeSqlite` 导出派生。
> - **P2-6：进行中（已完成 4 个局部切片）**。已抽 `TabSession`、小记详情缓存、S3 设置表单、编辑命令分发；`SaveCoordinator`、`TreeView`、其余 `SettingsForm`、`EditSession` 与 `MobileUsheetViewer` 尚未拆完。
> - **P3 / Mobile Data Plane v2：进行中（基础能力部分完成）**。索引、递归 CTE、小记轻量投影/虚拟列表、标签页正文懒读已落；正式 `HomeSnapshot` / `QuickNotePage` / query API、显式 Unit of Work、SaveCoordinator 抽象、旧全量读接口删除和设备性能目标仍未完成。
> - **验证基线**：截至本轮，移动端 vitest 99 文件 / 441 例、quickNotes 60 例、全库 351 文件 / 2474 例（16 skip）、TypeScript、双端构建、`check:core`、`check:mobileui`、`check:bundle` 均通过。P2-6 当前切片仍需用户验收与 Android 设备复验。

---

## 1. 总体判断

### 1.1 优点

- 数据安全语义清晰：本地真相、墓碑、恢复例外、先拉后推、清单全量声明等红线都已落到代码与测试。
- Android 原生能力边界总体正确：AssetServer、BodyStore、SecureStore、OpenAsset、SharedContent、AssetSync 都是“服务能力”，没有把业务判断塞进原生层。
- 移动端 UI/样式确实有自己的 `mb-*` 与 `src/mobile/theme/**`，没有退回桌面原语。
- 编辑器、表格、多维表、画板、手写板均已接入移动端；冷启动静态依赖与懒加载边界处理得较认真。
- 大量历史坑有明确证据和护栏，尤其键盘/面板/焦点/资源服务。

### 1.2 主要结构性问题

1. **读取模型与 UI 需求不匹配**：首页和工作区仍以“全量领域对象”方式取数，列表阶段就读取正文；树查询是 JS 全表扫描 + 逐节点扫描。
2. **保存不是可等待的事务**：`useAutoSave` 调用了 async 保存函数，却丢弃 Promise；返回/关闭流程的 `flush` 不是可 await 的。
3. **编辑面状态机重复**：文档/小记使用 `useEditSurface`，表格又复制了一套面板、键盘、关闭过渡逻辑；三套定时器叠加，测试还按源码字符串钉住实现。
4. **防线掩盖真实失败**：命令 fallback、S3 原生流 fallback、若干 `catch {}` 让用户看到“点了没反应”，而不是明确失败。
5. **部分护栏只证明“代码长得对”**：静态文本测试能证明有 `runMaintenance(`，却不能证明整段网络操作都在锁内；当前 GC 就漏了。

---

## 2. 由外到内：功能与代码逐层审查

| 层 | 现状 | 主要问题 | 结论 |
| --- | --- | --- | --- |
| 首页 / 小记 | 小记卡片、标签、筛选、排序已完整 | 首次刷新和返回首页会读取**全部小记正文**并全量渲染卡片 | P1：改成游标分页 + 视口懒读正文 |
| 知识库 / 目录 | 建、删、移、常用、图标、拖拽完整 | 每次打开工作区拉全库 folders/notes；`listNotebookTree` 为 O(N²) | P1：递归 CTE + parent/sort 索引 |
| 文档编辑 | 编辑、dock、插入、查找、历史完整 | 自动保存 Promise 被丢弃；标签页以 `pendingEditRef` 共享一次性状态 | P0/P1：单飞保存队列 + 每 tab 显式状态 |
| 表格（usheet） | 移动 chrome、公式、数字格式、键盘安全区已收敛 | 表格复制了文档编辑面的面板/键盘状态机与三段定时器 | P1：抽统一 EditSession，删除副本 |
| 多维表 | 记录面板、字段管理、分页窗口已可用 | 每次输入重算整表投影并序列化全体记录 | P1：记录草稿 + memo 投影 + 行组件 memo |
| 画板 / 手写板 | 双态、捕获、图片资产、视口记忆已落地 | 视口恢复有多重轮询；不是当前最大风险 | P2：保留，后续用内核 ready 事件替代轮询 |
| 设置 / 同步 | S3、历史、诊断、GC、回收站完整 | 云同步关闭时“清理云端”仍可出网；数字设置无法输入 0 | P0/P2：入口统一走 cloudState；设置改草稿提交 |
| 分享 / 深链 | 冷/热启动、快捷方式、键盘兜底完整 | 分享文件无大小上限，原生先复制、JS 再整段读入内存 | P1：原生流式限长后交付 |
| 测试 / 护栏 | 覆盖多，历史回归保护强 | 过多源码字符串断言，和真实不变量解耦 | P2：保留行为/设备不变量，删实现形状断言 |

---

## 3. 关键问题清单

### P0-1 自动保存失败被吞，关闭/返回不等待真正落盘

**证据**

- `src/mobile/hooks/useAutoSave.ts:12-38`：`save` 类型返回 `void`，timer 和 `flush()` 都直接调用 `saveRef.current(...)`，没有 await、没有 catch。
- `src/mobile/notebook/NotebookWorkspace.tsx:323-326`：传入的是 async `bridge.saveNote(...)`。
- `src/mobile/notebook/NotebookWorkspace.tsx:328-365`：关闭标签、关闭全部、返回首页都只调用同步 `flushAutoSave()`；该函数无法等待底层写盘。

**影响**

- 本地写入失败成为 unhandled rejection，用户界面仍可能已经关闭标签或返回首页。
- App 随后退到后台/被系统杀时，最后一段编辑可能没有落盘。
- 这与“本地是真相、绝不静默丢弃输入”的项目红线相冲突。

**建议**

- 将 `flush` 改为 `Promise<void>`，并把底层保存错误向上返回。
- 每个 note 一个单飞保存队列：同一笔记只允许一个写请求在途；新版本合并为 latest。
- 返回、关闭标签、退出编辑、进入后台统一 `await flush(noteId | all)`；失败必须留在当前界面并给出可恢复提示。
- 删除“void save + 再祈祷后续请求跑完”的调用方式。

---

### P0-2 `gcDeepCleanup` 在维护锁外执行网络和删除，且未检查云同步关闭

**证据**

- `src/mobile/bridge/sync.ts:201-248`：列出对象、读取 manifest、读取历史、删除 S3 对象全部发生在 `runMaintenance("gcDeepCleanup", ...)` 之前。
- `src/mobile/bridge/sync.ts:243-247`：`runMaintenance` 只包住“写 GC 日志”这一小段。
- `src/mobile/bridge/sync.ts:260-264`：`syncNow` 有 `mobileCloudState() === "offline"` 的零请求保护；`gcDeepCleanup` 没有。
- `src/mobile/settings/SettingsDrawer.tsx:358-365`：设置页可直接触发云端清理，没有按云同步状态禁用。

**影响**

- “关闭云同步 = 任何路径不出网”被破坏。
- 云端清理可以与正在进行的 manifest 同步并发，产生清单/对象删除竞态。
- 现有 `maintenancePolicyCoverage.test.ts` 只检查方法体里“存在一次 `runMaintenance(`”，无法发现锁没包住真实维护区间，属于假安全。

**建议**

- 整个 `gcDeepCleanup` 外层直接 `return runMaintenance("gcDeepCleanup", async () => { ... })`。
- 入口先调用 `mobileCloudState()`，不可出网时返回明确结果，不构造 S3 client。
- 测试改为行为测试：并发开始一次 sync，再开始 GC，断言二者不交错；或给锁注入时间线记录，而不是扫源码字符串。

---

### P1-1 `listNotebookTree` 有 O(N²) 风险，并读取全库而非当前笔记本子树

**证据**

- `src/mobile/data/notebookTreeRepository.ts:17-35`：无条件读取全库 folders 与 notes。
- `src/mobile/data/notebookTreeRepository.ts:38-49`：BFS 每处理一个父节点，都完整扫描 `allFolders` 和 `allNotes`。
- 工作区每次 `loadTree()` 同时调用 `listNotebookTree()` 与 `listTreeNodes()`（`NotebookWorkspace.tsx:213-218`）。

**影响**

- 深树或大库下接近 O(N²)；5000 文档已是可感成本，10 万文档不可接受。
- 打开一个笔记本却读取全部其他笔记本的数据，读写放大的来源不透明。

**建议**

- 使用 SQLite 递归 CTE，一次返回当前笔记本子树。
- 为 `folders(parent_id, sort_order)`、`notes(parent_id, sort_order)` 增加部分索引。
- 结果按 parent + sortOrder 排序；UI 只做相邻关系组装，不再扫全局数组。

---

### P1-2 首页在列表阶段读取全部小记正文并渲染全部卡片

**证据**

- `src/mobile/data/quickNotesRepository.ts:84-105`：`listQuickNotes` 先查全部行，再 `Promise.all` 为每一行读取 `.qnote` 正文文件。
- `src/mobile/MobileApp.tsx:105-110`：冷启动与返回首页都调用 `bridge.listQuickNotes()`。
- `src/mobile/home/HomePage.tsx:287-290`、`557-568`：过滤排序后直接 `map` 全部小记卡片。
- `src/features/quickNotes/QuickNotePreview.tsx:151-185`：每张卡片都解析正文、做 ResizeObserver，富文本卡片还可能懒加载内核预览。

**影响**

- 小记数量增长后，首页刷新会形成 BodyStore 桥调用风暴。
- JS 内存中同时保留所有 `.qnote` body 与预览 DOM。
- 返回首页时 `refreshAll()` 会重复付出该成本。

**建议**

- `listQuickNotes` 只返回索引字段：`id/createdAt/updatedAt/previewText/imageCount/firstImage/tags/bodyHash`。
- 正文改为视口按需读取，最多保留 2~3 条 LRU；当前编辑中的正文永不淘汰。
- 时间线使用现有 `@tanstack/react-virtual` 做变量高度虚拟列表，或先以 50 条游标分页验证收益。
- 标签索引不应要求全量正文；可直接从轻量索引行派生。

---

### P1-3 读写缺索引、批量操作逐行过桥

**证据**

- `src/mobile/data/schema.ts` 只有 search、history、orphan 三类索引；`notes`、`folders`、`quick_notes` 没有列表/树/排序索引。
- `src/mobile/data/trashRepository.ts:75-77`、`:181-188`：同一事务内逐行 UPDATE/INSERT。
- `src/mobile/data/treeRepository.ts:168-174`：排序时逐个子节点 UPDATE。
- `src/mobile/data/historyRepository.ts:202-207`：清理历史逐条删文件、逐条 DELETE。

**影响**

- 所有 `ORDER BY updated_at DESC`、按 parent 查树、回收站列表都会随库增长退化。
- 多行操作每行一次 Capacitor SQLite 桥往返，大子树删除/移动可能达到秒级或分钟级。
- 在 JS 层包了一个“事务”，但事务内仍是 N 次原生调用，不是高吞吐 Unit of Work。

**建议**

- 补最小必要索引，先以 `EXPLAIN QUERY PLAN` 验证再落。
- 引入显式 `executeSet()` 批量写入：一个事务、一次桥往返。
- 对回收站、目录移动、历史清理、批量标记使用 batch builder，并复用 `sqlParameterBatches` 控制参数上限。

---

### P1-4 标签页打开存在共享 `pendingEditRef` 竞态，恢复标签还会预读全部正文

**证据**

- `src/mobile/notebook/NotebookWorkspace.tsx:106`：只有一个 `pendingEditRef`。
- `src/mobile/notebook/NotebookWorkspace.tsx:232-245`：首次恢复会并发 `openTab()` 多个标签。
- `src/mobile/notebook/NotebookWorkspace.tsx:270-273`：哪个异步 `readNote` 先回来，哪个消费 `pendingEditRef`，而不是创建请求的那个标签消费。
- `src/mobile/notebook/NotebookWorkspace.tsx:257-285`：`openTab()` 每次读完整正文，即使该标签暂时不挂载编辑器。

**影响**

- 指定 `initialMode="editor"` 时，理论上可能把编辑态落到错误的历史标签。
- 打开工作区会并发读取多份大正文，和“只挂当前编辑器”的内存目标不一致。

**建议**

- `openTab(id, options)` 接收本次请求显式参数：`{ activate, enterEditor, requestId }`，不要共享可变一次性标记。
- 标签先保存 metadata 状态；正文按 active tab 懒加载，切换时再读取。
- `openTab` 返回 Promise 或写入 operation registry；调用方不要 `await` 一个实际不等待异步的 void 函数。

---

### P1-5 编辑面状态机重复，关闭过渡有三套定时器

**证据**

- 文档/小记：`src/mobile/editor/useEditSurface.ts:82-143` 使用 `closing`、`closingHold`、`panelHeight`、`renderedPanel`，以及 150ms / 1800ms / 2500ms 三个定时器。
- 表格：`src/mobile/usheet/MobileUsheetViewer.tsx:113-157`、`:396-444` 复制了同一套状态与三个定时器。
- `useEditSurface.ts:26` 使用模块级 `inSetback`；它是全应用共享可变状态，不是当前编辑面实例状态。
- `useEditSurface.ts:164-188` 的 document 级监听每个实例都会注册一次。

**影响**

- 文档、小记、表格各自演化，任何一步交互都可能再次不一致。
- 隐藏 keep-alive 编辑面、未来多实例时，全局 `inSetback` 有跨实例干扰风险。
- 三个时间常量是对异步动画的猜测；真正的状态变化其实可由 transitionend + 一次 watchdog 表达。
- 测试 `dockPanelFocusGuard.test.ts:139-155` 把 1800ms 和具体类名钉死，反而阻止更简单的实现。

**建议**

- 设计单一 `MobileEditSession`：一个活动 surface 只能拥有 IME/panel/selection。
- 面板关闭用 `transitionend` 或 `animationend` 驱动；只保留一个超时 watchdog 处理键盘/传感器异常。
- `surface` 通过适配器提供 `focus()`、`dismissKeyboard()`、`capture()`、`setEditable()`。
- 表格和小记只提供适配器与面板内容，不复制 dock 状态机。

---

### P1-6 内核命令失败被双层 catch 静默

**证据**

- `src/mobile/editor/execCommand.ts:21-32`：`renderer.execCommand` 和实例 `execCommand` 的异常都被吞掉，不可用时返回 `undefined`。
- `src/mobile/editor/EditorDockHost.tsx:54-69`：插入表格、插入文件又各包一层 `try/catch { /* 忽略 */ }`。
- `src/mobile/editor/EditorDock.tsx` 多处 focus/command 也使用静默 catch。

**影响**

- 用户点击“插入表格/附件”没有反应时，没有可见失败原因，也没有调试上下文。
- 对需要判断返回值的命令（例如链接）调用方无法区分 `false`、异常和 no-op。

**建议**

- `execEditorCommand` 返回 `CommandResult = { ok: boolean; value?: unknown; error?: Error }`。
- 只有“编辑器未就绪，稍后可重试”可以静默；用户触发的命令失败必须 toast 一次，并带命令名。
- 在 adapter 初始化时把跨版本 API 差异归一化，不要每次命令都做双层 fallback。

---

### P1-7 Android 原生 S3 流式失败后静默回退到 JS 字节路径

**证据**

- `src/mobile/native/s3Store.ts:172-195`：原生 `putFile` 失败后捕获异常，继续读 `Uint8Array`，再走 JS/base64 路径重传。
- `src/mobile/native/capacitorHttpHandler.ts:31-43`：大 body 会先构造成超长 binary string 再 `btoa`。

**影响**

- 一次失败可能变成两次上传和一次大对象重读。
- 失败原因被 fallback 掩盖；性能问题会被错误地表现为“同步偶尔很慢”。
- 在 Android 正式端，原生插件是随应用注册的，生产路径不应存在“原生不可用”的常态分支。

**建议**

- Android 生产只保留原生流式路径；失败直接抛出并进入同步重试/错误提示。
- Web/vitest 才使用字节 fallback；不要在 native 运行时混用。
- 如果确实需要 fallback，必须有明确开关、日志、次数上限和用户可见结果。

---

### P1-8 `AssetSyncPlugin` 的 `localKey` 没有原生路径围栏

**证据**

- `android/app/src/main/java/com/lakenotes/mobile/AssetSyncPlugin.kt:65-105`：PUT 使用 `localAssetFile(localKey)` 读文件。
- `android/app/src/main/java/com/lakenotes/mobile/AssetSyncPlugin.kt:119-203`：GET 使用同一函数写文件。
- `android/app/src/main/java/com/lakenotes/mobile/AssetSyncPlugin.kt:267`：只做 `File(filesDir/"note-assets", localKey)`，没有 canonical path 校验。
- 其他原生插件已有正确范式：`BodyStorePlugin.kt:35-56`、`AssetServer.kt:170-177`、`OpenFilePlugin.kt:42-58`。

**影响**

- 被控 WebView/XSS 或未来错误调用可通过 `../` 读写 `filesDir` 内任意路径。
- 与其他插件“同名能力却有不同安全边界”不一致。

**建议**

- 抽出统一的 native path resolver，至少限制在 `filesDir/note-assets/**` 与允许的 quick-note staging 根下。
- 拒绝绝对路径、`..`、空段、反斜杠、NUL；`getFile` 写入前再做 canonical containment。
- 补 JVM 单测覆盖 `../`、绝对路径、符号链接和合法文件名。

---

### P1-9 小记保存有三条近似实现，且 `saveQuickNoteWithImages` 漏了墓碑清理

**证据**

- `src/mobile/data/quickNotesRepository.ts:120-160`、`:162-214`、`:221-253` 是三份“写入正文文件 → upsert quick_notes → 失败恢复正文”的近似逻辑。
- 前两份/后一份在事务中都会 `DELETE FROM quick_note_deleted`；`saveQuickNoteWithImages` 的 upsert（`:202-208`）没有这一步。
- `saveQuickNoteWithImages` 同时是 `quickNotesDomain` 暴露的 T3 自动化入口。

**影响**

- 同一条小记可能一边是活跃行、一边残留删除墓碑，后续同步/恢复会出现二义性。
- 三份逻辑后续很容易再漂移（标签、图片、updatedAt、墓碑清理、错误恢复）。

**建议**

- 只保留一个 canonical `upsertQuickNoteContent`；图片保存只负责 staging 文件，然后调用同一写入核心。
- 为活跃写入统一清墓碑，测试覆盖三条入口。
- 这是典型“防线看起来都对，但重复实现让一个分支漏掉”的例子。

---

### P1-10 系统分享进入 App 时没有大小上限，且整段读入 JS

**证据**

- `android/app/src/main/java/com/lakenotes/mobile/SharedContentPlugin.kt:78-99`：复制任意 `EXTRA_STREAM`，无字节上限。
- `src/mobile/native/sharedContent.ts:43-55`：Filesystem 读出 base64 后 `atob` 成完整 `Uint8Array`。
- 图片后续还可能在 `createImageBitmap`、hash、写盘阶段产生多份内存副本。

**影响**

- 任意 App 分享超大文件可造成磁盘占用、base64 膨胀、JS OOM。
- 分享入口是外部输入边界，应比内部编辑器更严格，而不是更宽松。

**建议**

- 原生复制时按 `MAX_IMAGE_BYTES/MAX_ATTACHMENT_BYTES` 限长，超限直接返回可见错误。
- 文本设置合理上限；图片先校验 magic bytes 和尺寸。
- 长期让原生生成临时文件引用，JS 只传路径，不把大字节整段过桥。

---

### P1-11 多维表每次输入都重算全表投影

**证据**

- `src/mobile/bitable/MobileBitableViewer.tsx:253-271`：每次 render 都 `applyViewToRecords`、`buildBitableFillProjection`、`orderedTableFields`、`recordWindow`。
- `src/mobile/bitable/MobileBitableRecordSheet.tsx:44-55`：文本输入 `onChange` 每字符就 `onPatch`。
- `onPatch` → `commit` → 序列化全部 tables（`MobileBitableViewer.tsx:226-244`）→ 父级 setState → 重渲染。

**影响**

- 大表（数千记录、多字段）输入一个字符可能触发全表筛选/填色计算与整文档 JSON 序列化。
- 底部面板本来适合做局部编辑缓冲，现在却把每次击键提升为全局文档写入。

**建议**

- 记录面板维护局部 draft，失焦/停顿 150~300ms 后再 commit。
- `applyViewToRecords`、`orderedTableFields`、`fillProjection` 按 `doc/table/view` 引用 memo。
- 行组件按 record id + 字段值引用 memo，避免无关字段重绘。
- 目标：输入路径不进入全局 serialize；一次编辑停顿只产生一次正文变更。

---

### P2-1 数字设置无法输入 0，且每次击键立即写设置

**证据**

- `src/mobile/ui/settingsPrimitives.tsx:117-127`：
  `Math.max(floor, Number(e.target.value) || fallback)`。
- 历史设置中 `snapshotIntervalMinutes` 与 `cleanupIntervalHours` 都允许 0（`SettingsDrawer.tsx:349-353`），但 `Number("0") || fallback` 会把 0 当成假值替换成默认值。
- `input` 没有实际 `max` 钳制；`onChange` 每次击键都调用 `onSave`。

**影响**

- 用户无法通过输入 0 关闭自动快照/定期清理。
- 设置写入可能每字符一次，产生无意义写队列。

**建议**

- 使用局部 draft string；`onChange` 只更新 UI，`onBlur`/Enter 统一 `Number()` + clamp + save。
- 空字符串才用 fallback；`0` 必须是合法值。

---

### P2-2 `getNoteInfo` 对所有文档类型使用 Lake HTML 文本提取

**证据**

- `src/mobile/bridge/notes.ts:65-85`：`const plain = lakeHtmlToPlain(note.content)` 后统计算字数/词数。
- 但 `usheet/bitable/board` 的正文是 JSON，项目已有 `searchTextForKind` 作为正确入口（`noteRepository.ts:197-199` 亦注明不能直接对 JSON 做 Lake 文本提取）。

**影响**

- 表格、多维表、画板的属性页可能显示错误字数/词数。
- 与搜索索引使用的正文派生口径不一致。

**建议**

- 按 `note.kind` 调 `searchTextForKind`，或直接把 `text_cache` 作为统计来源。
- 属性统计与搜索共用同一派生逻辑，不另写解析器。

---

### P2-3 Secret/SQLite legacy 迁移层过多，属于可删除的过渡债务

> **261022 实施状态：已完成删除**。SecretStore 现在只走 Keystore（生产）或 localStorage（Web/vitest）；IndexedDB 密钥读取、旧 SQLite 快照迁移、旧正文目录扫描全部删除。用户确认不再有新设备需要承接。

**证据**

- `src/mobile/native/secretStore.ts:60-170`：IndexedDB 旧密钥读取 → localStorage 加密副本 → Keystore 迁移 → native 已存在时再清旧副本 → remove 双清。
- `src/mobile/native/nativeSqliteMigration.ts:34-100`：启动每次调用检查旧 IndexedDB sql.js 快照并尝试迁移。
- `src/mobile/bridge/context.ts:78-84`：每次 DB 初始化还做旧正文 schema 检测与旧正文目录重置。

**判断**

这些防线针对真实历史问题（IndexedDB 不可靠、正文迁移），但一旦当前安装已完成迁移，就会长期留在启动热路径。项目规则是“不为可重建旧数据写兼容”，所以这里应设一次明确的迁移截止版本，而不是永久叠层。

**建议**

- 发一个迁移版本：启动时完成 Keystore/SQLite 迁移并写 schema version。
- 下一个版本删除 IndexedDB snapshot 读取、localStorage secret 迁移和旧正文目录扫描。
- 迁移截止后直接重置开发库，保留“重新填写 S3 密钥”的明确提示。

---

### P2-4 `stageAssetWrites` 的回滚只理解内存层，不理解磁盘既有文件

> **261022 实施状态：已完成**。`AssetWriteDeps` 新增 `read(key)`，覆盖写之前读取真实磁盘前态；回滚时恢复旧字节，只有此前确实不存在才删除。桌面/移动同步与小记资产写入点均已接线。

**证据**

- `src/mobile/native/assetWrites.ts:17-37`：`previous` 只从 `deps.memory.get()` 取。
- `src/mobile/native/assetWrites.ts:46-60`：内存无值但磁盘已有同名文件时，回滚会 `remove(key)`。

**影响**

- 如果覆盖式写入一个磁盘已有、内存未加载的资产，而后续 DB 事务失败，回滚可能删掉原本仍被引用的文件。
- 内容寻址使“同名同内容”概率较高，但这不是可以依赖的原子性证明。

**建议**

- 回滚依赖注入 `read(key)`，或在写入前 native 做临时文件 rename，不要用“内存是否为空”推断磁盘前态。
- 或者禁止资产覆盖写；内容寻址路径若命中，直接视为幂等成功。

---

### P2-5 护栏测试过度绑定实现形状，且会制造假安全感

> **261022 状态：已完成。** 已新增 `useEditSurface.test.ts`，把关闭占位、transitionend/watchdog、外壳高度恢复和隐藏实例隔离改为行为测试；`syncGc.test.ts` 用真实操作时间线验证 GC / syncNow / priority；静态扫描仅保留为登记与调用点报告。

**证据**

- `src/mobile/editor/dockPanelFocusGuard.test.ts:139-155` 直接断言源码里存在 `1800ms`、`closingHold`、特定 CSS 字符串。
- `src/mobile/maintenancePolicyCoverage.test.ts:88-118` 只检查方法体里是否出现某个 `runMaintenance("op"`，没有检查它是否包住真正的工作。
- `src/mobile/contractSurface.test.ts` 自述静态扫描会被别名调用漏掉。

**影响**

- 合理的重构（例如 transitionend 替代 1800ms）会先被源码字符串测试拦住。
- 真正的错误区间（GC 网络操作未加锁）却可以通过测试。

**建议**

- 保留少量行为不变量：面板底部贴视口、内容视口恒定、相同输入产生相同状态。
- 并发锁用时间线/注入队列测试验证“无交错”，不要扫方法体。
- API 面改为从 TypeScript 类型或生成清单派生；静态正则只做报告，不做唯一门禁。

---

### P2-6 巨型组件已经阻碍局部推理

> **261022 状态：进行中。** 已完成 `TabSession`（`useNotebookTabs`）、小记详情缓存（`useQuickNoteDetailCache`）、S3 设置表单（`useS3SettingsForm`）和编辑命令分发（`useEditorCommandDispatcher`）四个局部切片。剩余重点是 `SaveCoordinator`、`TreeView`、`SettingsDrawer` 其余资源/历史/诊断状态、`EditSession` 与 `MobileUsheetViewer`。

规模（不含测试）：

- `NotebookWorkspace.tsx` 1049 行、17 个 effect；
- `HomePage.tsx` 789 行；
- `EditorDock.tsx` 779 行；
- `MobileUsheetViewer.tsx` 686 行；
- `SettingsDrawer.tsx` 621 行。

**影响**

- 单个 render 同时拥有数据、路由、手势、保存、浮层、焦点、动画与时序。
- 每次修一个用户反馈，最容易再加一个 ref/flag/timer，而不是修复状态模型。
- 这也是 “防线越来越多” 的组织原因。

**建议**

- 先按状态所有权拆，不按视觉像素拆：`TabSession`、`SaveCoordinator`、`EditSession`、`TreeView`、`SettingsForm`。
- 拆完后再删重复 `try/catch`、ref、timer；不要先做无语义的文件搬家。

---

## 4. 过度防御清单

| 防线 | 看似保证 | 实际问题 | 建议 |
| --- | --- | --- | --- |
| 150ms / 1800ms / 2500ms 三套关闭定时器 | 键盘、面板、动画都能兜住 | 三个常量互相猜测；真实状态应由动画/视口事件驱动 | 只保留 transitionend + 一个 watchdog |
| 文档、表格各一套面板/IME 状态机 | 每个编辑面独立可靠 | 两套逻辑已开始漂移，测试绑死实现 | 统一 EditSession + surface adapter |
| 模块级 `inSetback` | 阻止焦点回调重入 | 全应用共享，跨隐藏/多实例有污染风险 | 改为当前 session 的局部 ref/AbortController |
| 命令双层 try/catch 并返回 undefined | 不让异常打断 UI | 用户点击无反应且无诊断 | 返回 CommandResult；用户命令失败可见 |
| Android S3 原生失败后回退 JS/base64 | “总有路可走” | 掩盖原生故障，大文件双倍内存/流量 | 生产 fail-fast，fallback 只限 Web/test |
| IndexedDB → localStorage → Keystore 多层迁移 | 旧密钥不丢 | 长期启动复杂度与多点清理 | 设迁移截止版本，下版删除 |
| 批量 executeSet 失败后逐条重放 | “不整批丢失” | 破坏单事务原子性，部分成功更难恢复 | 保持事务失败即失败，重试整批 |
| 数字输入每次自动 fallback/clamp + 立即保存 | 防止非法设置 | 0 无法输入，写入抖动 | draft + commit |
| 源码字符串测试 | 防止回归到旧写法 | 锁定实现，不证明行为 | 行为测试/设备不变量 |
| 原生路径围栏 | 防止读写任意文件 | 这是必须保留的真安全边界 | 保留并统一到 AssetSync |
| 清单资产全量声明、hash 守卫、墓碑 | 防跨端 GC/复活/丢编辑 | 真业务不变量 | 保留，不要“简化” |
| AssetFs 的 mkdir + 一次重试 | 修复 Android 目录创建竞态 | 有明确设备证据的兼容修复 | 保留 |

---

## 5. 推荐重设计板块：Mobile Data Plane v2

> **261022 状态：进行中，尚不能标记完成。** 已具备最小索引、子树递归 CTE、小记轻量投影/虚拟列表和标签页正文懒读；但正式移动端读模型、分页 query API、显式 Unit of Work、统一 SaveCoordinator 与旧全量接口清理仍未落地。以下目标继续作为后续架构验收口径。

### 5.1 第一性原理

移动端 UI 实际需要的不是“全库对象”，而是四类投影：

1. **首页快照**：笔记本摘要、计数、常用、少量小记摘要。
2. **工作区树**：当前笔记本子树的节点元数据。
3. **时间线页**：一页小记摘要，不含正文。
4. **单个正文**：只有当前打开/可见对象需要正文与编辑器实例。

当前实现把“列表投影”和“正文领域对象”混在一起，导致全量读取、重复刷新和大量防线。正确的切分是：

- **读模型只返回 UI 真正需要的字段**；
- **正文按需加载，并受 LRU 约束**；
- **写操作通过显式 Unit of Work，一次事务、一次桥往返**；
- **保存是可等待、可重试、可观测的 Promise**。

### 5.2 目标结构

```text
UI / Query Hooks
        │
        ▼
MobileReadModel
  ├─ HomeProjection        (notebook counts / favorites)
  ├─ WorkspaceTreeQuery    (recursive CTE, current notebook only)
  ├─ QuickNotePageQuery    (cursor page, no body)
  └─ DocumentMetaQuery     (tab metadata, no body)
        │
        ▼
SQLite + projected indexes      BodyStore (files) + AssetStore

UI Commands
        │
        ▼
MobileCommandLayer
  ├─ validate once at command boundary
  ├─ UnitOfWork.executeSet()  (one tx / one bridge call)
  ├─ BodyCommit               (tmp + fsync + rename)
  └─ SaveCoordinator          (debounce / single-flight / flush Promise)
```

### 5.3 读模型契约

```ts
type Cursor = { updatedAt: string; id: string };

interface HomeSnapshot {
  notebooks: Array<{ id: string; title: string; icon: string | null; docCount: number }>;
  favorites: Array<{ id: string; title: string; updatedAt: string }>;
}

interface NotebookTreeSnapshot {
  notebookId: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    kind: "group" | "note";
    title: string;
    icon: string | null;
    sortOrder: number;
  }>;
}

interface QuickNotePage {
  items: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    previewText: string;
    imageCount: number;
    firstImage: string | null;
    tags: string[];
    bodyHash: string;
  }>;
  nextCursor: Cursor | null;
}
```

关键点：`QuickNotePage` **不带 `body`**，`DocumentMetaQuery` 也不带 `content`。正文是独立读取的资源。

### 5.4 SQL 与索引

最小索引集合：

```sql
CREATE INDEX IF NOT EXISTS idx_notes_active_parent_sort
  ON notes(parent_id, sort_order) WHERE trashed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_active_updated
  ON notes(updated_at DESC) WHERE trashed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_folders_active_parent_sort
  ON folders(parent_id, sort_order) WHERE trashed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quick_notes_active_updated
  ON quick_notes(updated_at DESC, id DESC) WHERE deleted_at IS NULL;
```

工作区树使用递归 CTE，返回当前子树，不再把全库交给 JS：

```sql
WITH RECURSIVE subtree(id, parent_id, kind) AS (
  SELECT id, parent_id, 'folder' FROM folders WHERE id = ? AND trashed_at IS NULL
  UNION ALL
  SELECT f.id, f.parent_id, 'folder'
    FROM folders f JOIN subtree s ON f.parent_id = s.id
   WHERE f.trashed_at IS NULL
  UNION ALL
  SELECT n.id, n.parent_id, 'note'
    FROM notes n JOIN subtree s ON n.parent_id = s.id
   WHERE n.trashed_at IS NULL
)
SELECT id, parent_id, kind FROM subtree;
```

小记页使用 keyset cursor，不使用 offset：

```sql
SELECT id, created_at, updated_at, preview_text, image_count,
       first_image, tags_json, content_hash
  FROM quick_notes
 WHERE deleted_at IS NULL
   AND (updated_at < ? OR (updated_at = ? AND id < ?))
 ORDER BY updated_at DESC, id DESC
 LIMIT ?;
```

### 5.5 写侧 Unit of Work

不要把每个 repository 操作再包一层泛化 bus；保留领域明确的命令，但每个命令内部统一收集 `BatchOp[]`：

```ts
type BatchOp = { statement: string; values: unknown[] };

async function commitTreeMove(db: MobileDb, ops: BatchOp[]): Promise<void> {
  await db.executeSet(ops); // 单事务、单桥往返；失败直接抛
}
```

规则：

- 一个用户动作 = 一个 `UnitOfWork`；
- 同一事务内所有行语句进入 `executeSet`；
- 批失败不回退为逐条重放；
- 正文文件在 DB 提交前完成，失败由调用方决定补偿；
- 写入边界只做一次业务校验，repository 不重复做 UI 已经保证的字面量校验。

### 5.6 SaveCoordinator

```ts
interface SaveCoordinator {
  schedule(noteId: string, snapshot: EditorSnapshot): void;
  flush(noteId?: string): Promise<void>;
  cancel(noteId: string): void;
}
```

不变量：

- 每个 note 同时最多一个保存请求；
- 新快照到来时合并，不排队 N 个旧快照；
- `flush(noteId)` 返回真正落盘 Promise；
- 返回/关闭/进入后台必须 await `flush`；
- 保存失败保留当前界面并提示，不允许 UI 先假装成功。

### 5.7 迁移步骤

1. **部分完成**：索引已加；正式 query API 尚未抽出，当前 UI 仍直接调 bridge 查询。
2. **部分完成**：小记轻量投影、虚拟列表与可见正文 LRU 已完成；`HomeSnapshot` / `QuickNotePage` 与 keyset 分页仍未完成。
3. **基本完成**：工作区子树已走递归 CTE；标签页已 metadata-only，正文按活动页懒读。
4. **行为部分完成**：`useAutoSave.flush()` 已可等待且调用方会 await；显式 SaveCoordinator 抽象尚未建立。
5. **未完成**：旧 `listNotes` / `listQuickNotes` / `listNotebookTree` 仍存在并被生产路径使用，尚未切到正式读模型后删除。
6. **未完成**：尚未形成统一 `MobileEditSession` + `EditorAdapter`，表格编辑面仍独立演进。

### 5.8 验收目标（建议值，需设备实测）

- 5,000 文档冷启动首页列表查询 ≤ 100ms；不为列表读取正文文件。
- 100,000 文档库的工作区树查询 ≤ 500ms，不再把全库 rows 送到 JS。
- 小记列表首屏只读取 0 份正文（摘要能显示）；进入视口后按需读取。
- 返回首页后不重复读取全部小记正文。
- 本地保存 P95 ≤ 50ms；`flush()` 可观测、可等待、失败可见。
- 目录/回收站批量操作使用一次 `executeSet()`，桥调用数与节点数无关。

---

## 6. 建议执行顺序

### 第一批：先修真实风险，不碰大架构

1. `gcDeepCleanup` 全段入维护锁，并先判 `cloudState`。
2. `useAutoSave.flush` 改 Promise，返回/关闭/退出前 await。
3. `AssetSyncPlugin` 增加 canonical path 围栏。
4. SharedContent 原生流式限长。
5. `NumField` 改 draft + 明确 0 值。
6. `getNoteInfo` 按 kind 派生纯文本。

### 第二批：修数据热路径

1. 增加索引与 recursive CTE。
2. 首页/小记改轻量投影 + 分页/虚拟列表。
3. 多行写操作改 `executeSet`。
4. 标签页正文懒加载。

### 第三批：重构编辑面

1. 抽出 `MobileEditSession` + `EditorAdapter`。
2. 删除 `useEditSurface` 里的三级定时器与模块级 `inSetback`。
3. 表格接入同一状态机，删除重复面板/键盘时序。
4. 把源码字符串护栏替换为行为/设备不变量。

---

## 7. 不要做的事

- 不要先加另一个内存缓存层；先修索引和投影。
- 不要为了兼容旧开发数据继续长期保留 IndexedDB/SQLite 双迁移。
- 不要把移动端和桌面 schema/repository 合并；只共享策略与纯函数。
- 不要继续用新的 `try/catch + fallback` 掩盖原生或内核失败。
- 不要把新的源码文本匹配测试当作行为正确性的证明。
- 不要重排已定稿的信息架构；本轮重构只改数据流、状态所有权和失败语义。

---

## 8. 结论

当前移动端不是“需要再加几道防线”，而是已经进入**防线互相补偿**的阶段。最值得做的不是继续补 `try/catch`、timer、ref 和 fallback，而是：

1. 先把保存和云端清理这两条数据安全路径修成可等待、不可静默失败；
2. 再把首页、树、小记列表改成真正的移动端读模型；
3. 最后统一编辑面状态机，删除表格重复实现和三套关闭定时器。

**推荐主重构：Mobile Data Plane v2。**  
它是当前收益最高、风险最可控、最符合“本地真相 + 大库性能 + 简单可维护”方向的重设计；编辑面统一状态机作为紧随其后的第二阶段。
