# 11 · R1 wave1+2 独立交叉复核（task-26）

> 复核者：audit-docs（独立于 wave1 各执行者）· 2026-11-12 · **只读复核**（未改任何被复核文件）
> 复核对象：R1 已提交批次 `aa19406f` → `832802a9`（6 个功能/清理提交 + 1 个文档提交）＋ 本轮 wave2 在途改动（只做方向性核对，不判定为完成）。
> 结论产出：本文件 + `guide/10-ai.md` 的 Q12 文档（唯一改动，属我自己的任务范围）。

## 0. 结论摘要

| # | 复核轴 | 结论 |
| --- | --- | --- |
| ① | 纯搬移零行为变化 | **PASS**（bitableDoc 导出表 138 值 + 34 类型逐字等价；拆分类提交导入面由 tsc=0 + 定向测试证明） |
| ② | 预览 hook 单源 / policy 消费 | **hook 单源 PASS**；**policy 零消费 ⚠（未接线）**；Q02 已接、Q04/Q05/Q06/Q07 仅在 wave2 工作树 |
| ③ | Kotlin 路径校验 / SecretBox | **PASS（静态）**；⚠ 未跑 `gradlew test`，真机签名/Keystore 行为未验 |
| ④ | audit-261027 删除后断链 | **FAIL ×1**（`android/.../network_security_config.xml:5`），其余 0 断链 |
| ⑤ | HANDOFF 与实际一致 | **FAIL ×5**（HEAD/未推数/工作树/测试计数/待办状态），均为"提交后未回写" |
| — | Q12 文档 | **DONE**（`guide/10-ai.md:49-63`，事实已对代码核实） |

**门禁现状（本轮实测）**：`npx tsc --noEmit` = **0 错**；`npm run check:core` = **172 文件 / 0 违规**；定向 vitest 共 **270 例全绿**（明细见 §1）；`git diff --check` = 0。**未跑**全量 vitest / 构建 / 设备门禁 / gradle。

## 1. 复核范围与方法

- **已提交（review 对象）**：`aa19406f`（bitableDoc 拆 9 模块）· `5acd0bec`（electron quickNotes + webApiServer 拆分）· `7e385373`（预览基础层）· `4c1e56c5`（QuickNotesWorkspace 拆 hook + 搬 features）· `f7c1abce`（Android AssetPaths + SecretBox）· `2487b733`（audit-261027 / v1v2 迁移 / Q24）· `832802a9`（HANDOFF/CONTRIBUTING/SECURITY/AGENTS/DESIGN）。
- **在途（只记录，不判定）**：复核时 `git status` 有 17 项未提交（16 个文件来自 wave2 预览/拆分接线 + 我的 `guide/10-ai.md`）。因此本报告**以 `832802a9` 的已提交状态为准**；wave2 相关内容一律标"在途"。
- **方法**：① 导出表/声明级源码对比（脚本，见附录 A）；② 定向测试；③ 静态门禁（`check:core`、`git diff --check`）；④ 引用/链接全仓 grep；⑤ 文档断言逐条对代码。

### 定向测试结果（可复跑）

```bash
npx vitest run src/core/bitableDoc.test.ts electron/quickNotes.test.ts electron/webApiServer.test.ts \
  electron/s3v3/desktopPlatformPort.test.ts src/features/preview        # 6 文件 / 183 tests 全绿
npx vitest run src/features/quickNotes src/desktop                        # 10 文件 / 87 tests 全绿
npm run check:core                                                        # 172 文件 / 0 违规
```

## 2. ① 纯搬移 / 拆分：是否零行为变化

### 2.1 `aa19406f` bitableDoc 2419 行 → 9 模块 + 门面（commit 自称"纯搬移"）**PASS**

| 检查 | 结果 |
| --- | --- |
| 拆分前导出表（独立提取 `aa19406f^:src/core/bitableDoc.ts`） | **138 个值导出 + 34 个类型导出** |
| 门面 re-export 计数（`src/core/bitableDoc.ts` 9 行显式清单） | **138 值 + 34 类型**，逐字相等 |
| 护栏测试 | `src/core/bitableDoc.test.ts:1514`（BEFORE_SPLIT 列表）+ `:1563-1564`（运行时 `Object.keys(module)` 断言 138 个值；类型读门面文本断言 34 个） |
| 声明级对比（脚本） | 拆分前 219 个顶层声明 → **0 个缺失**；54 处文本差异全部是"拆分后模块必须新增的 `export`/import 与文件头注释"（抽样 `nowIso`/`fieldSupportsFormat` 函数体逐字一致；`normalizeFilterNode/normalizeFilters` 由私有变模块内 export 以满足跨文件复用，**门面未多导出**） |
| 行为 | bitableDoc 既有 77 用例 + 相关套件全绿（§1） |
| 分层 | 新 `src/core/bitable/*` 无平台 import；`check:core` 0 违规（AGENTS §3#19 单一来源：`filter.ts` / `values.ts` 各 1 处） |

> 结论：导出面与行为均无变化证据；这是本批质量最高的一处搬移（自带导出表护栏）。

### 2.2 `5acd0bec` electron quickNotes / webApiServer 拆分 **PASS（非纯搬移，但导入面与行为完好）**

- `electron/quickNotes.ts` 1451 → 门面 + `electron/quickNotes/{context,index,missingBody,savePipeline,schema,searchIndex,staging,tagLinks,trashLifecycle}.ts`。
  ⚠ 它**不是纯搬移**：门面仍保留 4 个函数（`unavailableQuickNotesStores` / `isQuickNotesUnavailableStore` / `createUnavailableQuickNotesStore`，`electron/quickNotes.ts:25-32`），搜索实现改由 `src/core/search` 分词器 + 本模块账本组合（`quickNotes/searchIndex.ts:1-20` 有依赖方向与失败语义说明）。导入面完好：`tsc = 0`；`electron/quickNotes.test.ts`（42 例）全绿。
- `electron/webApiServer.ts` 988 → 门面 + `electron/webApi/{index,bridge,events,security,static}.ts`；`WEB_METHODS` 仍在门面（`webApiServer.ts:37`），`ipcChannelParity.test.ts` 的三面契约不受影响；`electron/webApiServer.test.ts` 全绿。
- 未做逐字节全量对拍（局限）；以"导出面 + tsc + 测试"三重证据判定。

### 2.3 `4c1e56c5` QuickNotesWorkspace 拆 3 域 hook + 搬进 `features/quickNotes/` **PASS**

- 搬移本身在 `aa19406f` 完成（`git show --stat` 显示 `…/quickNotes}/QuickNotesWorkspace.tsx | 0` = 纯重命名）；`4c1e56c5` 只拆 hook。
- 行保留率：拆分前 989 代码行 → 拆后 1090 行（+101，属 hook 接线/注释）。丢失的 33 行逐条核对后全部是：多行 import 的续行、JSX 重排、被搬进 hook 的等价表达式；关键逻辑仍在 —— `listVersionRef.current.invalidate()`（`useQuickNoteList.ts:143,161`）、`cacheDetail(saved)`（`useQuickNoteDraftSave.ts:234,342`）、`listSummaryOf`（`useQuickNoteList.ts:15`）。
- 测试：`src/features/quickNotes` + `src/desktop` 10 文件 / 87 例全绿。

## 3. ② 预览基础层（`7e385373`）

### 3.1 内核只读 viewer 是否真单源 —— **PASS**

- 唯一实现 `src/features/preview/useReadOnlyKernelViewer.ts`；消费者恰好 3 处且都是"收口前各写一套"的那 3 处：
  `QuickNoteKernelPreview.tsx:42`、`AiAnswerViewer.tsx:61`、`useHistorySnapshotViewer.ts:24`。
- 生命周期契约与收口前逐条对齐（同 key 只 `setDocument`、换 key/卸载 destroy、`addAssetAccessToken` 注入、reveal-latch 常驻、create 失败只回调不炸页面）；护栏 `useReadOnlyKernelViewer.render.test.tsx`（236 行）+ 两处源码断言（`quickNoteKernelFallback.test.ts:78`、`historySnapshotPreview.test.ts:81`）。
- AI 答案的 lazy 边界与"6s 未出内容回退 Markdown"仍在 `AiAnswerViewer.tsx`（hook 之外），未被搬移吞掉。

### 3.2 `previewAsset` 档位决策 —— **PASS（已消费）**

- `resolvePreviewAssetUrl(ref, "original")` 已接：桌面 `NoteDocPreview.tsx:74-77`（放大取原图）、移动 `home/HomePage.tsx:1242` 与 `tags/TagQuickNotePreview.tsx:75`（`originalUrl`）。
- **Q02 已落地**：`ImageLightbox.tsx:7,30,46-52,81` —— 先渲染显示档、`new Image()` 预加载原图成功后再替换；失败保持档位图（不打扰）。

### 3.3 `PREVIEW_POLICY` —— **⚠ 零消费（未接线，不能算完成）**

- `git grep 'PREVIEW_POLICY'`：**只有 `features/preview/policy.ts` 自身与 `policy.test.ts`**，没有任何宿主 import。
- 即 Q04（移动回收站只读预览+横幅）/ Q06（桌面回收站/历史加放大）/ Q09（标签空间点击打开）目前只是**纯数据 + 测试断言**（`policy.test.ts:34-67`），宿主行为未变（`src/mobile/trash/TrashPreviewPage.tsx` 本批 0 提交）。
- **Q07A（`LakeEditor interaction="preview"`）与 Q05B（`LAKE_PREVIEW_FONT_SIZE`）当前只存在于未提交工作树**（`LakeEditor.tsx:20-45` 是工作树修改；`git log -4 -- src/features/editor/LakeEditor.tsx` 最新仍是 `48862a65`）⇒ 属于 wave2 在途，**不能计入 wave1 完成项**。
- 判定：基础层方向正确（类型/策略/档位齐备且测试先行），**但"能力矩阵被消费"尚未发生**；wave2 接线时若仍不用 policy，应删掉 policy 或标注"规划中"，避免第三套 if 分支复活。

## 4. ③ Kotlin：AssetPaths 单源 + SecureStore→SecretBox（`f7c1abce`）**PASS（静态）**

| 项 | 结论与证据 |
| --- | --- |
| 路径单一来源 | `AssetPaths.kt`：写路径 `resolveAsset`（:41，staging 不可达）+ HTTP 读面 `resolveServed`（:45，staging 只读）+ 段匹配 `rootKeyOf`（:73，避免 `note-assetsX/` 前缀绕过）+ canonical 逃逸校验；`AssetServer.kt` 在 `URI.getPath()` 单次解码后调用（`AssetServer.kt:150-180`）；`AssetSyncPlugin.kt` **保留原函数名/签名**、内部改调 AssetPaths（:33-36, :393-401）⇒ 调用点零改动 |
| Q21 对抗单测 | `AssetPathsTest.kt` 10 例：dotdot、URL 编码遍历、软链逃逸、前缀绕过、超长 key、空段、staging 只读、NUL/绝对路径 —— 覆盖裁决要求 |
| SecureStore→SecretBox | ALIAS/PREFS **逐字不变**（`SecureStorePlugin.kt:31,34`，注释 :24-25 明示"改了等于换密钥库"）；加密封装格式与旧实现**逐字相同**（`iv:ct` + Base64 NO_WRAP，`SecretBox.kt:51-52`）⇒ 已存 S3 密钥仍可解；解密失败清键语义保留 |
| ⚠ 未验证 | 未跑 `gradlew test`（Q21 验收要求）、未装包做 Keystore 真机 smoke（Q22 要求）；ART/Keystore 行为无法用静态检查替代 |

## 5. ④ audit-261027 删除后是否断链 —— **FAIL ×1**

- ✅ md 链接：全仓 0 条指向 `docs/audit-261027/`（doclint 149 篇 md，broken 仅 3 条语雀镜像原文 + 4 条审计报告内部相对链接，均与本删除无关）。
- ✅ 源码注释 5 处已在 `2487b733` 改指新落点；✅ HANDOFF:84/:100 是"已删/教训"记录（符合"不要再链"口径）。
- ❌ **1 处真断链**：`android/app/src/main/res/xml/network_security_config.xml:5` ——
  `261029 安全复核：SEC-08 判为「不做」（发布既定配置，理由见 docs/audit-261027/02-security.md §6）。`
  该文件已删。**修法（1 行注释）**：改指 `docs/RESILIENCE.md` §9 的「SEC-08」行。

## 6. ⑤ HANDOFF 与实际不一致 —— **FAIL ×5（同一根因：提交后未回写）**

> HANDOFF 在 `832802a9` 提交，但没有跟随其前面 6 个 R1 提交。以下均为 file:line 可直接核。

1. **`docs/HANDOFF.md:41`**「HEAD = `aa713d7a`（261112 审计裁决记录）… R0 之后至今都是 docs 提交」→ 实际 `git rev-parse --short HEAD` = **`832802a9`**；缺 6 个 R1 提交（aa19406f…832802a9）。
2. **`docs/HANDOFF.md:42`**「`origin/master` = `8cc65e06`（本地 ahead 9）」→ 实际 `git rev-list --count origin/master..HEAD` = **16**。
3. **`docs/HANDOFF.md:46`**「工作树：R1 批次在途（多人并行改不同文件）」→ wave1 已全部提交，复核时工作树仅 wave2 在途（与我无关的 16 文件）；该句会让接手者误判"有一批改动没提交"。
4. **`docs/HANDOFF.md:52`**「全量 vitest = **874 文件**」→ 实际 tracked 测试文件 **878**（R1 新增 `useReadOnlyKernelViewer.render`、`policy`、`previewAsset`、`historySnapshotPreview` 等）。该行标注"R0 批实测"，但 §1 是"唯一状态来源"，应改成"R0 快照，R1 未重跑"或重跑回写。
5. **`docs/HANDOFF.md:112`（§3 P0）** 把 R1 的「拆分 1/3/4/5 + Kotlin + 清理」列为**在途** → 实际这 6 项已在 6 个提交中落地；待办状态与现实相反（下个会话可能重复开工）。同理 `:18`「874 文件 / 5512 passed」也是 R0 数字。

> 一致的项（已核）：版本 1.1.0 / versionCode 11100 ✓；`github/master = 2e512c48` ✓；tag 与发布说明描述 ✓；**文档地图链接全部有效** ✓；已删文档清单含 audit-261027 ✓。

## 7. Q12 文档（已落地）

- 位置：`guide/10-ai.md:49-63` 新增「## 桌面：对话只存在内存（不保存）」+ 三行对照表（桌面 AI 助手 / AI 写作 / 文档历史）+ 手机端差异说明；并把配置表的「多轮对话」行改为"关闭面板即清空（见下节）"。
- 事实依据（已核实）：
  - 桌面 AI 助手 = **按作用域的内存会话**（`src/features/ai/aiAssistantSession.ts:1-13`：会话在 store 里，文档/tab 关掉即丢弃；钉住只影响显示），全模块 **无 localStorage/IPC 持久化写入**（grep 0 命中）。
  - 移动端不同：会话落本机（`src/mobile/ai/aiChatStore.ts:1-8`：`ai/conversations/{id}.json` + SQLite 索引，最多 50 条/30 天，不进 S3）。
  - AI 写作会话落本机 SQLite（`docs/AI-WRITING.md`）；文档历史 = 正文快照（`guide/09-history-trash.md`）。
- 未改代码（Q12 裁决是"A + 文档"；提示文案不在本任务）。

## 8. 需修项（按优先级，建议 owner）

| # | 级别 | 位置 | 修法 |
| --- | --- | --- | --- |
| R1R-1 | **P1** | `docs/HANDOFF.md:41,42,46,52,112` | R1 收尾回写：HEAD/未推数/工作树状态/测试计数（或标注"R0 快照"）/§3 待办状态。**这是本批唯一"会让下个会话事实判断出错"的问题。** |
| R1R-2 | **P2** | `android/app/src/main/res/xml/network_security_config.xml:5` | 注释改指 `docs/RESILIENCE.md` §9（Android owner，1 行） |
| R1R-3 | **P2** | `src/features/preview/policy.ts` 零消费 | wave2 接线时让回收站/历史/标签空间/小记卡消费 `PREVIEW_POLICY`；若不接线则删 policy 或标"规划中"，别留第三套 if |
| R1R-4 | **P3** | 工作树 wave2 | Q04/Q05/Q06/Q07 尚未提交，验收时以提交后状态为准（本报告不对在途做完成判定） |
| R1R-5 | **P3** | `QuickNotesWorkspace` 拆分 | 行保留率检查显示 33 行"丢失"（均已核对为 import/JSX 重排）；建议下批把"拆分后行数守恒"写进提交说明，减少复核成本 |

## 9. 未覆盖 / 限制

- 未跑全量 vitest / 双 build / 设备门禁（任务限制）；"全量绿"只能引用 HANDOFF §1 的 R0 数字（已标为过期）。
- 未跑 `gradlew test`、未装 Android 包：Q21/Q22 的真机验收仍欠。
- 纯搬移只做"导出表 + 声明级对比 + 定向测试"三重证据，**未做逐字节全量对拍**（bitableDoc 有导出表护栏兜底；quickNotes/webApi 依赖 tsc + 测试）。
- wave2 在途（预览接线/Q19-2 BitableEditor 拆分）不在本报告判定范围。

## 附录 A：本次使用的对比脚本（一次性，`/tmp`，不入库）

1. **导出表提取**：`git show <commit>^:<old> | grep -E '^export (const|function|let|class)'` 与门面 re-export 行按逗号计数，比对 138/34。
2. **声明级对比**：正则 `^(export )?(declare )?(async )?(function|const|let|type|interface|class) NAME` 切块，按名字比对归一化文本；报告 missing / changed。
3. **行多重集对比**：按行 trim 后计数，排除 import/export/注释行，比较 before → after 的缺失行（用于发现"搬丢了逻辑"）。

（脚本仅用于本次复核，仓库内不新增工具文件。）
