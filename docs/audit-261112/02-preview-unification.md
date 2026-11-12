# 02 · 预览能力统一（发布前审计）

> 审计对象：LakexLocalNotes（Electron 44.9 / Capacitor 8，本地优先笔记应用）
> 审计日期：2026-11-12 · 只读审计（未改任何产品代码）
> 任务：全仓「预览」能力盘点 + 统一能力层设计
> 证据口径：**已核实** = 本次审计直接读文件/跑命令确认；**推断** = 由代码结构推断、未实机验证。每条结论带 `file:line` 或可复现命令。

---

## 0. 方法与范围

### 0.1 方法与只读边界

- 只读：仅运行 `grep` / `read` / `find` / `wc`，未安装依赖、未构建、未启动 App/设备、未跑 vitest 全量、未触碰任何数据目录。
- 报告落盘：`docs/audit-261112/02-preview-unification.md`（本文件，唯一写入）。
- 判定顺序：先建「入口 → 渲染器 → 数据来源」事实表（§1），再按「同类不同实现 / 同能力不同参数 / 同一解析器多处复制 / 浮层行为各自实现」分类去重（§2），最后给能力层设计（§3）与迁移（§4）。
- 对每条 finding 自问三问（AGENTS §3#17）：① 问题真实存在？② 不做会付什么代价？③ 收益是否大于新增复杂度？**不满足的条目已降级到 §6「明确不做」或 §7「需裁决」。**

### 0.2 范围

覆盖任务书列出的全部入口：桌面 Lightbox / NoteDocPreview / HistorySnapshotPreview+useHistorySnapshotViewer / TrashPanel / TagPreviewBody / AttachmentPreview+controller / InkPreview / 非 doc 只读编辑器 / markdown 预览 / 同步记录快照预览 / AI 只读内核视图；移动 TrashPreviewPage / TagQuickNotePreview / QuickNotePreview / QuickNoteKernelPreview / 资源管理缺正文缺小记 / NoteTagsSheet / AI 回答预览 / LakeEditor 阅读态 / 图片 tap 预览 / 系统分享导入。

### 0.3 未覆盖（本报告不给结论）

| 未覆盖项 | 原因 | 后续 |
| --- | --- | --- |
| 实机观感（首帧白闪、字号观感、深色下状态栏图标） | 只读审计不启动 App | §5 列为待实测项 |
| 预览在 2 万文档 / 20 万附件量级下的实际内存 | 同上 | §5 给估算与测法 |
| 平板（pad）预览几何 | 本轮按手机+桌面覆盖，pad 走同一套 NotePaneHost | 附录 C 命令可查 |
| vendor 内核内部预览路径（ne-viewer 自身能力） | AGENTS §2：不清理 vendor、不改内核 | 不改，只在 §3 约束「不新增内核私有 hack」 |

### 0.4 事实地图的统计口径（先钉数字）

| 口径 | 数量 | 复现命令（仓库根） |
| --- | --- | --- |
| 用户可见的预览入口（本报告 §1 表格行数） | **30**（桌面 18 / 移动 12） | 见 §1.1 / §1.2 |
| 独立的「渲染器实现」 | **12 类** = 内核 viewer 1 类（但有 **4 份包装器**）+ 只读编辑器 8（桌面 4 / 移动 4）+ 小记快路径 1 + markdown 子集 2；另有 4 处裸原生标签（img/embed/audio/video/pre） | §1.3 |
| `createLakeDocument(...)` 调用点（src/，非测试） | **11** | `grep -rn 'createLakeDocument(' src --include='*.ts' --include='*.tsx' \| grep -v test \| grep -v 'export function'` |
| `attachImagePreviewClick` 挂载点 | **3**（EditorTab / LakeEditor / QuickNoteEditor） | 同上模式替换符号 |
| `openImagePreview(` 调用点 | **8** | 同上 |
| `openAttachmentPreview(` 调用点 | **2**（均在 `openAssetEntry` 内） | 同上 |
| 预览专用 CSS 文件 | **2**（`image-lightbox.css` / `attachment-preview.css`）+ 5 个宿主内联作用域 | `find src -name '*preview*.css' -o -name '*lightbox*.css'` |
| 内容提到 preview 的测试文件 | **92**（含非预览域命中，只作量级参考）；**文件名含 preview 的 test = 11** | `grep -rln 'preview\|Preview' src --include='*.test.ts' --include='*.test.tsx' \| wc -l` |

> **一句话结论**：**浮层（图片 Lightbox / 附件预览）已经是单例共享**；**文档/小记/快照的「只读渲染」也各有单一来源**。真正的割裂不在「有几套 Lightbox」，而在：
> ① 同一个「文档只读预览」有 **两个宿主实现**（`NoteDocPreview` vs `LakeEditor mode=viewer`），能力集不同；
> ② **内核只读 viewer 的包装器有 4 份**，生命周期/prefs/失败策略各写一遍；
> ③ **「预览里能做什么」没有统一策略对象**（能否放大图 / 开附件 / 复制 / 长按菜单），两端各入口凭自觉；
> ④ **图片来源档位不统一**（原图 / `?w=1024` / `?base64=1` / 原生 dataUrl），导致「放大看大图」在不同入口清晰度不同。

---

## 1. 事实地图

### 1.1 桌面（Electron）预览入口

| # | 入口 | 触发 | 渲染器 | 数据来源 | 只读 | 支持 kind | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | 文档图片大图（编辑态 + 锁定态） | 双击 `img.ne-image` | `ImageLightbox`（共享单例） | 现场 `editorRef.getDocument("text/lake")` → `extractImagesFromContent` | 只读 | doc | `src/features/editor/EditorTab.tsx:821-827` |
| D2 | 文档内 file 卡片 | 点击文件芯片 | `openAssetEntry` → `AttachmentPreview` 或系统打开 | fiber `cardData` → src/name/size | 只读 | doc | `EditorTab.tsx:829-831`、`src/features/attachment/openAssetEntry.ts:40-56` |
| D3 | 小记列表卡图片 | 单击图片 | `ImageLightbox` | `item.content.images`（**原图 URL**，未加 `w`） | 只读 | quickNote | `src/components/app/QuickNoteCard.tsx:36-37,61` |
| D4 | 小记写作卡图片（桌面） | **无入口**（代码显式短路） | — | — | — | quickNote | `src/features/quickNotes/QuickNoteEditor.tsx:128-134`（`isDesktop() ? () => undefined : attach…`） |
| D5 | 回收站内嵌预览 | 左列选文档 | doc→`NoteDocPreview`；其余→`HistorySnapshotPreview` | `native.readNote` + `native.ensureTrashNoteAssets` | 只读 | 全 5 kind | `src/components/app/TrashPanel.tsx:175-198,346-351` |
| D6 | 历史面板快照预览 | 点快照 | 同上（doc/其余分流） | `native.previewHistorySnapshot(id)` | 只读 | 全 5 kind | `src/components/app/HistoryPanel.tsx:218-227,363-370` |
| D7 | 历史面板 orphan 文件预览 | 点文件 | **自写**：`<img>` 或 `<pre>` | `native.previewNoteOrphan` → `imageData`/`text` | 只读 | 任意文件 | `HistoryPanel.tsx:236-257,375-386` |
| D8 | 文档属性·历史快照内联预览 | 点「预览」 | doc→`NoteDocPreview`；其余→`HistorySnapshotPreview` | `native.previewHistorySnapshot` | 只读 | 全 5 kind | `src/components/app/NoteInfoDialog.tsx:114-127,235-239` |
| D9 | 标签空间只读预览 | 选中聚合项 | **doc 不自渲染**（打开卡片）；小记→`QuickNotePreview` | `previewItem` + `previewBody` | 只读 | doc 仅入口 / quickNote 渲染 | `src/features/tags/TagsWorkspace.tsx:568-598` |
| D10 | 文档正文只读渲染（共用件） | 被 D5/D6/D8 调用 | `useHistorySnapshotViewer` → `createLakeDocument(...,"viewer")` | 传入 `body` | 只读（onChange 恒 no-op） | doc | `src/components/app/NoteDocPreview.tsx:34-58`、`src/components/hooks/useHistorySnapshotViewer.ts:45-66` |
| D11 | 非 doc 只读渲染（共用件） | 被 D5/D6/D8 调用 | `UniverSheetEditor/BitableEditor/BoardEditor` readOnly / `InkPreview` | 传入快照 JSON | 只读（`onChange=noop`） | usheet/bitable/board/ink | `src/components/app/HistorySnapshotPreview.tsx:106-159`、`src/features/ink/InkPreview.tsx:24-30` |
| D12 | 快照结构化摘要（兜底） | 解析失败/移动端 | 纯 React 块 | `src/core/historyPreview.ts:snapshotPreview()` | 只读 | usheet/bitable/board/ink | `HistorySnapshotPreview.tsx:114-132` |
| D13 | 附件预览浮层 | file 卡 / 资源页 | `AttachmentPreview`（PDF `<embed>`、音视频内联、其余兜底） | 调用方给 src/name/size + 平台动作 | 只读 | 任意附件 | `src/features/attachment/AttachmentPreview.tsx:22-123` |
| D14 | 多维表附件图片 | 点缩略图 | `ImageLightbox`（相册 = 该记录附件） | `bitableAssetUrl(noteId, file)` | 只读 | bitable | `src/features/bitable/BitableEditor.tsx:395` |
| D15 | 资源空间内联预览 | 选中未引用资产 | **自写** `<img>/<video>/<audio>/<iframe pdf>` | `assetDisplayUrl(item, 1024)` | 只读 | 附件 | `src/components/app/AssetsBrowser.tsx:73,93-101` |
| D16 | AI 写作答案只读内核视图 | 回答收尾 | `AiAnswerViewer`（懒加载，`createLakeDocument(..., "viewer")` + `setDocument("text/markdown")`） | markdown 原文 | 只读 | markdown | `src/features/aiWriting/AiAnswerViewer.tsx:36-128`、`src/features/aiWriting/AiMessageView.tsx:20,93-97` |
| D17 | AI 答案 / 流式兜底 markdown | 流式期间 / 内核失败 | `MarkdownView`（自研子集） | markdown 原文 | 只读 | markdown | `src/features/aiWriting/AiMessageView.tsx:93-94`、`src/components/ui/markdown/MarkdownView.tsx` |
| D18 | 同步记录 → 查看历史 | 「查看历史」 | 跳历史面板（= D6） | 快照 | 只读 | 全 | `src/components/app/SyncConflictsPanel.tsx:105` |

### 1.2 移动（Capacitor）预览入口

| # | 入口 | 触发 | 渲染器 | 数据来源 | 只读 | 支持 kind | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 文档阅读态/编辑态图片 | **单击**图片（300ms 判定窗） | `ImageLightbox` | `LakeEditor.latestDocumentRef` → `extractImagesFromContent` | 只读 | doc | `src/features/editor/LakeEditor.tsx:94-98` |
| M2 | 文档内 file 卡片 | 点击 | `openAssetEntry`（移动端 `directOpen=true` → 系统打开） | fiber cardData | 只读 | doc | `LakeEditor.tsx:114-125`、`src/mobile/editor/DocumentEditor.tsx:93-95` |
| M3 | 回收站文档预览页 | 设置→回收站→点行 | `LakeEditor mode="viewer"`（**不是** NoteDocPreview） | `bridge.readNote` + `ensureTrashNoteAssets` | 只读（`onChange` no-op） | **仅 doc**（其余显式挡） | `src/mobile/trash/TrashPreviewPage.tsx:32-45,76-90` |
| M4 | 首页小记卡封面/预览图 | 单击（320ms 判定窗） | `ImageLightbox` | `localAssetHttpUrl` + token + `?w=1024` | 只读 | quickNote | `src/mobile/home/HomePage.tsx:1154,1193-1196,1214-1235` |
| M5 | 标签详情富预览 | 行内点图片 | `ImageLightbox` | 同上（`?w=1024`） | 只读 | quickNote | `src/mobile/tags/TagQuickNotePreview.tsx:52-70` |
| M6 | 小记写作卡图片 | 单击 | `ImageLightbox`（`{tap:true}`） | `editor.getDocument("text/lake")` | 只读 | quickNote | `QuickNoteEditor.tsx:128-134` |
| M7 | 小记卡片富预览（快路径） | 列表渲染 | `QuickNotePreview` + `quickNotePreviewParser` | 正文 body + assets 清单 | 只读（待办勾选是唯一写） | quickNote | `src/features/quickNotes/QuickNotePreview.tsx:166-212` |
| M8 | 小记内核兜底预览 | 出现 `unsupported` 块 | `QuickNoteKernelPreview`（`createLakeDocument viewer` + IntersectionObserver 400px 闩锁） | 正文 body | 只读 | quickNote | `src/features/quickNotes/QuickNoteKernelPreview.tsx:38-80` |
| M9 | 移动非 doc 阅读态 | 打开 usheet/bitable/board/ink | `MobileUsheetViewer/MobileBitableViewer/MobileBoardViewer/MobileInkPad`（`editing=false`） | tab content | 只读（可切编辑） | 4 kind | `src/mobile/notebook/NotePaneHost.tsx:51-126` |
| M10 | 历史版本 Sheet | 属性→历史版本 | **无预览**（列表 + 恢复/删除） | `historyList`（id/title/createdAt） | — | 全 | `src/mobile/notebook/WorkspaceOverlayHost.tsx:165-173` |
| M11 | 资源管理「未引用」资产 | 点行 | 图片→`ImageLightbox`（`dataUrl`），其它→系统打开 | `bridge.readAssetPreview` | 只读 | 附件 | `src/mobile/settings/SettingsDrawer.tsx:144-153`、`src/mobile/MobileApp.tsx:935` |
| M12 | AI 回答 | 消息渲染 | **`AiMarkdown`（自研子集）**（不走内核 viewer） | 消息 text | 只读 | markdown | `src/mobile/ai/MobileAiPage.tsx:261`、`src/mobile/ai/AiHistoryPage.tsx:121`、`src/mobile/ai/AiMarkdown.tsx:1-8` |

> 移动端 `NoteInfoSheet`（属性抽屉）**不做内联预览**，历史跳 M10（`src/mobile/ui/NoteInfoSheet.tsx:1-10`）。移动端**不 import 任何桌面预览宿主**（已核实：`grep -rn 'NoteInfoDialog\|HistorySnapshotPreview\|NoteDocPreview\|HistoryPanel\|TrashPanel' src/mobile` 只命中注释）。

### 1.3 渲染器清单（按能力，不按文件）

| 渲染器 | 实现份数 | 位置 | 说明 |
| --- | --- | --- | --- |
| 内核 Lake viewer（`createLakeDocument(...,"viewer")`） | **4 份包装** | ① `useHistorySnapshotViewer.ts:55` ② `QuickNoteKernelPreview.tsx:63` ③ `AiAnswerViewer.tsx:65` ④ `aiLakeCopyAction.ts:62`（隐藏实例，非用户预览） | 另经 `LakeEditor mode="viewer"` 间接使用：M3 |
| 只读编辑器（桌面） | 4 | `UniverSheetEditor` / `BitableEditor` / `BoardEditor` / `InkPad(readOnly)` | 见 `HistorySnapshotPreview.tsx:141-149` |
| 只读编辑器（移动阅读态） | 4 | `MobileUsheetViewer` / `MobileBitableViewer` / `MobileBoardViewer` / `MobileInkPad` | `NotePaneHost.tsx:51-126` |
| 小记快路径 | 1 | `quickNotePreviewParser.ts` + `QuickNotePreview.tsx` | 覆盖段落/标题/列表/待办/引用/分隔线/行内格式/媒体 |
| markdown 子集 | **2（重复）** | 桌面 `MarkdownView`、移动 `AiMarkdown` | 解析器共用 `src/core/markdown.ts`，渲染各自一套 |
| 原生标签 | 4 处 | `AttachmentPreview`（embed/audio/video）、`HistoryPanel` orphan（img/pre）、`AssetsBrowser`（img/video/audio/iframe）、`NoteInfoDialog` 附件行 | 预览形态最不一致的一类 |
| 结构化摘要 | 1 | `core/historyPreview.ts` → `HistorySnapshotPreview` | 只读兜底，正确 |

### 1.4 代表性调用链（全链路）

**A. 桌面回收站 doc 预览**
`TrashPanel.preview()`（`TrashPanel.tsx:175`）→ `native.ensureTrashNoteAssets` + `native.readNote` → `setSelected({html, kind})` → `<NoteDocPreview noteId body>`（`:350`）→ `useHistorySnapshotViewer`（`NoteDocPreview.tsx:40-51`）→ `createLakeDocument(host,"viewer",noop,tocEnabled=false,noteId,host,prefs)`（`useHistorySnapshotViewer.ts:55`）→ `setDocument("text/lake", addAssetAccessToken(body))` → `requestCardHydration()`。
→ **注意：这条链没有任何图片放大、附件打开、卡片菜单**（`useHistorySnapshotViewer` 只做 create/setDocument）。

**B. 移动回收站 doc 预览**
`TrashList.onPreview`（`src/mobile/settings/TrashList.tsx:87`）→ `TrashPreviewPage`（`SettingsDrawer.tsx:44` lazy）→ `bridge.ensureTrashNoteAssets` + `bridge.readNote`（`TrashPreviewPage.tsx:37-39`）→ `<LakeEditor mode="viewer" prefs={{fontSize: loadSettings().fontSize, showToolbar:false, disableVirtualRendering:true}}>`（`:81-89`）→ `LakeEditor` effect（`LakeEditor.tsx:56-170`）→ `createLakeDocument` + `attachImagePreviewClick(tap)` + `attachFileCardClick` + `attachLongPress`（卡片菜单）+ `attachSelectionClipboard`（copy/cut）。
→ **同一次「回收站预览」，两端能力集不同**（见 D1 专项）。

**C. 小记卡片预览（两端）**
列表投影（无正文）→ `IntersectionObserver` 触发 `readQuickNote`（`QuickNoteCard.tsx:22-34` / `HomePage.tsx:1180-1186`）→ `parseQuickNotePreview(body)`（`QuickNotePreview.tsx:167`）→ `hasUnsupportedNodes` 判据（`quickNotePreviewParser.ts:77`）→ 快路径 `Nodes` 或 `<Suspense><QuickNoteKernelPreview/></Suspense>`（`QuickNotePreview.tsx:200-205`）。首屏正文预热 = `core/quickNoteDetailPrewarm`（AGENTS §4 DT-05 条目）。

**D. 历史快照预览**
`HistoryPanel.previewHistoryInline`（`:218`）→ `native.previewHistorySnapshot(id)`（主进程读历史文件）→ `inline {kind, html}` → doc ? `NoteDocPreview` : `HistorySnapshotPreview`（`:368-370`）→ 后者 `snapshotPreview(kind, body)` 先出结构化摘要，能挂编辑器就 `Suspense key=snapshotId` 挂只读编辑器（`HistorySnapshotPreview.tsx:134-156`）。

### 1.5 数据来源矩阵（同一资源的 4 种取法，已核实）

| 取法 | 用途 | 位置 | 档位/限制 |
| --- | --- | --- | --- |
| 正文里的 src（canonical 资产 URL） | 桌面编辑器图片、桌面小记图 | `extractImagesFromContent`（`imagePreview.ts:84-109`）；`QuickNoteCard.tsx:61` | 原图 |
| `?w=1024` 离散缩略（资产服务档位） | 移动列表图（封面 + 正文预览 + 标签详情） | `quickNoteImage.ts:24-35`；`HomePage.tsx:1193-1196`；`TagQuickNotePreview.tsx:52-55` | 最大 1024 宽 |
| `?base64=1` 原文件 data URL | 复制/剪切物化 | AGENTS §4 `selectionClipboard` 条目 | 原图、上限 24MP |
| `native.readAssetPreview` → `dataUrl` | 资源页未引用预览、AI 选图缩略、画板取字节 | `SettingsDrawer.tsx:148`；`AiImageSheet.tsx:48`；`BoardEditor.tsx:430` | 原生读，另有上限 |

---

## 2. 重复与割裂清单

### 2.0 专项核查（任务书点名的 4 问）

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 只读锁定（`isGoneNote` / 锁定态）在预览里的判据是否单一来源 | **判据单一，但「预览可写能力」没有单一策略。** `isGoneNote` 只在 `core/syncDecisions.ts:69` 定义；桌面消费 4 处（`hooks/useTabLifecycle.ts:83,118`、`hooks/useSyncRefresh.ts:103`、`features/editor/noteRef.ts:80`），移动 1 处（`MobileApp.tsx:698`）。**所有预览宿主都不消费该判据**（预览恒只读，符合预期）；「锁定态预览」= `EditorTab` 的 viewer 分支，其 `readOnly` 由 `lockedNoteIds.has(noteId) \|\| tab.deleted` 派生（`MultiTabEditor.tsx:687,701,719,733,746`）。 | 详见 §2 D2 |
| 移动端 `isGoneNote` 语义与 AGENTS §3#16 是否一致 | **不一致（推断为有意）**：§3#16 要求「只读 + 横幅 + 保存被拦要明说」；移动端是**拒绝打开 + toast 引导回收站**（`MobileApp.tsx:698-700`），桌面是只读 + 状态栏标记（`useTabLifecycle.ts:83`）。 | 需裁决 Q-3（是否登记为已定稿口径） |
| 历史快照预览与文档预览是否重复序列化 | **不重复。** 历史面板拿的是主进程读出的历史文件内容（`native.previewHistorySnapshot`，`HistoryPanel.tsx:221`），不序列化当前文档；桌面编辑器只在**双击图片时**现场 `getDocument` 一次（`EditorTab.tsx:823`，HANDOFF 261112 实测 105ms/736KB，可接受）。风险在别处：同一 note 可**同时**存在 2 个内核实例（编辑器 + 属性弹窗/历史面板预览）。 | `TrashPanel`/`HistoryPanel`/`NoteInfoDialog` 均可与 tab 同时打开 |
| 内核实例创建/销毁策略是否应统一 | **应统一，且是本次最值得做的一项。** 4 份包装各写一套生命周期与 prefs（§2 D5），其中只有 `QuickNoteKernelPreview` 有「视口闩锁 + 进入后常驻」（`QuickNoteKernelPreview.tsx:40-55,75-76`，为解决滚动闪屏），`AiAnswerViewer` 另有一套 600px 预挂载 + ready 轮询 + 超时回退（`AiAnswerViewer.tsx:44-55,110-123`）。 | §3.4 `useReadOnlyKernelViewer` |

### D1【P1｜同类不同实现】「文档只读预览」有两个宿主，能力集不同

- **事实（已核实）**：桌面全部走 `NoteDocPreview`（`NoteDocPreview.tsx:34`，内部 `useHistorySnapshotViewer` 只 create + setDocument + hydration）；移动回收站走 `LakeEditor mode="viewer"`（`TrashPreviewPage.tsx:81`），而 `LakeEditor` 在 viewer 下**仍然挂**：图片预览（`LakeEditor.tsx:94-98`，tap 模式）、file 卡打开（`:114-125`）、长按卡片菜单（`:45-54`，含重命名/剪切/另存）、copy/cut 接管（`:61`）。
- **用户可见后果**：同一份被删文档，在桌面回收站里**看不了大图、点不开附件**；在手机回收站里**能**。反之手机回收站里长按卡片会弹出「重命名 / 剪切 / 另存为」——这些动作在只读预览里**不会落库**（`onChange` 是 `() => undefined`），属于**给了入口但无效果**的误导。
- **不做会付什么代价**：发布后两端口径差异会被当作 bug 反复报（「为什么手机能点开图，桌面不能」），且「只读预览里能剪切」会引发数据焦虑。
- **收益/复杂度**：高/低（复用已有宿主，不新增抽象）。

### D2【P1｜同能力不同参数】「预览里能做什么」没有策略对象，各入口凭自觉

能力矩阵（已核实，✅=有 ❌=无）：

| 入口 | 图片放大 | 打开附件 | 复制选中 | 卡片菜单(改名/剪切) | 内核实例 |
| --- | --- | --- | --- | --- | --- |
| D1 桌面文档编辑器（含锁定态） | ✅ 双击 | ✅ | ✅ | ✅（编辑态） | 1 |
| D5 桌面回收站 doc 预览 | ❌ | ❌ | ❌ | ❌ | 1 |
| D6/D8 历史/属性 doc 快照 | ❌ | ❌ | ❌ | ❌ | 1 |
| M3 移动回收站 doc 预览 | ✅ 单击 | ✅ | ✅ | ✅ | 1 |
| M1 移动文档阅读态 | ✅ 单击 | ✅ | ✅ | ✅ | 1 |
| M7 小记卡预览 | 由宿主传 `onImageClick`（`QuickNotePreview.tsx:150`） | ❌ | ❌ | ❌ | 0 或 1（兜底） |
| D9 标签空间小记预览 | ❌（显式 noop，`TagPreviewBody.tsx:32`） | ❌ | ❌ | ❌ | 0/1 |
| M10 移动历史版本 | ❌（无预览） | — | — | — | 0 |

- **判据分散点**：`LakeEditor` 的能力是「编辑器的能力」，被拿来当预览用 ⇒ 预览能力被动继承编辑器能力；`NoteDocPreview` 的能力是「什么都没有」。二者都不表达「预览该给什么」。
- **不做会付什么代价**：每加一个预览入口（如未来「分享预览」）都要重新决定一遍上面 4 列，且必然与既有入口不一致（本轮 30 个入口已经出现 4 种组合）。

### D3【P1｜同类不同实现 + 参数漂移】「单击看大图 / 双击编辑」判定有两份实现

| 维度 | `attachImagePreviewClick({tap:true})` | `HomePage.handleImageTap` |
| --- | --- | --- |
| 监听 | `pointerdown`（捕获） | React `onClick` |
| 判定窗 | **300ms**（`imagePreview.ts:128`） | **320ms**（`HomePage.tsx:1154`） |
| 同点判据 | 位置差 ≤**28px**（`:130`） | **filename 相同**（`HomePage.tsx:1220`） |
| 取消 | 移动 >12px / scroll / pointercancel（`:221-228`） | 无（滚动不取消，靠 click 本身） |
| 画廊来源 | 正文 resolver（`extractImagesFromContent`） | `previewAssets`（列表投影 images） |

- **为什么是问题**：HANDOFF 261112 已明确记录「`click` 要等 ~150ms、两击间隔实测 251ms、内核点按后会重渲染图片卡 ⇒ 判定必须挂 pointerdown」；`HomePage` 这一份仍是 `click` + 320ms + 按 filename，属**同一坑的第二种做法**，且阈值已漂移（300 vs 320）。改阈值/改判据时必然漏一处。
- **用户可见后果（推断，未实机）**：首页卡片双击延迟与文档内不一致；内核重渲染后 filename 相同时仍能判出双击（这一点比元素身份稳），但两处体验参数不同。
- **建议**：把「tap 判定」抽成一处纯逻辑（`lib/tapWindow.ts`：给 `pointerdown` 时间戳+坐标，返回 `single|double`），两处都调用；`HomePage` 改用 pointerdown。**注意**：这一条改动会动移动端手势，必须过设备装置（AGENTS §3#21 + MOBILE-OPS）。

### D4【P1｜同能力不同参数】「放大看大图」看到的不是同一个档位

- 桌面小记卡 → Lightbox 传的是 `item.content.images` 的原始 URL（`QuickNoteCard.tsx:36-37,61`）⇒ **原图**。
- 移动小记卡 / 标签详情 → 传给 Lightbox 的是 `quickNotePreviewAssetUrl(withToken, mime)`，即 **`?w=1024`**（`HomePage.tsx:1193-1196,1231-1233`；`TagQuickNotePreview.tsx:52-55,63-67`）⇒ 放大后仍是 1024 宽。
- 文档内（两端）→ 走正文 resolver，内核 `ne-image` 的 `src` 在移动端是 `?w=1024` 显示档、桌面是原图；但 `attachImagePreviewClick` 用的是 `element.currentSrc/src`（`imagePreview.ts:158,165`）与 resolver 里的原始 src ⇒ **桌面原图、移动 1024**（移动端文档内 resolver 返回正文 src，未升级原图）。
- **用户可见后果**：手机上点开小记/文档图片「放大」后依然糊（截屏、长图、文档翻拍尤甚）；而 `docs/MOBILE-DESIGN.md:309` 写的是「大图预览取原图」——**文档与实现不一致**（该句只对写作卡/文档编辑器成立，对小记列表卡不成立）。
- **不做会付什么代价**：用户报「预览不清楚」，且会被误判成内核/资产服务问题。
- **建议**：Lightbox 不接收「显示 URL」，接收 `PreviewAssetRef`（noteId + filename + 可选原始 src）；由**一处** `resolvePreviewAssetUrl(ref, {intent:"display"|"original"})` 决定档位。收益/复杂度：高/低。

### D5【P1｜同一能力多份复制】内核只读 viewer 的 4 份包装器

| 包装器 | 视口策略 | prefs | 失败策略 |
| --- | --- | --- | --- |
| `useHistorySnapshotViewer.ts:45-66` | 无（调用方容器滚） | 调用方传（`NoteDocPreview` 给 16px + disableNativeToc） | `onError` 回调 |
| `QuickNoteKernelPreview.tsx:38-80` | IntersectionObserver 400px + **进入后常驻** | 硬编码 14px + disableNativeToc + disableVirtualRendering | 静默（留空块） |
| `AiAnswerViewer.tsx:36-128` | IntersectionObserver 600px | disableNativeToc + disableVirtualRendering + showToolbar:false + floatingToolbar:false + blockHandle:false | 轮询 6s 超时 → onError，父级回退 MarkdownView |
| `aiLakeCopyAction.ts:62` | 隐藏离屏 | 各自一写 | try/catch |

- **共同重复**：`createLakeDocument` 参数位（mode/noteId/scrollNode）、`addAssetAccessToken` 包裹、`destroyLakeEditor`、卸载清理。**已有 1 处被统一**（`NoteDocPreview` 让 4 个宿主共用同一实现，`NoteDocPreview.tsx:1-14` 注释记录了这次合并的原因），说明这条路走得通；剩下 3 份仍是裸写。
- **不做会付什么代价**：每加一个「内核只读预览」（如移动端历史快照预览）就要复制第 5 份，且很可能忘 `addAssetAccessToken`（图片 401）或忘 `disableVirtualRendering`（正文只画一屏——`QuickNoteKernelPreview.tsx:64-66` 与 `AiAnswerViewer.tsx:67-68` 都记录了该坑）。

### D6【P2｜同一解析器多处复制】图片来源 4 套（§1.5）

- 4 种取法各自有上限/语义（1024 / 24MP / 原生上限 / 原图），预览清晰度、内存、缓存命中互相影响（同一张图在封面与正文同 URL 是刻意优化：`quickNoteImage.ts:10-14`）。**预览层不应再新增第 5 套**，而应收敛为「给 Lightbox 传引用」。
- **不做会付什么代价**：现在每次新预览入口都要自己拼 URL（本轮 8 处 `openImagePreview` 调用即有 4 种拼法）。

### D7【P2｜浮层行为各自实现】两个沉浸浮层的「共同语义」各写一遍

| 语义 | `ImageLightbox.tsx` | `AttachmentPreview.tsx` |
| --- | --- | --- |
| portal 到 body | `:100-127` | `:74-122` |
| Esc（走 `dismissImmersivePreview`） | `:34-45` | `:27-32` |
| 页面滚动锁 | `:47-50` | `:34` |
| 入场动效 | CSS `image-lightbox-fade` | 复用同一个 keyframes（`attachment-preview.css:10`） |
| 状态栏样式（移动） | **未设置** | `SystemBarsStyle.Light`（`AttachmentPreview.tsx:39-59`） |
| mac 红绿灯让位 | 无 | `.is-mac` + 82px（`:69-72`） |

- **后果**：两者表面共用 `--lake-media-scrim` + 14px blur（`image-lightbox.css:1-14`、`attachment-preview.css:1-14`），但移动端状态栏图标只在附件预览里被切成深色；**图片 Lightbox 在同样浅背景上没切**（推断：深色主题下可能状态栏对比不足，需实机确认）。
- **收益/复杂度**：中/低（抽 `useImmersiveOverlay({onDismiss})` 一个 hook，仍不共享 CSS）。

### D8【P2｜同能力不同参数】预览正文字号按宿主漂移

| 宿主 | 字号 | 证据 |
| --- | --- | --- |
| `NoteDocPreview`（回收站/历史/属性） | **16px**（阅读档） | `NoteDocPreview.tsx:21,45-46`；令牌 `--lake-font-size-preview: 16px`（`src/styles/themes/base.css:103`） |
| `QuickNoteKernelPreview`（小记兜底） | **14px** | `QuickNoteKernelPreview.tsx:69`（261111 因「有的字大有的字小」定为 14） |
| `AiAnswerViewer` | 内核默认（未传 fontSize） | `AiAnswerViewer.tsx:65-72` |
| 移动回收站预览（LakeEditor） | **用户设置字号** | `TrashPreviewPage.tsx:88`（`loadSettings().fontSize`） |

- **判断**：16 与 14 的差异**有理由**（一个是整篇阅读档、一个是卡片内嵌密排，见各自注释），**不算缺陷**；但「移动回收站预览跟随用户设置字号，而桌面回收站预览固定 16」是两端不一致，且移动端超出 16 档时与历史/属性（若未来接入）会不一致 ⇒ 列入 §7 裁决（Q-4）。**不要把 4 处强行统一成一个数字。**

### D9【P2｜能力缺口】历史版本：桌面可预览，移动只能「盲恢复」

- 桌面：`HistoryPanel`/`NoteInfoDialog` 都能内联预览快照（D6/D8）。
- 移动：`WorkspaceOverlayHost.tsx:165-173` 只渲染 `title + createdAt + 恢复/删除`，**没有任何正文预览**，点击行直接 `onRestoreHistory`（`WorkspaceOverlayHost.tsx:169`）。
- **用户可见后果**：手机上恢复历史版本 = 覆盖当前内容（`HistoryPanel.tsx:180` 的确认文案同款语义），**看不到即将恢复的是什么**。桌面已明确提示「会覆盖当前内容（含只读/锁定文档）」。
- **不做会付什么代价**：误恢复（用户以为能先看看）。属真实风险，但修法有成本（需桥 `previewHistorySnapshot` + 只读渲染 + 非 doc 挡）⇒ §7 Q-2。

### D10【P2｜内容取舍不一致】同一个「只读预览」在不同空间渲染不同东西

- 标签空间：doc **不内嵌正文**，只给「点击打开文档」卡片（`TagsWorkspace.tsx:568-578`，注释记 261106 决定）。
- 回收站/历史/属性：doc **内嵌整篇正文**（D5/D6/D8）。
- **判断**：这是**已定稿的产品差异**（标签空间是扫列表，回收站要判断「是不是这篇」），**不建议合并**；但应在能力层里表达为 `previewPolicy.inlineBody: boolean`，而不是「两个宿主各自实现」。已列入 §3，不列为缺陷。

### D11【P2｜代码/文档腐化】3 处「看起来还在用」的死路径与过期注释

1. `TagPreviewBody.tsx` 的 doc / 非 doc 分支**不可达**：唯一调用点 `TagsWorkspace.tsx:587` 只传 `kind="quickNote"`（已核实：`grep -rn 'TagPreviewBody' src` 仅 2 处）。`src/components/app/tagsSpaceWiring.test.ts` 仍在断言 `PREVIEW` 源码里含 `NoteDocPreview`/`HistorySnapshotPreview` ⇒ **测试在保护死代码**，且给人「标签空间 doc 走 NoteDocPreview」的错觉。
2. `imagePreview.ts:2-7` 的函数头仍写「Lake envAdapter.previewImgs → lakeRuntime 的 envAdapter 调 open()」——**已核实 src/ 下 `previewImgs` 只有 3 处命中且全部是 `imagePreview.ts` 自己的注释（:2/:4/:81），没有任何代码调用**；实现只在 `vendor/lakex-doc-react/src/components/lakex/{types.ts:32,lakex.js:36569-36690}`（未接）。同文件 `:81` 与 `LakeEditor.tsx:87` 都已注明「该构建 allowClickToMaximize 无效」。头部注释是过期设计描述，会误导后来者去接 envAdapter。
3. `NoteDocPreview.tsx:36-46` 与 `HistorySnapshotPreview.tsx:122-132` 的 `isMobileEnvironment()` 分支：移动端**不 import 这两个文件**（已核实），分支疑似不可达（**推断**：除非未来移动端借道桌面组件）。移动端已有明确替代（`NoteInfoSheet` 注释 `:4-8`）。

- **代价**：低（无用户影响），但发布前开源会把这些当「设计说明」读 ⇒ 建议一并清理/更正（属「文档修正」，不是重构）。

### D12【已统一，不要动】小记预览「快路径 + 内核兜底」的判据

- 判据单一来源 = 解析器自己的 `unsupported` 节点（`quickNotePreviewParser.ts:72-79`），`QuickNotePreview` 据此整条切内核（`QuickNotePreview.tsx:174,200-205`）；首屏正文预热判据单一来源 = `core/quickNoteDetailPrewarm`（AGENTS §4 DT-05）。
- **结论**：这是全仓最干净的一处「两种渲染器一个入口」，**应作为能力层范本，而不是被统一掉**。

---

## 3. 统一能力层设计（第一性原理）

### 3.1 能力边界：预览是什么、不是什么

**预览 = 用只读形式把「一段内容」呈现给用户，并且不产生任何写盘副作用。**

拆成 5 个正交问题（每一问都已有单一来源或应有一个）：

1. **预览什么**（内容种类）→ `PreviewSource`（文档 / 历史快照 / 小记 / markdown / 附件 / 图片）。
2. **谁提供内容**（数据获取）→ 调用方（各空间既有 IPC/bridge：`native.readNote`、`native.previewHistorySnapshot`、`bridge.readQuickNote`…）。**能力层不碰数据层**。
3. **怎么按 kind 分派**（渲染）→ `PreviewRenderer` 注册表（doc→内核 viewer；usheet/bitable/board/ink→只读编辑器；quickNote→快路径+内核兜底；markdown→内核 viewer；附件/图片→沉浸浮层）。
4. **预览里允许做什么**（交互）→ `PreviewPolicy`（`zoomImage` / `openAttachment` / `copySelection` / `cardMenu` / `inlineBody`）。
5. **在哪里呈现**（容器）→ 宿主容器（内嵌 pane / Sheet / 沉浸浮层）。**样式与几何两端独立**（AGENTS §3#14、§4 移动端自有设计层）。

**明确不是**：不是「一个万能 Preview 组件」（那会把 doc/表格/画板/小记 4 套引擎塞进一个 state machine，撞 §3#17 过度设计红线）；不是「跨端共享 UI」（两端 UI 仍独立）；不是「内容获取抽象」（不新建第二条数据通道）。

### 3.2 分层（只抽已经有 ≥2 份实现的东西）

```
L0 原语（已存在，不改）
  components/ui/Overlay.tsx · lib/pageScrollLock · lib/immersivePreview · AttachmentChipList/FileKindIcon
L1 资产引用与档位（新增 1 个纯函数模块）
  lib/previewAsset.ts     resolvePreviewAssetUrl(ref, intent)   ← 收编 D4/D6
L2 只读内核宿主（新增 1 个 hook）
  features/preview/useReadOnlyKernelViewer.ts                  ← 收编 D5（4 份→1 份）
L3 渲染分派（新增 1 个纯映射 + 复用现有组件）
  features/preview/renderers.ts  (kind → component)            ← 只做映射，不含逻辑
L4 策略对象（新增 1 个类型 + 两端各自默认值）
  features/preview/policy.ts     (PreviewPolicy + defaults)
L5 宿主（既有，保持两端独立）
  桌面：NoteDocPreview / HistorySnapshotPreview / AttachmentPreview / ImageLightbox / AiAnswerViewer
  移动：TrashPreviewPage / TagQuickNotePreview / QuickNoteKernelPreview / QuickNotePreview …
```

### 3.3 建议模块/文件布局（TS）

```
src/features/preview/
  types.ts                 # PreviewSource / PreviewPolicy / PreviewAssetRef
  previewAsset.ts          # 档位解析（display / original / materialized）
  useReadOnlyKernelViewer.ts
  renderers.ts             # kind → renderer 映射（唯一分派点）
  policy.ts                # 两端默认策略（桌面/移动各一）
  preview.module.css?      # ❌ 不建：样式仍归各宿主与两端样式层
```

> 迁移期可先把 `useReadOnlyKernelViewer` 放 `src/components/hooks/`（与既有 `useHistorySnapshotViewer` 同目录），稳定后再挪不必强求。

### 3.4 核心 API 形状（类型草案，不含实现）

```ts
// types.ts
export type PreviewContentKind = "doc" | "usheet" | "bitable" | "board" | "ink" | "quickNote" | "markdown";

/** 预览的内容描述：只管「是什么 + 正文/引用」，不管怎么取（取数仍归宿主）。 */
export type PreviewSource =
  | { type: "note"; noteId: string; kind: PreviewContentKind; body: string; title?: string }
  | { type: "historySnapshot"; noteId: string; snapshotId: number; kind: PreviewContentKind; body: string }
  | { type: "quickNote"; noteId: string; body: string; assets: PreviewAsset[]; hiddenMediaNames?: ReadonlySet<string> }
  | { type: "markdown"; text: string };

/** 预览资产的「引用」（不含具体 URL 档位）：档位由 intent 决定，调用方不再各拼 URL。 */
export interface PreviewAssetRef {
  noteId: string;
  filename: string;
  /** 原始显示 src（正文里的 canonical URL，可含 token）；缺省时按 noteId+filename 生成。 */
  src?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}

/** 预览里允许做什么 —— 单一策略对象（本轮 30 入口的 4 种组合收敛为 5 个预设）。 */
export interface PreviewPolicy {
  /** 整篇内嵌正文（false = 只给「打开」入口，如标签空间）。 */
  inlineBody: boolean;
  /** 图片可放大（Lightbox）；放大时取原图还是显示档。 */
  zoomImage: false | { intent: "display" | "original" };
  /** 附件/文件卡可点开（系统或内嵌）。 */
  openAttachment: boolean;
  /** 允许复制正文选区。 */
  copySelection: boolean;
  /** 允许卡片右键/长按菜单（重命名/剪切/另存为）。 */
  cardMenu: boolean;
  /** 视口策略：常驻 / 进入后常驻 / 离开即销毁。 */
  mount: "keep-alive" | "reveal-latch" | "lazy-destroy";
}

export const PREVIEW_POLICY: Record<"docPane" | "trash" | "history" | "tagSpace" | "quickNoteCard", PreviewPolicy>;
```

```ts
// useReadOnlyKernelViewer.ts —— 4 份包装器收敛后的唯一宿主 hook
export interface ReadOnlyKernelViewerOptions {
  hostRef: React.RefObject<HTMLElement | null>;
  /** 内容身份：变化时只 setDocument，不重建实例（历史面板切快照靠这条）。 */
  key: string | null;
  body: string | null;
  /** 图片/附件解析需要；小记兜底也要与编辑态同一个 id。 */
  noteId: string | null;
  scrollNode?: HTMLElement | (() => HTMLElement | null) | null;
  /** 预览档字号（单一来源：--lake-font-size-preview / 卡片密排档，调用方给，不各自硬编码）。 */
  fontSize: number;
  /** 视口闩锁（QuickNoteKernelPreview 现有语义），其余宿主传 keep-alive。 */
  mount?: PreviewPolicy["mount"];
  /** 正文形态：doc 走 text/lake，AI 回答走 text/markdown。 */
  docType?: "text/lake" | "text/markdown";
  onReady?(): void;
  onError?(message: string): void;
}
export function useReadOnlyKernelViewer(options: ReadOnlyKernelViewerOptions): { instance: LakeEditorInstance | null; revealed: boolean };
```

```ts
// previewAsset.ts —— 只做档位决策，不做取数
export function resolvePreviewAssetUrl(ref: PreviewAssetRef, intent: "display" | "original" | "materialized"): string;
```

**不变量（写成护栏，不是口号）**：
- I1 能力层组件**不 import** `native` / `bridge`（内容由调用方给）。
- I2 能力层组件**不 import** 桌面样式或移动样式；只 import 自身逻辑模块。
- I3 `useReadOnlyKernelViewer` 是 `createLakeDocument("viewer")` 的**唯一**外部调用者（新增消费者必须登记 `desktopKernelLazy.test.ts` 的 lazy 边界）。
- I4 预览永不高频 `getDocument`：只在用户显式动作（双击看图）时现算（沿用 `EditorTab.tsx:821-827` 策略）。

### 3.5 状态与生命周期（统一后的唯一口径）

| 场景 | 策略 | 理由 / 现状来源 |
| --- | --- | --- |
| 切内容同文档（历史快照逐条点、小记正文变更） | **只 `setDocument`，不重建** | 已有事实：`useHistorySnapshotViewer.ts:52-61`、`AiAnswerViewer.tsx:91-104`；重建会塌高度/滚动跳（`AiAnswerViewer.tsx:10`） |
| 换文档 / 宿主 DOM 换 | **销毁重建** | `useHistorySnapshotViewer.ts:52`（hostNode/note 双判据） |
| 列表里的预览（小记卡、AI 消息） | **视口闩锁 + 进入后常驻** | `QuickNoteKernelPreview.tsx:40-55,75-76`（离开视口销毁 = 滚动闪屏，261111 已定） |
| 离开预览态 | **立即销毁** | `useHistorySnapshotViewer.ts:48-50`（别把内核挂在没人看的节点上） |
| 解锁/锁定切换（桌面 tab） | **旧挂载点标 `is-outgoing` 交接** | `lakeRuntime.ts:828-834`（白屏闪烁的既有解法，预览不需要，但要知悉不可抢这个机制） |

### 3.6 资产解析与只读渲染的统一

- **只读渲染统一**：由 `renderers.ts` 一处分派；`HistorySnapshotPreview` 的结构化摘要保留为**兜底渲染器**（不是第二套主渲染）。
- **资产解析统一**：Lightbox 的入参从 `PreviewImage[] {src}` 改为 `PreviewAsset[] {ref, displaySrc, originalSrc}`；`openImagePreview` 保留旧签名做**薄适配**（一次性的，不是兼容层——按 §3#7，调用点本轮全部迁移后即删）。
- **档位单一判据**：`intent: "display"` → `?w=1024`（列表/卡片）；`\"original\"` → 去掉 `w`/`date`、保留 `token`（放大）；`\"materialized\"` → `?base64=1`（复制）。这三个语义**已经在仓里各自存在**（`quickNoteImage.ts`、`selectionClipboard` 的 `canonicalAssetUrlForCopy`、`AssetServer`），本层只是把它们挂到同一个函数名上。

### 3.7 两端差异如何收敛

| 层 | 共享 | 必须两端独立 |
| --- | --- | --- |
| 内容种类/策略类型（L4） | ✅ 类型 + 默认值常量 | 各端选哪个预设由各端决定（如移动回收站 `trash` = zoom+attachment 开、cardMenu 关） |
| 只读内核宿主（L2） | ✅ hook 逻辑（纯 DP，无样式） | 挂载容器/高度/滚动归属（桌面由 `.trash-preview-viewer` 等类，移动由 `mb-*` 自己的容器） |
| 渲染分派（L3） | ✅ 映射表 | 具体组件两端本来就不同（`BoardEditor` vs `MobileBoardViewer`） |
| 资产档位（L1） | ✅ 纯函数 | 移动多一个 `?w` 默认档（列表图）——用参数表达，不写两套 |
| 视觉/几何/图标/字号 | ❌ | ✅ 全部两端独立（AGENTS §3#14、§4「移动端有自己的设计与样式层」） |
| 沉浸浮层（Lightbox/附件） | 已是一套（`ImageLightbox`/`AttachmentPreview` 两端共用） | 状态栏、安全区、mac 让位属平台差异，允许在组件内 `isDesktop()`/Capacitor 判定 |

---

## 4. 迁移路线（每阶段可独立合入、可回退）

> 顺序原则：**先零行为改动收口，再改用户可见语义**；每阶段结束都能 `git revert` 单阶段而不牵连其它阶段。
> 门禁按 AGENTS §3#21：①`tsc --noEmit` + 相关 vitest + `git diff --check`；②动样式加 `ui-metrics` + `cssLayers`；③动移动端手势/几何 ⇒ 设备装置 + `bash scripts/android-build.sh --sync --install`。

### Phase 0（P0｜0.5 天｜**零行为改动**）事实固化 + 文档纠偏 + 护栏

- 修正 D11 的 3 处：`imagePreview.ts:2-7` 头注释改为「正文解析 + 宿主挂载，不经 envAdapter」；`TagPreviewBody.tsx` 删除不可达的 doc/其余分支或在其上方明写「当前不可达（仅 quickNote 调用）」；`tagsSpaceWiring.test.ts` 的 `PREVIEW` 断言同步（**先断言现状再改，避免红**）。
- 新增 1 个「入口事实表」测试（源码断言或快照）：`NoteDocPreview` 是 doc 只读预览唯一实现、`QuickNotePreview` 是唯一小记预览入口、`ImageLightbox` 唯一订阅 `imagePreview`。**这是本轮唯一「只加约束不加抽象」的阶段**。
- 回退：纯文档+测试，revert 无风险。

### Phase 1（P1｜2–3 天）L2：`useReadOnlyKernelViewer` 收口 4 份包装器

- 迁移顺序（小到大）：`useHistorySnapshotViewer`（最简，行为最稳）→ `QuickNoteKernelPreview`（闩锁语义）→ `AiAnswerViewer`（ready 轮询/超时保留在组件内，只把 create/destroy/prefs 交给 hook）。
- **不得**改 `NoteDocPreview` 的对外签名；`LakeEditor` / `EditorTab` 本阶段**不动**（它们是编辑器，不是只读预览；换掉风险大，见 §5）。
- 护栏：
  - 既有：`NoteDocPreview.render.test.tsx`、`HistorySnapshotPreview.render.test.tsx`、`imagePreviewAttach.render.test.tsx`、`quickNotePreview.hiddenMedia.render.test.tsx`。
  - 新增：`useReadOnlyKernelViewer.test.ts` —— ①同 key 只 setDocument（spy 调用次数）②换 key 重建 ③卸载销毁 ④`docType` 透传 ⑤`addAssetAccessToken` 一定被调用（防 401 回归）。
  - 对拍：同一 body 走旧/新实现的 DOM 元素数与 `ne-viewer` 根类一致（快照级）。
- 回退：hook 是新增文件，旧实现可保留一版（**不留兼容层**：A-B 对拍完即删旧代码，符合 §3#7）。

### Phase 2（P1｜1–2 天）L4：`PreviewPolicy` + 修 D1（两端回收站能力集）

- 先落**类型与预设**（无行为改动），再逐入口接：
  - 桌面回收站/历史/属性 doc 预览 → `policy = trash|history`：**新增图片放大**（`zoomImage: {intent:"original"}`）。实现方式：`NoteDocPreview` 内挂 `attachImagePreviewClick`（不需要编辑器能力面），双击看图。
  - 移动回收站 `TrashPreviewPage` → 改为 `policy = trash`，**cardMenu:false**：给 `LakeEditor` 增加 `interaction?: "editor" | "preview"`（或复用 prefs 增加 `cardMenu:false`），在 preview 档跳过 `attachLongPress` / `attachSelectionClipboard`；保留 tap 图片预览与 file 卡打开。
- 护栏：`trashPreview.render.test.tsx`（新）——①桌面回收站预览双击图片打开 Lightbox ②移动回收站预览不渲染卡片菜单 ③两端的 `policy` 常量断言（源码级，防漂移）。
- 回退：`LakeEditor` 新增可选 prop，默认值 = 现有行为 ⇒ 单删 prop 即回到今天。
- **风险**：`LakeEditor` 是移动端文档编辑器主路径，改动必须跑设备装置（AGENTS §3#21 ②③）。

### Phase 3（P2｜1–2 天）L1：图片来源档位统一（修 D4）

- 新增 `previewAsset.ts`；`openImagePreview` 增加可选 `assets: PreviewAssetRef[]`，Lightbox 在**打开时**按 `intent` 决定 `originalSrc`（懒取，不预加载）；先迁移移动 3 处（`HomePage` / `TagQuickNotePreview` / 内核兜底），再迁桌面 `QuickNoteCard` / `BitableEditor` / `SettingsDrawer`。
- 护栏：`previewAsset.test.ts`（档位/去 query/保留 token/非图片原样）+ 设备实测项（小记 4000×3000 图点开后的 `naturalWidth`，**这是唯一必须实机的一条**）。
- 回退：`openImagePreview` 旧签名仍可用；迁移点逐个 revert 不互相影响。

### Phase 4（P2｜可选｜1 天）D3：tap 判定抽纯函数

- `lib/tapWindow.ts` + 两处调用（`imagePreview.attach`、`HomePage.handleImageTap`）；`HomePage` 从 `click` 改 `pointerdown` 属**行为改动**，必须设备级验证（HANDOFF 261112 已给出验收脚本口径：单击→「1/1」、双击→进编辑、无 Lightbox）。
- 回退：纯函数无状态，改回原实现只需还原 2 个调用点。

### Phase 5（不建议本轮做）

- 移动历史版本预览（D9）、移动 AI 上内核视图（Q-7）、跨端 markdown 渲染统一：见 §7 裁决，**默认不做**。

---

## 5. 风险与代价

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 内核实例内存 | AGENTS/`QuickNotePreview.tsx:4-6` 记「每实例 ≈ +5MB RSS」。收口 hook 后**实例数不减**（策略不变），只是代码归一；若 Phase 2 给桌面回收站预览加图片放大，**不新增实例**（同一实例 + DOM 监听） | 上限：预览实例数 = 可见预览数；列表场景务必用 reveal-latch |
| 首屏预算 | 桌面 `check-arch` 首屏 600KB / `check-bundle` app-js 300KB；`preview/` 新模块必须**纯逻辑 + 按需 import**，会被现有 lazy 边界（`TrashPanel`/`HistoryPanel`/`NoteInfoDialog`/`QuickNoteEditor`/`EditorTab`）带入。**禁止**从 `App.tsx` 静态 import `useReadOnlyKernelViewer`（它会拉 `lakeRuntime`） | Phase 1 结束时跑 `npm run check:arch && npm run check:bundle`；`desktopKernelLazy.test.ts` 需新登记 |
| 懒加载边界 | `desktopKernelLazy.test.ts` 钉死「内核只经 5 个 lazy 边界」。新增预览消费者（如桌面回收站加图片放大）**不引入内核**，不破边界；但 Phase 1 的 hook 会被这些边界内的组件 import，需确认不在入口静态图 | 同上；逐个 `grep` 首屏静态图 |
| 视口闩锁与滚动容器 | `NoteDocPreview` 的滚动在调用方容器，`useHistorySnapshotViewer` 却把 `host` 当 `scrollNode`（`useHistorySnapshotViewer.ts:55` 第 6 参）。当前 viewer 桌面开 `tileRendering`（`lakeRuntime.ts:928`），**不依赖 scrollNode 做虚拟渲染**（261111 已核实「virtualRendering 对 Viewer 是 no-op」），所以现状 OK；若将来给 viewer 接虚拟渲染，这条会立刻变成「正文只画一屏」 | 在 hook 里显式声明 `scrollNode` 语义，并在测试里钉「viewer 不虚拟渲染」 |
| 设备级验证成本 | Phase 2/4 动移动端手势与 `LakeEditor` ⇒ 必须装包 + 快照 10 态 + 23 屏走查 | 按 AGENTS §3#21 只跑受影响态；提前在提交说明写清「哪些态预期会变」 |
| 性能 | Lightbox 打开时若现取原图（Phase 3），大图解码内存上升（移动 4000×3000 ≈ 48MB，`quickNoteImage.ts:6-7` 有实测口径）。当前列表已用 1024 避免该问题 ⇒ 原图只在**打开后**取，且同一时刻只 1 张 | 保留 `?w=1024` 做首帧，原图替换为「加载完成后替换 src」；不接受则维持现状（§7 Q-1） |
| 回退成本 | 每阶段独立；Phase 0/1/3 纯新增+迁移，回退 = 还原调用点；Phase 2 唯一需要动 `LakeEditor`（默认值兜底） | 每阶段一个 commit，带护栏测试 |

---

## 6. 明确不做（附理由）

1. **不做「万能 Preview 组件」**：把 doc/表格/多维表/画板/手写板/小记/markdown 塞进一个 state machine = 5 套引擎同时受一个抽象支配，撞 §3#17「把两个本就不同的东西强行合并」。
2. **不做跨端共享组件/CSS**：AGENTS §3#14「移动端独立实现同一模型」、§4「移动端有自己的设计与样式层」。能力层只共享**纯逻辑**。
3. **不删/不合并 `HistorySnapshotPreview` 的结构化摘要**：它是「编辑器加载失败/移动端不支持/正文损坏」的兜底（`HistorySnapshotPreview.tsx:114-132`），也是 XSS 面的替代（`NoteInfoDialog.tsx:126-127`）。删了会退化成空白或危险 innerHTML。
4. **不重写 usheet/bitable/board/ink 的只读渲染**：它们已有 `readOnly` 档且被两端复用（`InkPreview.tsx:3-12` 记录「不另写渲染器」），只读渲染是引擎内部语义，重写=制造第二套。
5. **不把 `EditorTab`/`LakeEditor` 改造成「预览组件」**：它们是编辑器（含锁/解锁交接、自愈、tileRendering、输入法抑制等 1000+ 行语义），预览只是借它的 viewer 模式。统一层只规定「预览怎么用编辑器」，不改编辑器。
6. **不清理 vendor / 不新增内核 patch**：`previewImgs` 等内核能力现状已记录为「本构建无效」，不去反编译接它。
7. **不为旧数据写预览兼容**（§3#7）：`extractImagesFromContent` 对旧形态（裸 `<img>`、value 即 URL）已有兜底（`imagePreview.ts:101-107`），属于**当前格式解析**而非历史兼容，保留；不再新增兼容分支。
8. **不新增依赖**（§3#22）：无 Tailwind/Radix/动画库需求，本设计零新依赖。
9. **不做「预览内编辑」**（如预览里勾待办以外的写操作）：唯一例外已定稿 = 小记卡待办勾选（`QuickNotePreview.tsx:96-97,115-124`）。

---

## 7. 需用户裁决

| # | 事项 | 选项 | 推荐 | 理由 / 代价 |
| --- | --- | --- | --- | --- |
| Q-1 | 手机「点开大图」是否必须原图（D4） | A 维持 1024 缩略 / B 打开后切换原图 / C 全部原图 | **B** | 现网 `docs/MOBILE-DESIGN.md:309` 写「大图预览取原图」，实现不符；B 代价 = 一次额外请求 + 单张大图解码内存（约 48MB/4000×3000），需在 5554 实测 RSS |
| Q-2 | 移动端历史版本是否要快照预览（D9） | A 不做 / B 仅 doc 预览 / C 全 kind | **B（下个版本）** | 盲恢复有误操作风险；B 需要桥 `previewHistorySnapshot` 暴露到移动（能力名已登记在 `src/mobile/native/lakeNativeContract.ts:20` 与 `src/core/maintenancePolicy.ts:137`；注意 `src/core/repositoryCapabilities.ts:91` 那一行是 `readAssetPreview`/`previewNoteOrphan`，不含历史快照），成本 1 天 + 设备验证 |
| Q-3 | 移动端「打开已进回收站的文档」= 拒绝打开（toast）还是只读打开（横幅） | A 维持现状 / B 对齐 §3#16 只读+横幅 | **A + 在 HANDOFF 登记为定稿** | 现状可用且更省事；但 §3#16 字面要求是「只读 + 横幅」，需明确这是**有意例外**，否则后续审计会反复提 |
| Q-4 | 移动回收站预览字号 = 用户设置 vs 预览档（D8） | A 维持设置字号 / B 统一预览档 | **B（与 NoteDocPreview 同口径，移动可用自己的档值）** | 两端「同一份内容」的字号语义应对齐；代价极小（一个 prefs 值） |
| Q-5 | 桌面回收站/历史预览是否加「图片放大」（D1） | A 不加 / B 加（复用 `attachImagePreviewClick`，双击） | **B** | 成本约 30 行 + 1 测试，收益 = 与移动端一致；风险 = 预览里双击与「选中文本」无冲突（预览无编辑语义） |
| Q-6 | 是否允许把 `LakeEditor` 加 `interaction:"preview"` 档（禁用卡片菜单/复制） | A 允许 / B 只改移动回收站为 NoteDocPreview（则丢图片放大） | **A** | B 会让移动回收站彻底没有预览能力；A 只需默认值兜底，风险可控 |
| Q-7 | AI 回答预览两端是否统一（桌面内核 / 移动自研 Markdown） | A 维持现状 / B 移动也上内核 viewer | **A（不做）** | B = 移动 AI 页首次拉 6.1MB 内核 chunk + 每消息实例（`QuickNotePreview.tsx:18-26` 的冷启动教训）；收益只是公式/表格显示，撞 §3#17 |
| Q-8 | 标签空间 doc 是否内嵌正文（D10） | A 维持「点击打开」 / B 内嵌只读正文 | **A** | 261106 已定稿；B 会让标签空间同时挂 2 个内核实例（列表 + 预览），且滚动容器冲突 |

---

## 附录 A · 跨域线索（只记录，不深挖）

1. **`isGoneNote` 语义在移动端绕开了 §3#16 的「只读+横幅」**（`MobileApp.tsx:698`）——归属「删除/恢复语义」域，本轮只记线索。
2. **`native.previewHistorySnapshot` 已在移动端能力登记表里**（`src/mobile/native/lakeNativeContract.ts:20`、`src/core/maintenancePolicy.ts:137`），但没有移动 UI 消费它 ⇒ 若做 Q-2，数据层不用新开桥。
3. **`docs/ARCHITECTURE.md` 全文 0 处提到「预览」**（`grep -n -i 'preview\|预览' docs/ARCHITECTURE.md` 无输出）——预览作为跨端能力没有架构位置，建议在 §3 落地后补一节（属文档域）。
4. **`docs/MOBILE-DESIGN.md:411` 与 `docs/DESIGN.md:410` 已钉「预览优先接收 Esc、滚动锁计数」**，与 `src/lib/immersivePreview.ts` + `lib/pageScrollLock` 实现一致；新增预览入口**必须**走这两个原语，否则会与「Esc 只关最上层」护栏（`src/testing/previewOverlay.render.test.tsx`）冲突。
5. **`src/testing/previewOverlay.render.test.tsx` 是两端共同护栏**（Lightbox + AttachmentPreview + Dialog + Pad Esc + 滚动锁），任何浮层改动先跑它。
6. **`desktopKernelLazy.test.ts`** 是内核懒边界护栏：新增任何「预览消费者」必须同时登记（AGENTS §4）。
7. **AI 复制为 Lake 的隐藏内核实例**（`aiLakeCopyAction.ts:62`）不在用户可见预览里，但同属「只读 viewer 实例」清单，Phase 1 收口时可一并纳入 hook（或明确排除并注释）。

## 附录 B · 未覆盖清单

- 平板（pad）下的预览几何与手势（`src/mobile/pad/`）：走同一 `NotePaneHost`，本轮未单独核对。
- 导入/分享链路里的「内核渲染」（`src/mobile/import/markdownShareImport.ts:44`、`src/features/import/markdownImportPipeline.ts:282`）：是导入解析，不是预览，未纳入。
- 内核自身 `.ne-viewer` 的预览能力（如 `allowClickToMaximize`、`previewImgs`）内部路径：按 AGENTS 不深挖 vendor。
- 实机观感与内存数据：见 §0.3。

## 附录 C · 可复现命令（仓库根执行）

```bash
# 入口/渲染器清单
grep -rn 'createLakeDocument(' src --include='*.ts' --include='*.tsx' | grep -v test | grep -v 'export function'
grep -rn 'attachImagePreviewClick' src --include='*.ts' --include='*.tsx' | grep -v test
grep -rn 'openImagePreview(' src --include='*.ts' --include='*.tsx' | grep -v test
grep -rn 'openAttachmentPreview(' src --include='*.ts' --include='*.tsx' | grep -v test
grep -rn '<QuickNotePreview' src --include='*.tsx' | grep -v test
grep -rn 'NoteDocPreview\|HistorySnapshotPreview' src --include='*.tsx' | grep -v test
grep -rn 'TagPreviewBody' src | grep -v '\.test\.'

# 只读判据
grep -rn 'isGoneNote' src --include='*.ts' --include='*.tsx' | grep -v test
grep -n 'readOnly=' src/features/editor/MultiTabEditor.tsx

# 图片来源档位
grep -rn 'quickNotePreviewAssetUrl\|withAssetWidth\|readAssetPreview' src --include='*.ts*' | grep -v test
grep -n 'CARD_IMAGE_THUMB_PX\|quickNotePreviewAssetUrl' src/mobile/home/quickNoteImage.ts

# 浮层与滚动锁
grep -rn 'lockPageScroll\|dismissImmersivePreview\|trackImmersivePreview' src --include='*.ts*' | grep -v test
grep -rn 'SystemBars' src --include='*.tsx' | grep -v test

# 预览测试文件（文件名口径）
find src -type f \( -name '*[Pp]review*.test.ts' -o -name '*[Pp]review*.test.tsx' \) | wc -l   # 11

# 死路径/过期注释复核
grep -rn 'previewImgs' src | head          # 预期 3 命中，全在 imagePreview.ts 注释里（不是调用）
grep -rn 'NoteInfoDialog\|NoteDocPreview\|HistorySnapshotPreview' src/mobile | grep -v test
grep -n -i 'preview\|预览' docs/ARCHITECTURE.md   # 预期 0 命中

# 内核实例/懒边界
grep -rn 'lazy(() => import' src/App.tsx src/mobile/MobileApp.tsx
```

---

**报告结论（给决策者的一句话）**：全仓预览的**浮层已统一、文档只读预览已有共用件、小记快慢路径已单一判据**；发布前真正值得动的只有三小步——**把 4 份内核只读包装器收成 1 个 hook**（Phase 1）、**给「预览里能做什么」一个策略对象并据此修掉两端回收站的能力差异**（Phase 2）、**统一图片放大的档位语义**（Phase 3）。其余差异要么是已定稿的产品差异，要么属文档/死代码清理，**不建议为「统一」再新增抽象层**。
