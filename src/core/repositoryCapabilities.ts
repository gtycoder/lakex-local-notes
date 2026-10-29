/**
 * 领域仓储「能力矩阵」——两端实现对账表（C2-3，261016）。
 *
 * ## 为什么是「数据 + 对账测试」而不是 TS 接口
 * 原方案是「在 `core/ports.ts` 加 `NoteStorePort` / `TreeStorePort`，两端 `satisfies`」。实测后改为矩阵，
 * 因为**签名不可直接统一，强行统一就是扭曲签名**（用户 Q6 明确禁止）：
 *   · 桌面是**一个 `Store` 类**：`createNotebook(title)`、`readNote(id): NoteDocument`、`saveNote(id, title, content, caches?)`；
 *   · 移动端是**按域拆的模块级函数**：`createNotebook(d, input)`、`readNote(d, id): LocalNote | null`、`saveNote(d, ...)`；
 *   · 移动端的复合门面 `bridge` 形状最接近，但仍有多处不一致（返回类型 / 参数表 / 名称）。
 * ⇒ 本文件把「能力 ↔ 两端实现」写成**可对账的数据**，由 `repositoryCapabilities.test.ts` 逐条核对：
 *   ① 每行的移动实现真实存在；② 每行的桌面方法真实存在；③ **移动端仓储文件的导出函数必须全部登记**（新增能力不登记 ⇒ 红）；
 *   ④ `DESKTOP_ONLY` 的每一项必须"桌面有、移动端没有"（防虚报）。
 * **零运行时改动、零签名扭曲**；代价是"存在性对账"而不是"编译期类型约束"——这一点在文档里写明，不假装更强。
 *
 * ## 口径（Q6）
 * 只把**交集**写成对齐能力；差集**单列成表**（`DESKTOP_ONLY_CAPABILITIES`）。本表只覆盖**函数**，常量不参与对账。
 */

/** 一条能力 ↔ 两端实现。 */
export interface RepositoryCapability {
  /** 语义名（用两端都认的词，不硬套某一端的函数名）。 */
  capability: string;
  /** 移动端实现：文件（相对 src/）+ 导出的函数名。 */
  mobile: { file: string; fn: string };
  /** 桌面对应实现：`electron/store.ts` 的类方法名；null = 桌面无同类公开方法（见 note）。 */
  desktop: string | null;
  /** 判据其实在 core（两端共用）时填 core 模块相对路径 ⇒ 表示"不需要两端各写一份"。 */
  core?: string;
  /** 差异说明（名称 / 签名 / 返回类型 / 能力缺口）。 */
  note: string;
}

/** 移动端仓储文件的权威清单（复核覆盖用；新增文件必须同时登记进本表与这里）。 */
export const MOBILE_REPOSITORY_FILES = [
  "mobile/data/noteRepository.ts",
  "mobile/data/treeRepository.ts",
  "mobile/data/trashRepository.ts",
  "mobile/data/historyRepository.ts",
  "mobile/data/notebookTreeRepository.ts",
] as const;

export const REPOSITORY_CAPABILITIES: readonly RepositoryCapability[] = [
  // ── 文档（mobile/data/noteRepository.ts）──
  { capability: "新建文档", mobile: { file: "mobile/data/noteRepository.ts", fn: "createNote" }, desktop: "createNote", note: "移动端多一个 parentId 参数；桌面另有 createNoteIn 指定父级" },
  { capability: "保存文档", mobile: { file: "mobile/data/noteRepository.ts", fn: "saveNote" }, desktop: "saveNote", note: "参数表不同：移动端 (d,id,title,content,parentId,plain)，桌面 (id,title,content,caches?)" },
  { capability: "读取文档", mobile: { file: "mobile/data/noteRepository.ts", fn: "readNote" }, desktop: "readNote", note: "返回类型不同：移动端 LocalNote|null，桌面 NoteDocument（缺失直抛）" },
  { capability: "文档列表", mobile: { file: "mobile/data/noteRepository.ts", fn: "listNotes" }, desktop: "listNoteSummaries", note: "名称不同（桌面叫 summary）；桌面另有 listNoteIdsWithHistory / listNotesForSync" },
  { capability: "搜索", mobile: { file: "mobile/data/noteRepository.ts", fn: "searchNotes" }, desktop: "searchNotes", note: "桌面多 limit 参数（默认 30）" },
  { capability: "移入回收站", mobile: { file: "mobile/data/noteRepository.ts", fn: "trashNote" }, desktop: "deleteNote", note: "名称不同：桌面 deleteNote 的语义就是软删入回收站" },
  { capability: "墓碑判定", mobile: { file: "mobile/data/noteRepository.ts", fn: "isTombstoned" }, desktop: null, note: "桌面无同名公开方法：墓碑判定内联在 listDeletedNotesForSync / purgeTrashItem" },
  { capability: "已删除态判定", mobile: { file: "mobile/data/noteRepository.ts", fn: "noteGoneState" }, desktop: null, core: "core/syncDecisions.ts", note: "判据在 core（isGoneNote），两端共用；桌面经 Store 内联使用" },
  { capability: "可写态判定", mobile: { file: "mobile/data/noteRepository.ts", fn: "noteWriteState" }, desktop: null, core: "core/noteSaveDecision.ts", note: "判据在 core，两端共用" },
  { capability: "孤儿资源探测", mobile: { file: "mobile/data/noteRepository.ts", fn: "detectOrphans" }, desktop: null, note: "桌面拆在 electron/orphanLifecycle.ts + Store.listNoteOrphans / cleanNoteOrphans（名称与形态都不同）" },
  { capability: "笔记孤儿文件名", mobile: { file: "mobile/data/noteRepository.ts", fn: "orphanFilenamesForNote" }, desktop: "orphanFilenamesForNote", note: "同名同义" },
  { capability: "回收站列表", mobile: { file: "mobile/data/noteRepository.ts", fn: "listTrashed" }, desktop: "listTrash", note: "名称不同；桌面另有 listTrashReminder（清理提醒）" },
  // ── 目录树（mobile/data/treeRepository.ts）──
  { capability: "新建分组", mobile: { file: "mobile/data/treeRepository.ts", fn: "createGroup" }, desktop: "createGroup", note: "同签名（移动端前置 db 参数）" },
  { capability: "新建笔记本", mobile: { file: "mobile/data/treeRepository.ts", fn: "createNotebook" }, desktop: "createNotebook", note: "参数不同：移动端传 {title,icon}，桌面传 title" },
  { capability: "目录树读取", mobile: { file: "mobile/data/treeRepository.ts", fn: "listTreeNodes" }, desktop: "listTreeNodes", note: "同名" },
  { capability: "移动并排序", mobile: { file: "mobile/data/treeRepository.ts", fn: "moveTreeNodeOrdered" }, desktop: "moveTreeNodeOrdered", note: "同名（桌面另有旧 moveTreeNode）" },
  { capability: "重命名节点", mobile: { file: "mobile/data/treeRepository.ts", fn: "renameTreeNode" }, desktop: "renameTreeNode", note: "同名" },
  { capability: "同级重排", mobile: { file: "mobile/data/treeRepository.ts", fn: "reorderSiblings" }, desktop: "reorderTreeNodes", note: "名称不同" },
  { capability: "设置节点图标", mobile: { file: "mobile/data/treeRepository.ts", fn: "setNodeIcon" }, desktop: "setNodeIcon", note: "同名" },
  // ── 回收站（mobile/data/trashRepository.ts）──
  { capability: "回收站树", mobile: { file: "mobile/data/trashRepository.ts", fn: "listTrashTree" }, desktop: "listTrash", note: "形态不同：移动端返回树（抽屉按层展开），桌面返回列表" },
  { capability: "彻底删除", mobile: { file: "mobile/data/trashRepository.ts", fn: "purgeTreeItem" }, desktop: "purgeTrashItem", note: "名称不同（桌面另有 emptyTrash 清空）" },
  { capability: "恢复", mobile: { file: "mobile/data/trashRepository.ts", fn: "restoreTreeItem" }, desktop: "restoreTrashItem", note: "名称不同" },
  { capability: "移入回收站（树项）", mobile: { file: "mobile/data/trashRepository.ts", fn: "trashTreeItem" }, desktop: "deleteTreeNode", note: "名称不同：桌面 deleteTreeNode 覆盖文档与分组" },
  // ── 历史快照（mobile/data/historyRepository.ts）──
  { capability: "留档当前内容", mobile: { file: "mobile/data/historyRepository.ts", fn: "backupCurrentNote" }, desktop: null, note: "桌面无同名：最接近的是 createHistorySnapshot；backupDatabaseTo 是整库备份，语义不同" },
  { capability: "清理历史", mobile: { file: "mobile/data/historyRepository.ts", fn: "cleanupHistory" }, desktop: "cleanupHistory", note: "同名" },
  { capability: "创建历史快照", mobile: { file: "mobile/data/historyRepository.ts", fn: "createHistorySnapshot" }, desktop: "createHistorySnapshot", note: "同名（移动端前置 db）" },
  { capability: "删除历史", mobile: { file: "mobile/data/historyRepository.ts", fn: "deleteHistory" }, desktop: "deleteHistory", note: "同名" },
  { capability: "读历史设置", mobile: { file: "mobile/data/historyRepository.ts", fn: "getHistorySettings" }, desktop: "getHistorySettings", note: "同名" },
  { capability: "写历史设置", mobile: { file: "mobile/data/historyRepository.ts", fn: "saveHistorySettings" }, desktop: "saveHistorySettings", note: "同名" },
  { capability: "文档历史列表", mobile: { file: "mobile/data/historyRepository.ts", fn: "listNoteHistory" }, desktop: "listNoteHistory", note: "同名" },
  { capability: "读历史正文", mobile: { file: "mobile/data/historyRepository.ts", fn: "readHistory" }, desktop: "previewHistorySnapshot", note: "名称不同" },
  { capability: "快照当前文档", mobile: { file: "mobile/data/historyRepository.ts", fn: "snapshotNote" }, desktop: "createHistorySnapshot", note: "名称不同：桌面用同一个方法承担这两份语义" },
  { capability: "历史资源引用", mobile: { file: "mobile/data/historyRepository.ts", fn: "historyAssetRefs" }, desktop: "getCurrentContentRefs", note: "名称不同；桌面另有 getProtectedRefs" },
  // ── 笔记本树（mobile/data/notebookTreeRepository.ts）──
  { capability: "笔记本树（含计数）", mobile: { file: "mobile/data/notebookTreeRepository.ts", fn: "listNotebookTree" }, desktop: null, note: "移动端专有聚合查询：桌面用 listTreeNodes（一次给全树）+ listFoldersForSync，由调用方自行聚合" },
];

/** 桌面有、移动端**不提供**的领域能力（差集单列成表，Q6 口径）。 */
export const DESKTOP_ONLY_CAPABILITIES: readonly { desktop: string; note: string }[] = [
  { desktop: "createNoteIn / createNoteInAtTopWithContent", note: "按父级/面板位置新建（移动端 createNote 用 parentId 覆盖前者的常见用法）" },
  { desktop: "createBitableIn / createBoardIn / createUsheetIn", note: "新建多维表/画板/表格文档（移动端不提供新建入口）" },
  { desktop: "getNoteDigest / getNoteInfo / getNotePaths / hasNote / hasTreeNode", note: "属性、路径、存在性查询（移动端用 noteGoneState + 本地查询替代）" },
  { desktop: "setNoteEditLocked", note: "文档锁定（移动端不提供）" },
  { desktop: "updateNoteCaches / readNoteCaches / ensureNoteCaches", note: "markdown/纯文本缓存（移动端检索走自己的 searchIndex，不维护该缓存）" },
  { desktop: "renameAssetDisplay / readAssetPreview / previewNoteOrphan", note: "资产展示名与预览（移动端资产入口不同）" },
  { desktop: "importRemoteNote / moveTreeNode", note: "同步内部使用（移动端同语义在 v3 设备存储 mobile/v3/mobileDeviceStore 内）" },
  { desktop: "listNoteIdsWithHistory / getHistoryStats / getLastHistoryCleanup / markHistoryDirty / flushHistorySnapshots / recordHistoryCleanup", note: "桌面历史维护细节（移动端历史功能较薄）" },
];
