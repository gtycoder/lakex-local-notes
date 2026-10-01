# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接 · 260929 · 多维表功能扩展（V01–V04 + T01/T04/T02A + 单级分组/UI2 + 260929-OPT + T02B.1/T02B.2/T02B.3）

> 写给完全没有上下文的新会话。**本轮的方案、进度、修改记录、会话结论全部在 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`（下称「专项文档」）**：先按 README → HANDOFF → AGENTS 读总上下文，再**完整读专项文档**，然后按它的 §8 顺序继续；**本文件不展开专项细节**，专项会话结束前必须回写专项文档 §11/§12/§13。

### 当前批次 · 260930-AI-P0（已实施，本轮提交）
- 目标：为产品接入**可配置供应商**的 AI（P0 只做 OpenAI / OpenAI 兼容），**结构按多供应商切换预留**（新增一家 = core 目录加一条 + 设置下拉自动出现，IPC/渲染层不动）。
- 架构红线：Key **只在主进程**（渲染层 CSP connect-src 只放行 self/本机，已挡死外发）；密钥走 `SecretCipher`（safeStorage/Keychain，**fail-closed**）；`ai_settings` 是**独立 settings key**，不入同步/S3/备份。
- core：`src/core/aiProviders.ts`（`AI_PROVIDERS` 目录 + 设置规整/脱敏/合并；视图只给 `hasApiKey`）。
- main：`electron/ai/aiClient.ts`（官方 `openai` SDK + 任意 OpenAI 兼容 baseURL；流式/连通性/错误归类；可注入 factory 便于单测）；`electron/ipc/registerAi.ts`（`ai_get_settings` / `ai_save_settings` / `ai_test_connection` / `ai_chat`（handleEvent，`ai:stream` 推流）/ `ai_cancel`）。
- IPC 同步四处：`registerAi.ts` + `preload.cjs` + `native.ts` + `webApiServer.ts` 的 `WEB_METHODS`（有测试卡一致性）。
- 依赖：`openai@^7.25.0`（Apache-2.0、0 依赖、CJS；主进程 external 自动派生）。
- UI：设置页新增「AI」分类（供应商 / 模型 / Base URL / API Key / 温度 / 测试连接）+ `settingsSearch` 条目；渲染层 `src/lib/ai.ts`（load/save/test/runAiChat 流式/cancel）。
- 真实端验证（mock OpenAI + 隔离实例 + CDP）：保存设置 → `aiTestConnection` `{ok:true}` → 流式对话 deltas `["hello"," from"," mock"]`、最终文本 `hello from mock`；主库 `ai_settings` 落盘为 `enc:v1:` 密文、**无明文 Key**。
- 门禁：tsc / vitest **1523 passed / 16 skipped** / check:core 74-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。
- 动作入口：编辑器**选区浮动工具栏「AI」** → `AiAssistantDialog`（预设 润色/译成中文/译成英文/总结/自定义 → 流式输出 → 复制 / 替换选区；**结果不自动改写正文**，由用户决定）。真实端 CDP：拖选文字 → 工具栏出「AI」→ 对话框带入选区文本 + 5 预设 → 生成 → 流式 `hello from mock`。
- **P1 已完成**：①供应商切换（目录加 DeepSeek / 自定义 OpenAI 兼容端点；按 `editableBaseUrl` 收口 Base URL；切换即按该家默认初始化）②顶栏「更多」→「AI 助手」入口（无选区也能用，默认「自定义」）③对话**多轮**（消息线程 + 追问）。真实端 CDP：切 deepseek 自动建配置（`https://api.deepseek.com/v1` / `deepseek-chat`）；顶栏入口默认「自定义」；两轮追问 `echo:写一句问候` / `echo:再翻译成英文`。
- **④ 的诚实结论（未做到替换）**：模态对话框会折叠内核选区 ⇒「替换选区」三次尝试（DOM Range 恢复 / 浏览器 insertText / 内核 insertAtSelection）**都退化为『插入到原选区起点』**，且内核 Cmd+Z 未恢复改动。**按钮已改名「插入到光标处」**，不再承诺替换。真正替换需用内核 modelRange：`engine.transformDOMRange` + `renderer.kernel.createModelRange` 构造后走 `insertAtSelection(format, data, modelRange)`（契约 §5.8）。**260930 续**：已按此写适配并把 modelRange 作第三参传入，实测**直接 no-op（文档毫无变化）** ⇒ 取值形状未对齐；**已回退到可用的插入路径并删掉该适配**。再做需运行时打断点确认 `transformDOMRange` 返回的真实结构。
### 当前批次 · 260930-LOCK（已实施，本轮提交并推送）
- 用户 260930：只读锁做成**文档级、按类型统一**的入口，并让"锁"真正落到**内核层**（不能只隐藏工具栏）。
- **目录栏右键**加入口「锁定（只读）/ 解锁」（与 重命名/历史版本/属性 同组）；`toggleNoteLock(targetNoteId?)` 泛化 ⇒ **不必先打开**文档即可锁；`Sidebar` 增 `lockedNoteIds` / `onToggleLockNote`。
- **目录行锁标识** `.tree-row-lock`：行尾常驻小锁。踩坑：`.tree-row` 是**固定 4 列 grid**，插第 5 个子元素会把「⋯」挤到下一行（用户报换行）⇒ 列定义 4→5，且**锁格每行都渲染**（未锁为空）保证「⋯」恒为末列。
- **画板内核级只读**（vendor LOCAL-CHANGE #22）：`DrawnixBoardCore` 原来只在 `afterInit` 设一次 `board.options.readonly` ⇒ **已打开**的画板锁定后仍可编辑（思维导图还能加节点、画布仍可编辑）。改为 `React.useEffect([board, readOnly])` 运行期同步；宿主 `BoardEditor.handleCoreChange` 另加 `readOnlyRef` 兜底。**重建 vendor dist（chunk 增删改，需一并提交）**。
- **表格内核级只读**：上游 `@fortune-sheet/react` 的 `InputBox` 只按**行/列级** `rowReadOnly/colReadOnly` 判定，不看全局 `context.allowEdit` ⇒ 锁定时输入框仍 `contentEditable=true`（能敲字、提交被内核丢弃）。在**已有 patch** 里加 `context.allowEdit === false ? false : …`，用 `patch-package` 重建 `@fortune-sheet+react+1.0.4.patch`（注意 `patch-package` 会调 x86 git，需 `PATH="/usr/bin:…"`）。
- **状态栏「已锁定」可点解锁**（方案 B）：**只有锁胶囊可点**（`button.document-statusbar-lock` + `pointer-events:auto`），点开 `Popover`「本文档已锁定（只读）／解锁」；「表格」「同步状态」保持**纯展示、不可点**（可选中文字）。App 传 `onUnlock`。
- **表格只读工具栏**（260930 续）：只读时工具栏只留**视图类**——批注查看 / 定位条件 / 查找（`TOOLBAR_ITEMS_READONLY`）。依据内核 `allowEdit` 门禁：加粗/对齐/边框/合并/排序/筛选/冻结/链接/快速公式/批注增删改全部直接 return，留着就是"点了没反应的死按钮"；`cell-image` 是**插入图片**（写操作）故只读下不出现（查看已有图片走点单元格里的图片，菜单只读时已去「删除」）。
- 护栏：`sidebarContextMenu.test.ts` · `boardEditorMount.test.ts` · `sheetEditorMount.test.ts` · `desktopStatusBar.test.ts`。
- 真实端 CDP：目录栏锁**未打开**的文档 → 树行出现小锁 → 打开即只读；画板 `board.options.readonly` false→true→false；表格 `contentEditable` 未锁 true / 锁定 false 且真实按键进不去；状态栏点表格/同步**无浮层**、点胶囊出浮层、点「解锁」生效。
- 门禁：tsc / vitest **1515 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。

### 收口 · 260930-按文档保存状态（已提交 `a640af2`）
- `useSavePipeline` 的 `saveState` 由**全局单值**改为**按文档** `saveStates: Record<noteId, SaveState>`；`setSaveState(noteId, state)`；App 的 `getDocumentStatus` 只取**活动文档**那条（缺记录时回落到该标签的 `dirty`）。⇒ 后台文档保存不再污染当前文档状态栏。
- 顺带删除死状态 `lastSavedAt/setLastSavedAt`（全仓无消费者）。
- 改动：`useSavePipeline.ts` · `useDocumentTabs.ts` · `useTabLifecycle.ts` · `App.tsx`；新增 1 条「按文档隔离」单测。
- 门禁：tsc / vitest **1508 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。**不改**保存/落盘/revision 语义（只改状态归属）。
- 已提交 `a640af2`。

### 修复 · 260930-状态栏闪烁（已提交 `9866024`）
- **现象**：当前文档底栏状态在「保存中 ⇄ 待保存」高频摆动（~2s 一次），看着一直闪。
- **根因**：一个隐藏的**表格 tab**（keep-alive）里 `<Workbook onChange>` 是**内联箭头**（每次 render 新身份），而 FortuneSheet 内核的 onChange effect **依赖该身份** ⇒ 每次 render 都回调 onChange ⇒ 无条件 `scheduleSave()` → `onDirty` → **全局** `saveState` 变脏 → render → 再回调，形成 dirty↔saving 死循环；而状态栏的 saveState 是**全局单值**，于是当前多维表的状态栏被隐藏表格的churn带着闪。
- **修法**：SheetEditor 给内核传**稳定身份**的 `handleWorkbookChange`（`useCallback([])`，逻辑走 `workbookChangeRef` 指向最新闭包），函数体逐字不变、行为等价，只断掉"身份变化→伪回调"这一环。
- **验证**：真实 dev 实例（9222）修复前每 2s 一次 `dirty→saving→dirty`；修复后 6s 内只剩一次 `local-only`，表格 tab 从 `[dirty]` 变干净。门禁：tsc / vitest **1506 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；新增 1 条身份护栏。
- 已提交 `9866024`。

### 当前批次 · 260930-BTCHROME（已提交 `5864845`）
- 多维表**右上角「更多」菜单**（视图页签行最右；`BitableViewBar` 新增 `trailing` 槽）：**搜索 / 导出为 CSV / 锁定当前文档（只读）**；搜索从工具条移入菜单（内联查找框仍在工具条下方）；锁定复用文档的 `setNoteLocked`。
- 接线：App 的 `toggleNoteLock` / `exportNoteById(noteId,"csv")` → DesktopLibrary → MultiTabEditor → BitableEditor（新增 `locked` / `onToggleLock` / `onExportCsv`）；`bitableViews.css` 新增 `.bt-viewbar-trailing`（baseline 138→141）。
- 门禁：tsc / vitest **1506 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；真实端 CDP：菜单=搜索/导出为 CSV/锁定当前文档（只读），搜索出内联框，锁定后「添加记录」禁用且菜单变「解锁当前文档」，解锁后恢复可编辑（「导出为 CSV」因弹系统目录框未自动点击，仅验存在）。
- 已提交 `5864845`（与 SIDEMENU/CSV 同一提交）。

### 当前批次 · 260930-SIDEMENU（已提交 `5864845`）
- 目录栏右键菜单优化（用户 260930）：① 「新建文档/新建表格/新建数据表/新建画板/新建分组」收进**「新建」子菜单**（复用 Overlay `Submenu`，同一组创建动作只占一行）；② 右键菜单**去掉「打开文件位置」**（属性弹窗 `NoteInfoDialog` 仍保留）。
- 门禁：tsc / vitest **1503 passed / 16 skipped** / check:core 73 文件 0 违规 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；真实端 CDP：笔记右键 = 新建/重命名/历史版本/属性/导出/删除（无「打开文件位置」），「新建」展开为 5 项；笔记本右键同类。
- 已提交 `5864845`。

### 当前批次 · 260930-CSV（已提交 `5864845`）
- 用户 260930 定调：**只做 CSV 导入导出（D02 JSON 不做）**；导出菜单**按文档类型拆分、不混用**；**彻底删除「导出为原生 Lake」**；CSV 用**主流通用格式**（Excel 通用）；sheet/board 先做**占位**（表格 CSV/Excel、画板 PNG/SVG，逻辑后续）。
- 已实施：新增 core `src/core/bitableCsv.ts`（UTF-8 BOM + CRLF + RFC4180 导出；首行表头 + 列映射 + 坏格丢弃的导入）；bitable 右键/⋯「导出为 CSV」+ 工具栏「导入 CSV」（映射对话框 `BitableCsvImportDialog`）；新增 `export_bitable_csv` / `pick_import_csv` 两个 IPC；导出菜单按 kind 拆分并删除 Lake 导出。
- 门禁：tsc / vitest **1501 passed / 16 skipped** / check:core 73 文件 0 违规 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。
- **真实端 CDP 已做**（隔离实例、按端口精确回收）：CSV 导出真实 IPC 落盘（BOM/CRLF/`"甲, 乙",TRUE`/无磁盘名）；右键导出菜单 bitable=CSV、doc=Markdown/HTML/PDF、sheet=CSV·Excel 占位、board=PNG·SVG 占位，**全页无「原生 Lake」**；bitable 工具栏有「导入 CSV」。**未自动化**：导入的文件选择走原生 NSOpenPanel，导入端到端未跑（core 有单测）。sheet/board 占位无逻辑。明细只在专项 §11/§12/§13。
- 续：新增**多维表「导出为压缩包（含附件）」**（自写 store 方式 ZIP，无新依赖）：zip 内含 `{表名}.csv` + `附件/{文件名}`，附件/图片真实文件一并打包、同名自动 (2)、CSV 指向归档内相对路径；真实端用 ditto/bsdtar/Python `zipfile` 校验通过（Apple Info-ZIP `unzip` 不认 UTF-8 名属工具限制）。
- 已提交 `5864845`。

### 当前批次 · 260930-AR01（已实施，用户授权合入推送后停止）
- 隔离分支 `codex/bitable-ar01`，worktree `/Users/admin/file/local-lake/lake-notes-electron-worktrees/bitable-ar01`；本批为编辑会话/写入/导航历史/快捷键/只读草稿/共享预览所有权收口。**实际改动及验证只在专项 §13 最新记录 / §17.11。**
- 全量测试 **1441 passed / 16 skipped**、tsc/core/CSS/原语/双端构建通过；11 个新行为测试。**真实 Electron 验证不完整：列宽 redo 断言失败（未定位产品或驱动原因），后续只读草稿与预览完整流程未走完；Android 未实测。功能保持待验收。**
- 用户明确“不要验证了直接合并到 master 并推送远程”，且授权与另一会话只读审计文档一起提交。保留 `docs/NON-BITABLE-ENGINEERING-AUDIT-2026-09-30.md` 与 `docs/audit-evidence-2026-09-30/`，不实施其中方案。
- **已合入 master 并推送成功**：`9535ed91`「fix(bitable): AR01 会话安全收口并记录整体工程审计」，包含本批代码/讨论记录与另一会话审计文档。已停止后续验证和开发；AR02–AR04 未开始。提交授权不代表功能验收通过。

### 当前批次 · 260930-AR02（第一段已实施，待验收；未提交/未合 master）
- 用户确认按**路线 B（有边界的内部重构）**继续推进。本批从 AR02 起步，只取「字段删除 / 单元格写入 / 记录新增 / 附件回填」这一切口：新建 `src/core/bitableMutations.ts`（`stripFieldFromView` / `deleteBitableField` / `setBitableCellValue` / `setBitableRecordValues` / `appendBitableAttachments` / `addBitableRecord`，无变化一律返回原引用），`BitableEditor.tsx` 的内联删除清理与各写入动作全部改调 core；**附件回填改为捕获发起上传时的 tableId**（切表后不再写到「那时的当前表」）。
- 隔离分支 `codex/bitable-ar02`（主工作树，未新建 worktree）：全量 **1451 passed / 16 skipped**，tsc / check:core（70 文件 0 违规）/ ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；新增 9 例纯函数单测 + 1 条挂载护栏，并更新 3 处只认旧内联写法的源码护栏指向新单一来源。
- **未提交、未合 master、未推送**；未跑 Electron CDP 真实端点与 Android；AR02 的 core 按依赖拆分、AR03/AR04 未开始。功能保持待验收。明细只在专项 §11/§13。

### 260930-AR03/AR04（已证实热点优化 + 真实端性能前置）
- 用户要求「继续推进到 AR04」。已做 AR03 的**已证实热点**：AR-F5 选区逐格命中改行/列索引、AR-F6 `relationTargetRecords` 改按 `records` 引用缓存、字段序收敛到 `orderedAllTableFields`；新增 `relationIndex.test.ts`。
- 同一分支 `codex/bitable-ar02`：全量 **1453 passed / 16 skipped**、全门禁 + 双端构建通过；CPU 前置基准：3000×15 选区 228.8ms→1.2ms、3000×3000 关联 389.4ms→0.7ms。
- **AR04 真实端已完成**：行为验收 7/7 通过（关联 chip / 选区四边 / 列菜单删除字段：移除+对侧降级+数据保留+视图配置清理）；压测工具 scripts/bitable-stress.mjs，目标 5000×20 打开 **12.42s / 84.8 万 DOM / 395MB / 首次点选 2.25s**，10000×20 = 24.8s/1.69M/1.34GB，20000×50（100 万格）200s 未完成，**50000×50 因正文 >32MiB 直接存不下**。结论：CPU 热点已消除、**DOM 全量渲染是瓶颈**，行虚拟化需单独立项，等用户拍板。
- 仍未提交/未合 master；未跑 Android；AR02 的 core 拆分与 AR03 结构拆分未做（无实测收益前停止）。

### 260930-B（AR-F7 续已实施，待验收；未提交/未合 master）
- 表单提交双向关联镜像、复制关联字段不继承配对、字段类型变更清视图引用、「加进本组」系统时间护栏、动态日期在切回可见/聚焦时刷新计算时点；core bitableMutations.ts + 4 例新单测。
- 全量 **1457 passed / 16 skipped**、全门禁 + 双端构建通过。仍未提交/未合 master。
- C（结构拆分/循环依赖）与 D（真实端收尾/Android）未实施；见专项 §17.12。

### 260930-D（真实端收尾 + 整体 UI 回归）
- 列宽 redo 澄清为驱动假象（真实端 260/180/260，通过）；关 tab 保留通过；整体 UI 回归 13 项通过（统计/五视图/添加记录/新增字段/隐藏列/关联选择器/填色/筛选/搜索入口）。
- 只读草稿 IPC 仍未定论（需先提交输入再锁定复验）；共享预览仅 jsdom 覆盖；Android 未做。仍未提交/未合 master。

### 260930-S0（非多维表审计 S0 全部实施 + F03/F04 元数据尾收口，待验收；已合入 master 本地 42ad41b、未推送）
- 分支 codex/audit-s0（从 6a0ec68 开出）。唯一权威进度在 docs/NON-BITABLE-ENGINEERING-AUDIT-2026-09-30.md §12。
- 已完成：F09 · F10 · F07 · F05 · F11（第一批）· **F06 移动 create/save 分离（missing/gone 明确拒绝）** · **F01 保存失败不关闭/淘汰/锁定** · **F02 revision 快照入队前绑定** · **F04 恢复只按真实 gone 判只读 + 普通保存不隐式复活** · **F17 容量基准断言现契约**（第二批）· **F04 元数据写边界 fail-closed（删除 `revivePurgedIfNeeded` 隐式恢复最后入口）** · **F03 reload 取消按文档作用域（不同文档互不取消，全库同步用自己的 run id）**。
- 门禁：tsc 通过、全量 vitest **1486 passed / 16 skipped**、check:core 70 文件 0 违规、git diff --check 通过、opt-in 容量基准实跑通过；**桌面真实端 CDP `scripts/e2e-audit-s0.mjs` 16/16**、**安卓真实端 `scripts/e2e-f06-android.mjs` 6/6**（emulator-5554 + debug APK）。**绝不启动路线 C（正文入 SQLite）**；S1 DocumentSession 也未批准。
- 已知取舍：F06 的 bridge.saveNote 对"无墓碑的新 id"仍可初始化；F03 竞态在真实 hook（jsdom 受控延迟）层验证——`window.lakeNative` 被 contextBridge 冻结，无法向真实 App 注入读延迟，真实端覆盖两篇不同文档各自历史恢复都生效。

### 260930-S0 后续（C/B/A 捕获契约，已实施，待验收；已合入 master 本地 42ad41b、未推送）
- C：生命周期持久化闸门收敛为 `src/core/lifecycleFlush.ts` 单一来源（962f4b0）。
- B：新增 `scripts/profile-editor-input.mjs`（opt-in）实测多 MB 文档每键整篇序列化 ≈ 数十 ms；据此实施**捕获契约**（f994ee2 + 24a21cc）：EditorTab 每键只通知"有变更"、正文改在保存/草稿/关闭时按需 capture；删除 `MultiTabEditor.contentCache/reloadKeysRef` 第二份正文。
- 效果：2MB 单键 57.9→10.0ms、长任务 1761ms→0；桌面 e2e 17/17；全量 vitest 1490 passed / 16 skipped。
- 诚实边界：profile 脚本就绪判定不严（只信量级）；自愈竞态无真实端注入点；doc 每键不 setState 大字符串。

### 260930-S0 后续 D（F14/F15/Bitable，已实施，待验收；已合入 master 本地 42ad41b、未推送）
- F14：抽出 EditorErrorBoundary，错误边界给可点的「重试」（换 mount generation 重建子树），删除「切换标签即可恢复」空话；补 jsdom 行为测试（e6aab97）。
- profile：scripts/profile-editor-input.mjs 就绪判定加固（先等目标 tab active + 内容长度两轮稳定），可作可信性能基线（e6aab97）。
- F15：Sheet/Board/Bitable 一改动即标脏 + 注册按需序列化，关闭/退出/淘汰/锁定走捕获契约，消除「改完 <800ms 就关」丢最后编辑（87e5e4e + c726e23）。
- **F13 明确不做**（仅状态显示不一致、无数据影响）；**§6.1-#2 不做**。editorChangeGuard 仍在用，未删。
- 门禁：全量 1493 passed / 16 skipped；桌面 e2e 17/17。诚实边界：Sheet/Board/Bitable 的编辑→关闭未做自动化真实端（待人工抽验）。

### 260930-S2（过时路径清理，已实施；已合 master 本地、未推送）
- secretCipher.decrypt：非 enc:v1 不再返回明文，改为提示重配 + 空串（44eb4a0）。
- ssrf：删除只被自身测试调用的 assertSafeRemoteHost 预解析入口（44eb4a0）。
- syncAdapters：删除旧 FakeStore 的 `?.` 可选兜底，测试补齐完整 port（88c3f3f）。
- schemaInit：改用当前完整 DDL，删除逐列 ALTER / 旧 trigram 重建 / 旧 notes→tree seed 迁移（7986f22）。
- **暂缓（审计标注为条件删除）**：assetServer 旧 file/null origin —— 需真实浏览器核对 Origin:null/file:// 消费者后再删。
- 门禁：tsc / 全量 1488 passed / 16 skipped / check:core 71 文件 0 违规 / diff --check；全新 workspace 桌面 e2e 17/17。

### §6.1 剩余性能项测量（260930）
- **#4 音频兜底全工作区扫描**：CDP 计数 `document.querySelectorAll(音频选择器)`——1 标签 ~11 次、8 标签 ~53 次（≈6.6×标签数/前 6s）。**已修**（5c70b1c）：改为 `mount.querySelectorAll`，全局扫描 53→0、每次范围降到约 1/N；重试/清理逻辑不变。
- **#5 代码块水合扫描**：`host.querySelectorAll('.ne-codeblock')` 计数——8 标签总计仅 1 次（仅可见实例扫、交互期 defer）。**未测到高频，不作为问题**。
- **#6 保存后孤儿/历史 refs 扫描**：裸文档保存 ~1ms；500 资源 + 100 历史快照 ~7ms（增量 ~6ms/次）。量小，暂不改。
- 脚本：scripts/profile-save-orphans.mjs、scripts/profile-scan-counts.mjs（均 opt-in、隔离实例）。
- **状态：非多维表审计指定项全部实施完毕并合入 master 推送**；剩余项已归位（F16/S3 正式待办；F12/F13/S1/§6.1-#2 不做；F08 走 A、跨介质窗口有意不修；assetServer 旧 origin 待真实浏览器验证）。

### 当前会话 · 260930-ARCH（仅文档，待讨论）
- 用户要求多维表功能扩展暂告一段落，先只读评估整体代码与架构，再讨论是否需要大规模重构；**本轮不实施代码**。
- 当前源码 `ae1cfda`（条件填色、统一选色与筛选面板优化），工作树在本轮开始时干净、仅一个 master 工作树；本地 `origin/master` 跟踪引用同 HEAD（未联网 fetch）。**条件填色已提交**，下方旧描述的“未提交”是历史状态；功能验收状态不擅自变更。
- **完整讨论稿与证据只在专项文档 §17**：建议有限内部重构，不改正文格式/数据边界/五视图/资产与同步；优先解决隐藏标签写事件、只读写入/发布、撤销分类、重复预览宿主，并补行为测试。已确认问题尚未修复，AR01–AR04 未开始。
- 本轮重跑 tsc、全量 vitest（1430 passed / 16 skipped）、core/CSS/原语门禁；仓库外 React/jsdom + CPU 样本 9 用例确认现有问题。**未 build / CDP / Android 实测，未改产品代码、未提交或推送**。下一步先讨论专项 §17.10，不自动继续旧功能队列。

### 一、任务目标
- 用户 260928 启动「多维表功能扩展」专项：按专项文档 §8 顺序**逐编号实施、每个编号单独验收**——V01 多视图工作台 → V02 看板 → V03 画册 → V04 日历 → T01 列级统计 → **T03 多级分组（260929 废弃，改为单级）** → T04 语义排序 → T02A 基础字段 → T02B.1/.2/.3 关联 → T06 表单 → D01/D02 导入导出。
- 期间用户三次现场追加/纠偏（均已落地，细节见专项文档 §13）：
  1. 图片与附件**拆成两个字段类型**（image 复用附件值模型、上传侧只收图片）；图片预览范围**恒为单个单元格**（两列图片就是两类，绝不跨列合并）；**磁盘名绝不外显/不可编辑**。
  2. 表单视图加「编辑表单 / 预览表单」双模：编辑态**恢复 v1 原形态**，「填写表单」= 直接跳预览 tab（不做独立弹层）；已配置默认进预览、未配置默认进编辑。
  3. 看板图片字段上卡出**缩略图**（不显示文件名）；字段类型选择改 **2 列网格**（不分「基础/高级」组）；**创建/修改时间必须能参与筛选与排序**（这是修掉我之前设的假边界）。

### 二、已完成内容（提交状态见「提交」列）
| 编号 | 内容 | 提交 |
| --- | --- | --- |
| — | 专项文档建立 + HANDOFF §3.9 登记 | `c2aa11a` |
| V01 | 多视图工作台：视图类型开放集合 + 未知类型安全回退；视图壳拆 `BitableViewBar` / `bitableViews` | `b17f652` |
| V02 | 看板：单选字段分栏（空栏保留 / 未分组）、卡片、拖拽只写分组字段值、看板配置面板 | `b17f652` |
| V03 | 画册：封面取第一个图片附件、裁剪/适应、常规/紧凑、卡片字段 | `b17f652` |
| V04 | 日历：月网格 + 跨天展开 + 单选配色 + 拖拽保持时长平移（全程本地日期语义） | `b17f652` |
| 追加批 | image 字段类型；画册/表格/看板/表单预览单单元格；展示名守卫；表单双模 | `b17f652` |
| F01/F02/F03 | 文档图片预览改取**正文**（虚拟渲染下 DOM 不全）；附件命名审计；表单编辑态回退；看板缩略图 | `b17f652` |
| T01 | 列级统计：底栏统计行（通用/数字/日期口径）、视图级配置、随筛选现算 —— 260929 先整体删除、**同日恢复**（用户确认分组后需要按组统计） | `dbe70ae`（同日恢复） |
| T03 | 多级分组：最多 3 级 + 拖动调优先级 + 层级缩进（`groupRecordsTree`）——**260929 已废弃并回退为单级** | `9b80ede` → 本次回退 |
| T04 | 语义排序：单选/多选「选项顺序 / 选项逆序」；日期文案早→晚/晚→早 | `9b80ede` |
| T02A | 基础字段：布尔/链接/评分/进度/创建时间/修改时间（含默认值与进度配色） | `6f046df` |
| T02A-fix | **系统时间字段打通筛选/排序/分组**（记录级取值口径 `bitableFieldValue`）；其中「统计」部分随 T01 于 260929 回退 | `ef75e96` |
| style | 字段类型选择改 2 列网格；顺带修 T02A 漏 import CSS 的 bug | `3a39030` |
| V05 分组样式 + T01 恢复 | 分组头改**整行 56px**（折叠钮 + 分组值 + 每列统计，首列 `N 条记录`）；每组记录后 40px 圆形「加进本组」、顶级分组间 20px；列统计恢复并保留「无配置不显示空条」；**表格内「添加」统一为同一颗圆形 + 钮**（新增字段 / 添加记录 / 加进本组）；分组头**分组值优先占位、首列统计下限 80px（云端实测）、过长省略**，并修掉长文本撑开 `table-layout:auto` 造成的列错位；**V05 续四条**：列选中点外即清、分组汇总行固定 36px、分组头每列都有汇总位、底部汇总栏**常驻**（24px 贴视图底）+ 状态栏上移让位；**分组「加进本组」的 + 有独立行高（32px）但不画行线**（不嵌边线）**、已分组时表底那个 + 隐藏**；**T01 汇总方式逐字对齐云端 config**（只有第一列默认「记录总数」、其余默认空白且占位仅 hover、统计格 = 白底 chip + ▾、按字段类型给选项，进度无求和） | **已提交（待验收）** |
| 浮层定位 | **贴底翻上方**统一：垂直口径收敛到 `placeVertical`/`usePopoverPosition`；多维表日期/单选/展开面板/行菜单 + 标签/卡片右键改走实测定位 | `05b6a96` |
| T02A 续 | 评分：空星**实心** + 选中星对齐云端金（`--lake-rating-star`）；进度：**只留条 + 百分比**（数值框删除），可拖动/键盘可达/Delete 清空、只读不接指针 | `4e19df0` |
| 260929 UI 细节 | 分组重做为**单级白卡 + 边框/圆角**（删除多级树、添加分组、拖动优先级、层级样式）；`+` 行下边线清除；表底重复“共 N 条记录”清除；目录把手增加全局离开清理兜底 | **已提交（待验收）** |
| 260929-UI2 分组底衬 + 底栏收口 | 复刻云端「浅灰分组通道 + 白卡」：表头下 20px 间隙、加进本组/组间/表下空白统一走新令牌 `--lake-bg-subtle`（**不分组时表格下方空白同款**）；**数据表选择区 `.bt-tables` 也改用同一个灰**（原先更深的 `--lake-bg-block`，左右像两套风格）；卡片收口移到该组最后一条记录（+ 行在卡外）；汇总文案「共 N 条」；**删掉表底「已选择 N 个单元格」横条**（其信息改为**多选时**落在底栏最左格：「选择 N 行」/「选择 N 个单元格」，单选不触发）；**底栏底色也改成同一块灰**（与表格区融合、靠 1px 分隔线分界），**汇总行（底栏 + 分组头）去掉行内竖线做整行处理**、光标所在的一格加重到 `--lake-bg-block`；**格线/卡片边线改挂更浅的 `--lake-border-2`**（对齐云端 `rgb(244,245,245)`）；**修「选无统计仍显示共 N 条」**（去掉分组头首列的 `?? "count"` 兜底），**左下角计数改 `shownRecords.length`**（= 当前视图正在展示的记录数，只随筛选/搜索与多选变，与汇总项的实时计算是两套独立逻辑）；**两处添加入口的 ＋ 号改编号列独占一格 + 居中**（落在行号正下方）；**分组面板的删除键改为行尾 🗑「删除分组」**（与筛选/排序行同一套）；**修格内「两层边框」**（单元格自己有 2px 选中环时不再叠输入框焦点环），**链接格改云端形态**（展示文本 + 右端 🔗 图标，点图标用本地浏览器打开，双击编辑，不再常驻输入框）；底栏即最底下那条，状态栏改**实测贴住底栏上沿**（`--lake-bitable-status-bottom`，重叠 0px） | **已提交（待验收）** |
| 260929-OPT 阶段代码优化 | 用户要求「先整理/优化当前阶段代码」：修 6 处真 bug（进度颜色面板打不开 / 表单题序被丢 / 系统时间列查重失效 / 系统时间列复制为空 / 搜索绕开展示口径 / 删字段留脏配置）+ `statForField` 原型链加固 + 令牌合规 + 单一来源 | **已提交（待验收）** |
| T02B.1 关联基础模型 | 同一文档内跨表关联：`BitableRelation` 模型 + 统一解析 `BitableDisplayContext`（可选 ctx）+ 字段配置（目标表/允许多个）+ `RelationCell` chip；失效不崩不级联；CDP 真实端点验收通过 | **已提交（待验收）** |
| T02B.2 单向关联 | 关联选择器：搜索 / 目标记录列表 / 已选计数 / 新建记录 / 取消·确认（草稿确认前不写正文）+ 跳转目标记录；多选·单选均可用；复用 `.bt-option-*` 原语；CDP 真实端点验收通过 | **已提交（待验收）** |
| T02B.3 双向关联 | 反向字段（默认名 = 来源表名 + 来源字段名）+ 回填已有值 + 双向镜像唯一写入口 `applyRelationMirror` + 删一侧解除配对（对侧降级单向、数据保留）；CDP 真实端点验收通过 | **已提交（待验收）** |
| 移动端多维表只读补齐 | 布尔/链接/评分/进度/关联/系统时间的**只读控件**（非裸文本）+ 非 grid 视图回退提示；Android 模拟器 CDP 验收通过（见 §8） | **已提交（待验收）** |
| 数据表行操作浮动 | 「⋯ / 删除表」改绝对定位浮层、悬停浮现、不占流内位置（名称/计数不再被挤压）；CDP 实测无位移 | **已提交（待验收）** |
| 字段类型弹出选择 | 「编辑字段」的字段类型由内联大网格改弹出选择器（一行触发器 + Popover 内同一 2 列网格）；弹窗不再被撑高 | **已提交（待验收）** |
| 类型左对齐 + 选项回车切换 | 字段类型触发器文字左对齐（不再被 button 默认居中）；选项输入框回车 = 当前选项完成并切到下一个，已是最后一个才新建 | **已提交（待验收）** |
| 状态栏「一个表有一个没有」修复 | 底栏位置实测改量**粘性 `td`**（`<tr>` 是 static，纵向溢出时算出负值把状态栏顶出屏幕）；两表实测都显示 | **已提交（待验收）** |
| 关联字段目标表占位 | 「编辑字段」里 `关联数据表` 的占位文案「选择数据表」不再是下拉选项（原先 `value:""` 当选项、空值还被判为选中并打勾）；改走 `SelectMenu` 的 `placeholder`，选项只留同一文档内的其它数据表 | **已提交（待验收）** |
| T02B.4 关联数据范围 + 选择器改版 | 字段配置加「从视图筛选记录」（不勾选=目标表全部记录；勾选=绑定目标表的一个视图，候选只列该视图筛选后的记录）；关联选择器由单元格小气泡改**全局大弹窗**（两个 tab：所有可关联记录 / 已选 N 条；全局搜索 + 右侧筛选·排序；主区域 = 目标表整表；页脚 已选·取消·确认）；按用户要求**不做「添加记录」**，并一并撤销行内「跳转目标记录」 | **已提交（待验收）** |
| 新建数据表默认结构 | 默认表改为**只建 1 列「文本」+ 3 行空白记录**（不再预置单选/日期列）；「新建数据表」、新建多维表文档首表、空正文兜底共用 `createDefaultBitableTable` 单一来源 | **已提交（待验收）** |
| 关联选择器图片/附件真渲染 | 选择器整表里图片出缩略图（可点开预览本格）、非图片附件出「📎 文件名」chip（>2 折成 +N）；资产 URL 收敛为 `bitableAssetUrl` 单一来源（单元格/看板/画册/选择器共用） | **已提交（待验收）** |
| 横向页签原语（B 墨线 + 计数徽标） | 用户从 5 个形态里选定 **B**：`kit.css` 正式原语 `.ln-tabs`（文字 + 选中变强调色 + 与文字等宽的 2px 下划线；数量进 `.ln-tabs__count`、右侧动作 `.ln-tabs__action`），**已全量落地**（关联选择器 / 回收站 / 历史面板 / 表单编辑·预览）；legacy `.ln-tabs` 从 `components.css` 整段收编进 kit（单一来源），过渡变体 `.ln-tabs--seg` 已删除；`.seg` 只剩取值选择/图标开关 | **已提交（待验收）** |
| 表头「新增字段」的 ＋ 贴左列（260930） | 加号原来被 `th` 的浏览器默认 `text-align:center` 甩到表尾空白区正中（实测那一格 604px 宽、加号在 x=965）。改为 `.bt-grid th.bt-th-add { text-align: left; padding-left: 8px }`：**只对齐内容、不动列宽**（该格仍吸收表格剩余宽度，数据列不被撑开），实测加号左缘 = 最后一列右缘 + 8px | **已提交（待验收）** |
| 选项编辑「添加」不再自动全选（260930） | 「添加选项 / 选项回车新建」时新行原先把默认名 `选项 N` 整块选中 ⇒ 输入框里一块系统蓝底（用户报「为什么会有蓝色的底色」）。改为：`focusOptionInput` 只 `focus()` + **光标落末尾**（去掉 `el.select()`）；新选项**留空**、默认名改走 `placeholder`；保存时空名按位置兜底成「选项 N」（`bitableEditor.css` 补 `.bt-input::placeholder { color: var(--lake-text-4) }`）。实测新行 `selection=[0,0]`、键入即选项名、空着保存落成「选项 7」 | **已提交（待验收）** |
| 列宽自由设置 + 行高不被内容撑高（260930） | ① 列宽改为**以字段 `width` 为准**：`auto` 布局下 `<col style="width">` 只是「至少」，附件 chip 实测把 180 撑到 **413** ⇒ 每个格子加行内 `max-width`（`columnWidth(field)`；表头 / 记录格 / 分组统计格 / 底栏统计格四处）。② **行高绝对不被内容撑高**：`.bt-grid th, td` 补 `white-space: nowrap`（日期列 80px 时 `2026-09-07` 折行把行高 36→48），日期/时间格出省略号、文本格 `text-overflow: ellipsis`。③ 拖拽下限 **80 → 40**（用户：「可以设定一个比较小的下限值」） | **已提交（待验收）** |
| 附件按**文档类型图标**展示（260930） | 附件不再显示文件名 chip / 缩略图：单元格 = **小类型图标** + hover 出**名称气泡**；展开面板 = **大类型图标**（名称仍在卡下方，**名字被省略号截掉时 hover 同样出全名气泡** —— 同一套 `useNameTip`，用 `scrollWidth > clientWidth` 判截断，没截断不弹）。图标用 **lucide-react**（内核 sprite 实测 325 个 symbol 无一个 file/pdf/doc 系，云端的彩色页图标不在 kernel bundle 里 ⇒ 无法复用），类型判定走 core 新增的 `fileKindOf()`（单一事实源），配色新增 `--lake-file-*` 令牌；**图片字段仍是缩略图**，但 **hover 名称气泡与附件同一套**（用户追加）。**移动端同步落地**（附件字段 = 小图标 + 名称；触屏没有 hover，名称保留），Android 模拟器实测通过；**关联选择器整表、看板卡片、画册卡片也复用同一套**（`AttachmentChipList` 单一来源：选择器不再自养「📎 文件名」chip；看板卡片不再只显示图片；画册卡片不再是一串文件名）——三处都只出**类型图标/缩略图**，名称靠 hover 气泡（用户：「看板视图不展示名称了」「画册视图的附件也要改」）| **已提交（待验收）** |
| 样式大统一（260930 审计，三批） | **第一批**：菜单项收编 `.ln-menu__item`、图标按钮收编 `.ln-iconbtn`（`--compact`/`--accent`）、新增 `.ln-ellipsis`；**第二批**：`.ln-ellipsis` 落到 16 处、「选中行」三元组收编进 `.ln-row.is-selected`、面板头合并；**第三批**：新增 `.ln-imgfill`（图片填满+裁切，4 处）+ 收编**关联选择器搜索框**到 `.ln-input__field` + `.b3-list-item__text`/`.quick-note-file-chip__name` 换 `.ln-ellipsis`（10 个调用点）+ 删死代码 `.mobile-qn-img` 三条。审计脚本 `.css-audit/audit-{lookalike,primitives}.mjs`：命中 **29 → 16**、重复族 **46 → 39** | **已提交（待验收）** |
| 关联选择器视图投影（260930） | 绑定视图=字段顺序+隐藏字段+只读筛选/排序/分组基线；未绑定=默认表格视图字段顺序但全部字段/记录；本机额外筛选/排序不写回；后加字段动态进入 | **已提交（待验收）** |
| 关联/历史/回收站只读渲染统一（260930） | 关联选择器值改走主表格 `CellEditor readOnly`（选择/多选色块、布尔复选框、评分星、进度条+百分比）；历史快照、回收站/锁定文档继续共用只读 `BitableEditor → CellEditor` | **已提交（待验收）** |
| 单向/双向关联拆成真实字段类型（260930） | `relationOneWay` / `relationTwoWay` 两个真实 `BitableFieldType`；去掉 `relation.mode`；类型选择器与字段面板分别用单链/双向箭头图标；建对/解绑/镜像按 type 判断 | **已提交（待验收）** |
| 列菜单隐藏列 + 文本颜色加深（260930） | 列菜单新增“隐藏列”快捷项；列文字颜色改用独立深色调色板，不再复用浅色选项背景 | **已提交（待验收）** |

| 260930 筛选精准重做 | 字段类型操作符矩阵（文本/数字/日期/单选/多选/复选/附件/关联）、具体日期 + 15 种动态日期、根组 AND/OR、最多 2 层子组；新增共享 `BitableFilterEditor` 与递归 `evaluateFilterNode`，关联选择器同步复用，后续条件着色可复用 | **已提交（待验收）** |
| 260930 条件填色 + 统一选色 | 单元格 / 整行 / 行侧 / 整列；复用筛选单规则编辑器与求值器；`cell/row/column` 按钉钉候选顺序做 alpha 混色，`rowSide` 独立（色条 6px）；应用内所有选色统一为内核 70 色实色卡 + 最近使用 + 自定义；**最近使用按入口独立分桶**；下拉互斥；桌面 + 移动只读；另修 Lake 文档跨节点选区遮住行内背景（内核选区统一映射半透明 `--lake-select-bg`）；全门禁 + 隔离 Electron CDP 实测通过 | **未提交（待验收）** |
| 260930 选色交互收口（三项 + 默认项 + 浮层/子菜单分流） | 应用内统一色板整体缩小；进度字段颜色改为全宽输入式触发器；列菜单「文本颜色」保持子菜单语义（选色后保持预览、点空白关闭）；填色色板保持普通浮层语义（点面板其它位置即关）；所有色卡统一默认项——文字类「默认色」，背景类「无背景色」，填色无背景色时保留规则但不参与投影 | **未提交（待验收）** |
| 260930 筛选面板横条修复 | 筛选面板不再写死 820px 宽度，改为占满 Popover 内容区，消除 818px 内容区对 820px 子元素的 2px 横向溢出；空筛状态收为 320px 且隐藏无意义的“删除筛选”页脚 | **未提交（待验收）** |

### 三、当前状态与门禁
- 分支 `master`；**本批（上表所有行）已提交并推送**：代码提交 `681f148`（多维表专项收口，含 260928–260929 各批）、文档提交紧随其后；`origin/master` 已同步。更早的 23 个本地提交（`1494331..1fe4d22`）也一并推上去了。**上表各行的「已提交」只表示已入库，功能本身仍是「待用户验收」**。
- 更早的 V05/T01、评分/进度修复（`4e19df0`）、T01 回退（`d2eeb79`）、浮层定位（`05b6a96`）本来就在仓库里；本轮用户 260929 明确授权「合并 master 并推远程」，已 `git push origin master`。
- 多级分组源头为 `9b80ede`；本次已删除多级树/多级面板/层级样式，单级分组、按组统计和「加进本组」保留。
- **260930 六条已提交并推送**（用户明确授权「提交 master 并推送远程」）：代码 `486b032`「feat(bitable): 列宽/行高 + 附件类型图标 + 选择器·看板·画册统一（260930 六条）」，文档 `dd0b3e9`「docs(handoff): 记录 260930 多维表六条改动」；上表各行状态见「提交」列。更早的 260928–260929 各批仍是 `681f148`（同样已入库、**功能待验收**）。
- **260930 筛选精准重构与待提交收口批次已合并提交**：代码 `7dd81ba3`「feat(bitable): 筛选精准重构与 260930 多维表收口」，包含筛选字段矩阵/动态日期/AND OR/2 层子组、共享 `BitableFilterEditor`，以及与筛选共用文件且已全绿的前置关联/只读/隐藏列收口改动；功能仍待用户验收。条件着色后续直接复用 `BitableFilterRule` / `evaluateFilterNode` / `BitableFilterEditor`。明细回写专项文档 §11/§12/§13。
- **260930 条件填色 + 应用内统一选色已实现、未提交**：`BitableView.fillRules` 视图级配置 + 40 条上限；复用筛选 `BitableFilterRule`/编辑器/求值器；钉钉同款候选混色；应用内所有选色统一为内核 70 色实色卡 + 最近使用 + 自定义，**最近使用按选项色、进度色、列文字色独立分桶；填色只分“最近背景色”（cell/row/column 共用）和“行侧色”两桶，并持久化到 localStorage**；Lake 编辑器继续走自己的 `LakeColorBoard` 适配器且样式/渐变不变；桌面与移动只读均接投影；所有 SelectMenu 同一时刻只保留一个打开。**填色规则颜色已从旧 `soft-*` token 改为 hex，旧临时规则不再兼容，需重选颜色。** 全门禁与隔离 Electron CDP 已通过，等待用户验收；明细见专项文档 §11/§12/§13。
- 门禁全绿：`tsc --noEmit`✓ · `vitest run` **1430 passed / 16 skipped**✓（筛选重做 + 条件填色 + 选色交互收口）· `check:core` 0 违规✓ · 桌面 + 移动构建✓ · `ui-metrics`（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · `cssLayers`+`uiPrimitives`✓ · `git diff --check`✓。
- 每个编号都做了 **CDP 真实端点验收**：`env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA=<临时目录> LAKE_ASSET_PORT=<独立端口> electron --disable-gpu --remote-debugging-port=<独立端口> .`，用 Node 24 内置 WebSocket 直驱 `Runtime.evaluate`。

### 四、当前问题 / 遗留（都不阻塞继续）
1. **待用户验收**：V02–V04 + 三批追加需求 + T04 + T02A + **260929 T02A 续（评分星/进度条）+ 浮层定位统一 + V05 单级分组样式（含续四条）+ T01 恢复 + 260929 单级分组/目录把手/重复计数细节优化 + 260929-UI2 分组底衬与底栏收口 + 260929-OPT 阶段代码优化 + T02B.1 关联基础模型 + T02B.2 单向关联 + T02B.3 双向关联 + T02B.4 关联数据范围/选择器改版 + 新建数据表默认结构 + 关联选择器图片/附件真渲染 + 关联选择器视图投影 + 关联/历史/回收站只读渲染统一 + 单向/双向关联拆成两个真实字段类型 + 列菜单隐藏列 + 文本颜色加深 + 横向页签原语（B 墨线+计数徽标） + 移动端多维表只读补齐 + 数据表行操作浮动 + 字段类型弹出选择 + 类型左对齐/选项回车切换 + 状态栏「一个表有一个没有」修复 + 关联字段目标表占位修复 + 260930 表头「新增字段」＋贴左列 + 260930 选项编辑「添加」不再自动全选 + 260930 列宽自由设置 + 行高不被内容撑高（下限 40）+ 260930 附件按文档类型图标（单元格小图标 + hover 名称气泡 / 展开面板大图标 + 文件名截断时 hover 出全名 / 图片格 hover 同名气泡 / 移动端同步 / **关联选择器、看板卡片、画册卡片都复用同一套**且卡片不显示名称）+ 260930 筛选精准重做（字段类型操作符矩阵 / 15 种动态日期 / AND·OR / 最多 2 层子组 / 共享 `BitableFilterEditor`）+ 260930 条件填色（四模式 / 钉钉 alpha 混色 / 内核 70 色实色卡 + 自定义 / 移动端只读）+ 应用内统一选色（Lake 适配器不变）**（专项文档 §11 看板里均为「待验收」）。V01 已验收通过；T03 多级分组已废弃。**T01 列级统计：当天先删后已恢复，并定稿为底部常驻栏**（专项 §11/§13）。
2. 已知口径/边界（用户知情、可接受）：
   - **移动端**：看板 / 画册 / 日历 / 分组仍**回退为只读表格 + 明确提示**；**260929 已补齐多维表只读控件**（布尔/链接/评分/进度/关联/系统时间，不再是裸文本）并**在 Android 模拟器上完成 CDP 验收**（见 §8「多维表只读」）。
   - 分组当前最多一级；历史多分组正文只保留第一级配置（当前产品语义，不做兼容迁移）。
   - 文档图片预览：同一张图在正文出现两次时，双击第二次仍定位到第一张（**张数正确**，定位精度小瑕疵）。
   - 评分是整星（不做半星）；进度是 0–100 整数；图片字段只按扩展名/MIME 判图片（不做内容嗅探）。
   - 表单暂不渲染 `formDescriptions`（逐字段描述）；日历的当前月份是本机展示态（不写正文）。
   - **关联**：T02B.2 选择器支持多选/单选、搜索、新建目标记录、跳转；T02B.3 双向关联建反向字段并双向同步、删一侧降级为单向且数据保留；关联列的筛选/排序/分组/统计当前按「空」处理（专项 §6.4 最小侵入口径）；目标表被删只展示失效、不级联。
3. 与专项无关的上线收尾遗留仍在 §3（真实端双端同步实测、Android 真机验收、发布说明）。

### 五、下一步计划
1. 等用户对第 4 节第 1 条的范围验收（**代码已提交并推送**，验收只看功能；发现问题直接改 + 追加提交）。
2. **条件填色已提交 `ae1cfda`，功能验收状态不变**；260930 当前会话先做整体架构讨论（专项 §17），不自动开始修复或继续扩展。
3. 按专项文档 §8 顺序本应继续 **D01 CSV → D02 JSON**，但 **260929 用户明确「先不做导入导出」**，D01/D02 暂缓；期间已完成**移动端多维表只读补齐 + Android 模拟器验收**（见 §8）。恢复导入导出时从 D01 开始。
4. 每个编号的固定动作：core 纯函数（`src/core/bitableDoc.ts`）+ 各视图独立组件/独立 CSS 文件（**必须**在 `src/styles/cssLayers.test.ts` 的 FILES/BASELINE 登记）+ 单测 + 全门禁 + CDP 真实验收 + 回写专项文档 §11/§12/§13。

### 六、本轮踩过的坑（关键；长期条目已并入 §4）
1. **改完 `src/**` 必须先 `npx vite build`，再跑 scheme 模式的验收**：`LAKE_RENDERER=scheme` 服务的是 `dist/`，不重建就是在**旧 bundle** 上验收，会出现「改了没生效」的假象（本轮踩过一次，白折腾一轮）。
2. **CDP 查询必须限定可见元素**：`.bitable-editor:not(.fn__none)`。多 tab keep-alive 下，裸 `.bt-viewbar` / `.ln-popover` 会点到隐藏 tab 的菜单。
3. **CDP 依附的窗口 `document.hidden === true`** ⇒ `loading="lazy"` 的图片**不加载**（`naturalWidth=0`）。验收封面/缩略图要临时 `removeAttribute("loading")` 才能看到上屏；**不是产品缺陷**（同一 URL 的 `fetch`/`new Image()` 都 200）。
4. **新增 CSS 文件必须由使用它的组件 `import`**：本轮 T02A 建了 `bitableFieldCells.css` 却漏 import，那批新单元格样式一直没加载（元素在、样式空），直到做 2 列网格发现 `grid-template-columns: none` 才暴露。
5. **`cssLayers.test.ts` 基线是硬上限**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081（headroom = 0）** —— 再加任何一条声明都会让用例变红；本轮所有新样式都进了新文件（`bitableViews.css` / `bitableKanbanView.css` / `bitableGalleryView.css` / `bitableCalendarView.css` / `bitableFormView.css` / `bitableFieldCells.css`）。
6. **读落盘要轮询**：应用层自动保存有防抖，改完立刻 `readNote` 会读到旧值甚至空对象（本轮多次误判「没保存」）。
7. **同一文件被多批改过时没法按批拆 commit**（`git add -p` 的补丁手术风险高）⇒ 本轮代码合成一个 commit、文档单独一个；不要为了「一批一 commit」硬拆。
8. **在 DSH 宿主里跑 CDP 验收必须加 `--no-sandbox`**（260929 新增）：否则 Chromium 自带 sandbox 初始化报 `Operation not permitted`，连锁 `NetworkService/GPU crashed`，最终 `FATAL: GPU process isn't usable. Goodbye.` 整个实例退出（§6 的验收命令本轮首次执行即因此失败）。加 `--no-sandbox`（userData/端口本就隔离）后正常。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 44 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交；**260928 多维表批次已由用户明确授权「提交代码」（仅提交、未推送）**）。移动端另有铁律见 **§8.0**。

## 3. 待办与已知问题（上线后 backlog）

> 当前主线是多维表专项（见 §0 与专项文档）；以下是专项之外真正保留的低优先项。

1. **同步 warning 结构化**：`SyncReport.warnings` 从字符串改为 `{ kind, noteId?, filename?, message }`，与 UI 展示/点击定位一起做。同步红线区，单独立项。
2. **画板 AI 助手**：只接画板卡的 `generate` 钩子；模型、endpoint、Key 代理方式待产品决定。内核绿色文本绘图徽标无注入点，不做。
3. **UI 低优先**：目录树窗口化（先量到真实卡顿再立项）·设计词表继续裁剪·画板 `Wt is not a function` 根因定位。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. **搜索整体重构**：FTS/短词/增量搜索不并入普通维护，单独立项。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。

10. **样式大统一（260930 审计，三批已完成；③⑤ 已记录、暂缓不做的理由见下）**：用户要求「找出散落各处的相同操作模式，做成正式原语统一起来」。
    **已完成**（详见 §0 行 + AGENTS §3#14 的单一来源清单）：
    ① **菜单项** `.ln-menu__item`（顶栏下拉 / 右键菜单 / ＋菜单 / 多维表列菜单，legacy 选择器一并收编，overlay −29 条）；
    ② **图标按钮** `.ln-iconbtn`（新增 `--compact` 22×22 / `--accent` 主色 hover 两个正式变体；目录栏 12 处 + 目录行动作 + 多维表 6 处，chrome −39 / bitableEditor −63 条）；
    ③ **单行省略** `.ln-ellipsis`（新工具类，27 个调用点；**flex/宽度属于布局、仍留业务规则**）；
    ④ **选中行** 三元组收编进 `.ln-row.is-selected`（页签溢出菜单行 / 设置左导航，overlay 菜单 hover 随①）；
    ⑤ **图片填满裁切** `.ln-imgfill`（4 处；顺带删掉死代码 `.mobile-qn-img` 3 条）；
    ⑥ **输入框** 关联选择器搜索框 → `.ln-input__field`；面板头（回收站/历史）合并；卡片标题随③收编。
    **明确暂缓（已记录，不做）**：
    - **顶栏 `.toolbar__item` 并进 `.ln-btn`**：两者只差 1px 高与 padding（26/8 vs 27/11），但**顶栏几何被 `--shell-*` 令牌、面包屑高度、窄窗 media 的多处让位规则引用** —— 动它必须连顶栏做逐屏截图对拍，收益（少 10 条声明）不抵回归风险。**接手姿势**：先跑 `scripts/css-audit/shotset.mjs` 钉住 27 屏基线，再改，再逐屏 diff。
    - **toast 三套合一**（`.ln-toast` kit / `.b3-snackbar` compat / `.mobile-toast` mobile-kit）：数值 90% 相同，但一头牵动移动端、另一头 toast 是**瞬时浮层**（隐藏窗口里 CSS `:hover`/动画不跑，没法像素对拍）。**接手姿势**：单独一批 + 模拟器/真机验证，别在桌面会话顺手改。
    - **`.protyle-breadcrumb__item` / `.quick-note-index-main`**：审计把它们和输入框归为相似，实为**可点击的文本条目**，收编前先定性（是「行」还是「输入框」）。
    **工具（已入库）**：`scripts/css-audit/audit-lookalike.mjs`（找「像原语却没复用」，260930 命中 29 → 16）、`scripts/css-audit/audit-primitives.mjs`（跨文件规则体重复族，46 → 39）。改完样式重跑对比即可；判定只认这两份数据 + 实机几何，不认「看着像」。

9. **多维表优化专项**：唯一方案/进度/修改记录/会话结论在 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`；专项会话先完整读它、结束前必须回写它，**不在 HANDOFF 内展开专项细节**。当前进度见 §0 第二节。
   **条件填色 + 统一选色已实现、待验收**：详见 `docs/BITABLE-FILL-COLOR-RESEARCH.md` 与专项文档 §11/§12/§13。四模式复用筛选单规则编辑器，按钉钉语义做 alpha 混色；应用内选色统一为内核 70 色实色卡 + 最近使用/自定义；最近使用按入口独立分桶并存 localStorage，Lake 内核适配器样式不变；当前代码已提交 `ae1cfda`；功能验收状态以专项 §11 为准，当前转入 §17 架构讨论。

11. **多维表行虚拟化（AR04 已证瓶颈；用户 260930 决定暂不做，留待后续）**：真实 Electron 压测（scripts/bitable-stress.mjs）——目标 5000×20 打开 **12.42s / 84.8 万 DOM / 395MB 堆 / 首次点选 2.25s**；10000×20 = 24.8s/169 万/1.34GB；20000×50（100 万格）200s 内未渲染完成；50000×50 因**正文 32 MiB 上限**根本无法保存。结论：CPU 热点（AR-F5/F6）已消除，**DOM 全量渲染是瓶颈**，支持 5000 级规模需行虚拟化/渲染策略；立项前先定「5000×20 滚动/编辑目标 + 验收口径」。多维表审计其余遗留见专项 §17.12。

12. **非多维表审计遗留（260930 会话决定）**：
    - **F16 安卓整轮网络同步持本地写队列** → **记入正式项目待办**：先出真机/模拟器时延数据，再拆「sync/GC 维护互斥」与「短本地事务互斥」，网络阶段不占本地 DB 写锁；需单独立项 + 跨端 sync 对拍。
    - **S3 内核适配收口与实机性能** → **记入正式项目待办**：重试/观察限制到 host/card/session；卡水合/自愈/scroll 先测后删；跑前台长正文/代码/媒体/大纲/锁定回归。
    - **F12 安卓固定密钥** → **不做**：属设备安全（Android Keystore）范畴，本项目不承担设备安全职责。
    - **S1 DocumentSession / F13 / §6.1-#2** → **不做**（会话正确性已由 S0 + 捕获契约覆盖；后两者收益不足）。
    - **F08 双介质一致性** → 走 §8 **路线 A**（保持文件+DB、只修会话）；**A 不修 F08 跨介质窗口**（需 B/C）。A 的会话修复已完成。
    - **§6.1 剩余性能项**：已测量（见 §0「§6.1 剩余性能项测量」）。#4 **已修**（5c70b1c，收窄到实例 mount）；#5 未测到高频（不做）；#6 增量 ~6ms/次（暂不改）。

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
- **网格是全量 DOM 渲染、无虚拟化**（260930 AR04 压测，真实 Electron）：DOM ≈ 8.5 个/格；目标 5000×20 打开 12.4s / 84.8 万节点 / 395MB 堆 / 首次点选 2.25s；10000×20 → 24.8s / 169 万 / 1.34GB；20000×50（100 万格）200s 内未渲染完。支持 5000 级规模前需要行虚拟化/渲染策略（专项 §17.7 AR04 触发条件已成立）。压测工具 scripts/bitable-stress.mjs；CDP 依附窗口隐藏，量不到 FPS，只能量挂载/DOM/堆/交互延迟。

### 工程 / 环境
- Node 必须 24；better-sqlite3 是 Electron ABI，系统 Node 不能替代运行时。
- 改 `electron/**` 或 `src/core/**` 会触发 Electron 重启；验证前确认 CDP 端口连的是新实例。
- Vite dev server 必须长驻；`nohup` 起的进程会随会话回收。
- 杀 Electron 只按唯一 CDP 端口精确定位 PID；禁 `pkill -f Electron`、`killall`。
- DSH 宿主里启动仓库 Electron 要 `env -u ELECTRON_RUN_AS_NODE`。
- 打包版写正式数据目录；试跑必须覆盖 `LAKE_USER_DATA`，发布 smoke 用独立端口。
- **scheme 模式验收前必须 `npx vite build`**（它服务 `dist/`，否则验收的是旧 bundle）。
- **CDP 依附的窗口是隐藏的**（`document.hidden === true`）⇒ `loading="lazy"` 图片不加载；验收图片要临时去掉该属性，别误判成产品 bug。
- **要「仿照云端」时，优先读云端前端资源而不是一个个点 UI**（260929 用户提示，已实践）：`bsk evaluate` 里 fetch `performance.getEntriesByType('resource')` 找到 `gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css|.async.js`（CORS 可读），配置表/样式规则直接 grep 就有（如统计项的 types 限制、占位 hover 规则）；点 UI 只用来交叉验证。
- **用户可能与测试实例共用同一个进程/窗口**（260929 用户明确交代）：我起的隔离实例（LAKE_USER_DATA=$TMPDIR/lake-accept + LAKE_RENDERER=scheme）用户会**直接在同一个窗口里看/操作** ⇒ **不要默认 kill 实例、不要 rm -rf 该 userData**（那是他正在看的数据）；只有用户明确说「清理/重建」时才收尾。同理，验证脚本不要顺手删掉自己建的测试笔记。
- **读落盘要轮询**：自动保存有防抖，改完立刻读会拿到旧值。

## 5. 上线与后续建议
1. 主线是多维表专项（§0）；专项之外只从 §3 取项并单独立项，不要恢复已完成的研究/计划文档。
2. 改同步/GC 前先读 `AGENTS.md` 原则 11~13 + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`；写 Lake 正文前读 `docs/LAKE-CONTENT-WRITING.md`。
3. 编辑器/lakex 相关先按 AGENTS §2 的检索顺序查 vendor → 官方文档 → `LAKEX-CONTRACT.md` → 源码字典。
4. 上线收尾的真实环境验收仍待做：空库双端 V1 同步、Android 真机、发布说明（见 §8 与专项之外的 backlog）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs && npm run check:core && git diff --check
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
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 V1 重置）· `S3-GC-DESIGN.md`（存储/删除 GC）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **多维表优化专项**：`BITABLE-OPTIMIZATION-HANDOFF.md`（唯一方案、状态看板、修改记录和多会话交接；**专项会话必读必写**）。
- **条件填色 + 统一选色（待验收）**：`BITABLE-FILL-COLOR-RESEARCH.md`（四模式 + 钉钉同款 alpha 混色；筛选引擎与编辑器复用；应用内 70 色实色卡 + 最近使用/自定义；Lake 适配器样式不变；当前代码未提交）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md` · `ANDROID-TECH-SCHEME.md` · `ASSET-URL-MOBILE-PLAN.md`。
- **UI/工程规范**：`scripts/css-audit/README.md`（样式层）· `PANEL-CONTRACT.md`（面板几何/层序契约）· `UI-PRIMITIVES-PHASE1-260926.md`（浮层原语）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端速查（完整端）

- 正式端：Capacitor Android，包名 `com.lakenotes.mobile`；定位为完整端，桌面红线同样适用。
- 数据在模拟器 App 沙盒，不在 macOS 数据目录；开发可 `adb shell pm clear com.lakenotes.mobile` 重建。
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
- **造数据**（模拟器是全新安装、库里 0 条）：DB = `databases/lake-notes-mobileSQLite.db`；`notes` 表写 `doc_kind='bitable'`、`content=<正文 JSON>`、`parent_id='notebook-personal'`（**必须挂到笔记本**，否则首页点开会提示「未找到该文档所属笔记本」）。改法：force-stop → `exec-out run-as … cat` 拉出 db/wal/shm → python sqlite3 写 + `PRAGMA wal_checkpoint(TRUNCATE)` → push 回 + 删 -wal/-shm → 重启 App。
- **点开笔记必须用真实点按**：首页最近文档是 `<button class="doc-card">`，CDP 里 `el.click()` **不触发**导航（页面不动），要用 `Input.dispatchMouseEvent` 在元素中心 mousePressed/Released。
- 已验收（模拟器 lake_mobile，Pixel 6 / API36）：`移动多维表`（全字段）断言 bool=[true,false] 且 disabled、链接 href/target 正确、评分星数=[4,2]、进度=60%/0%（条宽一致）、关联 chip=[目标A,目标B]/[目标B]、创建时间到分钟、只读徽标；`移动看板表` 显示「「看板视图」桌面已支持，移动端暂以表格只读展示。」

### 当前剩余验收
- V1 空库多端同步：创建/编辑/删除/恢复/GC。
- 真机：图片与附件、编辑保存、同步后图片加载、键盘安全区。
- 数据导出/导入、剪贴板粘贴、长文档大纲跳转。
- 缩略图目前仅 png/jpg/jpeg，失败会回退原图。
- ~~多维表只读控件（布尔/链接/评分/进度/关联/时间）~~ 260929 已在模拟器验收；真机复验仍可做。
